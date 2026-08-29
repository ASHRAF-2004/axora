import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    canManageCompanyIntegrations: vi.fn(async () => true),
    withIntegrationTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/integrations/database", () => ({
  withIntegrationTransaction: mocks.withIntegrationTransaction,
}));

vi.mock("@/lib/integrations/authorization", () => ({
  canManageCompanyIntegrations: mocks.canManageCompanyIntegrations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  INTEGRATION_PROVIDER_APPLICATION_SLUGS,
  integrationConfigInternals,
} from "@/lib/integrations/config";
import { hashIntegrationSecret } from "@/lib/integrations/crypto";
import {
  decideAuthorization,
  exchangeAuthorizationCode,
  prepareAuthorization,
  revokeOAuthToken,
  rotateRefreshToken,
} from "@/lib/integrations/oauth";

const ids = {
  application: "f1282000-0000-4000-8000-000000000001",
  connection: "f1282000-0000-4000-8000-000000000002",
  company: "f1282000-0000-4000-8000-000000000003",
  user: "f1282000-0000-4000-8000-000000000004",
  assignment: "f1282000-0000-4000-8000-000000000005",
  grant: "f1282000-0000-4000-8000-000000000006",
  code: "f1282000-0000-4000-8000-000000000007",
  family: "f1282000-0000-4000-8000-000000000008",
  oldRefresh: "f1282000-0000-4000-8000-000000000009",
  newRefresh: "f1282000-0000-4000-8000-000000000010",
  authorizationRequest: "f1282000-0000-4000-8000-000000000011",
} as const;

const clientId = `axora_client_${"a".repeat(24)}`;
const clientSecret = `axora_cs_${"b".repeat(43)}`;
const redirectUri = "https://client.example.test/oauth/callback";
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
const authorizationCode = `axora_ac_${"c".repeat(43)}`;
const refreshToken = `axora_rt_${"d".repeat(43)}`;
const requestId = "f1282000-0000-4000-8000-000000000099";
const credentials = {
  clientId,
  clientSecret,
  method: "client_secret_basic" as const,
};

const actor: AuthenticatedSessionUser = {
  id: ids.user,
  email: "admin@example.test",
  name: "Integration administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 4,
  preferredLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
};

const applicationRow = {
  id: ids.application,
  clientId,
  clientSecretHash: "",
  clientType: "CONFIDENTIAL",
  tokenEndpointAuthMethod: "client_secret_basic",
  slug: "fixture-app",
  name: "Fixture app",
  description: "Security fixture",
  redirectUris: [redirectUri],
  allowedScopes: ["companies:read", "requests:read"],
};

const codeRow = {
  id: ids.code,
  applicationId: ids.application,
  connectionId: ids.connection,
  companyId: ids.company,
  grantId: ids.grant,
  userId: ids.user,
  roleAssignmentId: ids.assignment,
  authVersionAtGrant: 4,
  redirectUri,
  scopes: ["companies:read", "requests:read"],
  codeChallenge: challenge,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function refreshRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.oldRefresh,
    familyId: ids.family,
    grantId: ids.grant,
    applicationId: ids.application,
    connectionId: ids.connection,
    companyId: ids.company,
    userId: ids.user,
    roleAssignmentId: ids.assignment,
    authVersionAtGrant: 4,
    scopes: ["companies:read", "requests:read"],
    generation: 1,
    tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    familyStatus: "ACTIVE",
    familyExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
    grantStatus: "ACTIVE",
    grantExpiresAt: new Date(Date.now() + 20 * 24 * 60 * 60_000).toISOString(),
    ...overrides,
  };
}

function queryResult(rows: unknown[] = []) {
  return { rowCount: rows.length, rows };
}

function sqlCalls() {
  return mocks.client.query.mock.calls.map(([sql]) => String(sql));
}

describe("OAuth authorization and token lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_BASE_URL", "https://axora.management");
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32, 0x72).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    delete process.env.AXORA_ZAPIER_ENABLED;
    integrationConfigInternals.clearKeyCache();
    applicationRow.clientSecretHash = hashIntegrationSecret(
      "client-secret",
      clientSecret,
    );
  });

  it("fails closed for disabled provider authorization and tokens while preserving revocation", async () => {
    const zapierApplication = {
      ...applicationRow,
      slug: INTEGRATION_PROVIDER_APPLICATION_SLUGS.zapier,
    };
    const parameters = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "requests:read",
      state: "state-that-is-at-least-sixteen-characters",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    mocks.client.query.mockResolvedValueOnce(queryResult([zapierApplication]));
    await expect(prepareAuthorization({ actor, parameters, requestId }))
      .resolves.toEqual({ ok: false, error: "invalid_request" });

    vi.clearAllMocks();
    mocks.client.query.mockResolvedValueOnce(queryResult([zapierApplication]));
    await expect(exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri,
      codeVerifier: verifier,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_client" });
    expect(mocks.client.query).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.client.query.mockResolvedValueOnce(queryResult([{
      id: ids.authorizationRequest,
      applicationId: ids.application,
      applicationSlug: INTEGRATION_PROVIDER_APPLICATION_SLUGS.zapier,
      userId: ids.user,
      roleAssignmentId: ids.assignment,
      companyId: ids.company,
      redirectUri,
      clientState: "state-that-is-at-least-sixteen-characters",
      requestedScopes: ["requests:read"],
      codeChallenge: challenge,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "PENDING",
      clientId,
      applicationName: "Axora for Zapier",
      applicationStatus: "ACTIVE",
      allowedScopes: ["requests:read"],
    }]));
    await expect(decideAuthorization({
      actor,
      handle: `axora_ar_${"z".repeat(43)}`,
      decision: "approve",
      requestId,
    })).resolves.toEqual({ ok: false, error: "unauthorized_client" });
    expect(mocks.client.query).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(queryResult([zapierApplication]))
      .mockResolvedValueOnce(queryResult());
    await expect(revokeOAuthToken({
      credentials,
      token: "unrecognized-opaque-token",
      requestId,
    })).resolves.toEqual({ authenticated: true });
    expect(sqlCalls()).toEqual(expect.arrayContaining([
      expect.stringContaining("integration_api_audit"),
    ]));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("prepares a hashed, short-lived consent handle with exact redirect and scopes", async () => {
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([{ name: "Tenant A" }]))
      .mockResolvedValueOnce(queryResult());
    const parameters = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "requests:read companies:read",
      state: "state-that-is-at-least-sixteen-characters",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const result = await prepareAuthorization({ actor, parameters, requestId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.authorization.handle).toMatch(/^axora_ar_[A-Za-z0-9_-]{43}$/);
    expect(result.authorization.scopes).toEqual(["companies:read", "requests:read"]);
    expect(result.authorization.expiresAt.getTime() - Date.now())
      .toBeGreaterThan(9 * 60_000);
    const insert = mocks.client.query.mock.calls[2];
    expect(String(insert?.[0])).toContain("integration_oauth_authorization_requests");
    expect(insert?.[1]?.[0]).toBe(hashIntegrationSecret(
      "authorization-request",
      result.authorization.handle,
    ));
    expect(insert?.[1]).not.toContain(result.authorization.handle);

    mocks.client.query.mockResolvedValueOnce(queryResult([applicationRow]));
    await expect(prepareAuthorization({
      actor,
      parameters: new URLSearchParams({
        ...Object.fromEntries(parameters),
        redirect_uri: "https://wrong.example.test/callback",
      }),
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_request" });
  });

  it("denies consent without issuing a code and echoes state only to the registered URI", async () => {
    const state = "client-csrf-state-that-is-long-enough";
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{
        id: ids.authorizationRequest,
        applicationId: ids.application,
        userId: ids.user,
        roleAssignmentId: ids.assignment,
        companyId: ids.company,
        redirectUri,
        clientState: state,
        requestedScopes: ["companies:read"],
        codeChallenge: challenge,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "PENDING",
        clientId,
        applicationName: "Fixture app",
        applicationStatus: "ACTIVE",
        allowedScopes: ["companies:read"],
      }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const result = await decideAuthorization({
      actor,
      handle: `axora_ar_${"e".repeat(43)}`,
      decision: "deny",
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const redirected = new URL(result.redirect);
    expect(redirected.origin + redirected.pathname).toBe(redirectUri);
    expect(redirected.searchParams.get("error")).toBe("access_denied");
    expect(redirected.searchParams.get("state")).toBe(state);
    expect(redirected.searchParams.get("iss")).toBe("https://axora.management");
    expect(redirected.searchParams.has("code")).toBe(false);
    expect(sqlCalls().some((sql) => sql.includes("authorization_codes"))).toBe(false);
  });

  it("issues one authorization code bound to app, company, user, redirect, and PKCE", async () => {
    const state = "client-csrf-state-that-is-long-enough";
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{
        id: ids.authorizationRequest,
        applicationId: ids.application,
        userId: ids.user,
        roleAssignmentId: ids.assignment,
        companyId: ids.company,
        redirectUri,
        clientState: state,
        requestedScopes: ["companies:read"],
        codeChallenge: challenge,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        status: "PENDING",
        clientId,
        applicationName: "Fixture app",
        applicationStatus: "ACTIVE",
        allowedScopes: ["companies:read"],
      }]))
      .mockResolvedValueOnce(queryResult([{ valid: true }]))
      .mockResolvedValueOnce(queryResult([{ id: ids.connection }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult([{ id: ids.grant }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const result = await decideAuthorization({
      actor,
      handle: `axora_ar_${"f".repeat(43)}`,
      decision: "approve",
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const code = new URL(result.redirect).searchParams.get("code");
    expect(code).toMatch(/^axora_ac_[A-Za-z0-9_-]{43}$/);
    const codeInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.integration_oauth_authorization_codes"),
    );
    expect(codeInsert?.[1]).toEqual(expect.arrayContaining([
      hashIntegrationSecret("authorization-code", code!),
      ids.application,
      ids.connection,
      ids.company,
      ids.grant,
      ids.user,
      redirectUri,
      challenge,
    ]));
    expect(codeInsert?.[1]).not.toContain(code);
  });

  it("exchanges a code once and persists only token hashes", async () => {
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([codeRow]))
      .mockResolvedValueOnce(queryResult([{ valid: true }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult([{ id: ids.family }]))
      .mockResolvedValueOnce(queryResult([{ id: ids.newRefresh }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const result = await exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri,
      codeVerifier: verifier,
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accessToken).toMatch(/^axora_at_[A-Za-z0-9_-]{43}$/);
    expect(result.refreshToken).toMatch(/^axora_rt_[A-Za-z0-9_-]{43}$/);
    expect(result.expiresIn).toBe(900);
    const refreshInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.integration_oauth_refresh_tokens"),
    );
    const accessInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.integration_oauth_access_tokens"),
    );
    expect(refreshInsert?.[1]).toContain(hashIntegrationSecret(
      "refresh-token",
      result.refreshToken,
    ));
    expect(refreshInsert?.[1]).not.toContain(result.refreshToken);
    expect(accessInsert?.[1]).toContain(hashIntegrationSecret(
      "access-token",
      result.accessToken,
    ));
    expect(accessInsert?.[1]).not.toContain(result.accessToken);
    expect(sqlCalls().findIndex((sql) => sql.includes("SET consumed_at=now()")))
      .toBeLessThan(sqlCalls().findIndex((sql) => sql.includes("refresh_families")));
  });

  it("fails closed for wrong client, redirect, PKCE, expired, or replayed code", async () => {
    mocks.client.query.mockResolvedValueOnce(queryResult([]));
    await expect(exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri,
      codeVerifier: verifier,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_client" });

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([codeRow]));
    await expect(exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri: "https://client.example.test/oauth/other",
      codeVerifier: verifier,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_grant" });

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([codeRow]));
    await expect(exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri,
      codeVerifier: `${verifier.slice(0, -1)}A`,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_grant" });

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([]));
    await expect(exchangeAuthorizationCode({
      credentials,
      code: authorizationCode,
      redirectUri,
      codeVerifier: verifier,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(sqlCalls().some((sql) => sql.includes("access_tokens"))).toBe(false);
  });

  it("rotates refresh tokens, narrows scopes, and consumes the parent atomically", async () => {
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([refreshRow()]))
      .mockResolvedValueOnce(queryResult([{ valid: true }]))
      .mockResolvedValueOnce(queryResult([{ id: ids.newRefresh }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    const result = await rotateRefreshToken({
      credentials,
      refreshToken,
      requestedScope: "companies:read",
      requestId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toBe("companies:read");
    expect(result.refreshToken).not.toBe(refreshToken);
    const newRefreshInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO public.integration_oauth_refresh_tokens"),
    );
    expect(newRefreshInsert?.[1]).toEqual(expect.arrayContaining([
      ids.family,
      ids.grant,
      2,
      ids.oldRefresh,
    ]));
    expect(sqlCalls().some((sql) => (
      sql.includes("SET consumed_at=now(),replaced_by_token_id=$2")
    ))).toBe(true);
  });

  it("treats refresh-token reuse as a family compromise", async () => {
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([refreshRow({
        consumedAt: new Date().toISOString(),
      })]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    await expect(rotateRefreshToken({
      credentials,
      refreshToken,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_grant" });
    const calls = sqlCalls().join("\n");
    expect(calls).toContain("status='REUSE_DETECTED'");
    expect(calls).toContain("UPDATE public.integration_oauth_refresh_tokens");
    expect(calls).toContain("UPDATE public.integration_oauth_access_tokens");
    expect(calls).toContain("UPDATE public.integration_oauth_grants");
    expect(mocks.client.query.mock.calls.some(([, values]) => (
      Array.isArray(values) && values.includes("TOKEN_REPLAY")
    ))).toBe(true);
  });

  it("rejects refresh scope escalation and revoked live authorization", async () => {
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([refreshRow()]));
    await expect(rotateRefreshToken({
      credentials,
      refreshToken,
      requestedScope: "deliveries:read",
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_scope" });
    expect(sqlCalls().some((sql) => sql.includes("INSERT INTO public.integration_oauth")))
      .toBe(false);

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([refreshRow()]))
      .mockResolvedValueOnce(queryResult([{ valid: false }]));
    await expect(rotateRefreshToken({
      credentials,
      refreshToken,
      requestId,
    })).resolves.toEqual({ ok: false, error: "invalid_grant" });
    expect(sqlCalls().some((sql) => sql.includes("integration_oauth_access_tokens")))
      .toBe(false);
  });

  it("revoking one access token invalidates its whole refresh family", async () => {
    const accessToken = `axora_at_${"f".repeat(43)}`;
    mocks.client.query
      .mockResolvedValueOnce(queryResult([applicationRow]))
      .mockResolvedValueOnce(queryResult([{ familyId: ids.family }]))
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult())
      .mockResolvedValueOnce(queryResult());
    await expect(revokeOAuthToken({
      credentials,
      token: accessToken,
      requestId,
    })).resolves.toEqual({ authenticated: true });
    const calls = sqlCalls().join("\n");
    expect(calls).toContain("integration_oauth_refresh_families");
    expect(calls).toContain("integration_oauth_refresh_tokens");
    expect(calls.match(/integration_oauth_access_tokens/g)?.length).toBe(2);
    expect(mocks.client.query.mock.calls[1]?.[1]).toContain(
      hashIntegrationSecret("access-token", accessToken),
    );
  });
});

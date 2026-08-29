import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    loadCurrentAuthorizationIdentity: vi.fn(),
    loadEffectiveAccess: vi.fn(),
    withIntegrationTransaction: vi.fn(
      async (
        _context: unknown,
        work: (transactionClient: { query: (...args: unknown[]) => unknown }) => unknown,
      ) =>
        work(client),
    ),
  };
});

vi.mock("@/lib/auth", () => ({
  loadCurrentAuthorizationIdentity: mocks.loadCurrentAuthorizationIdentity,
}));

vi.mock("@/lib/effective-access", () => ({
  loadEffectiveAccess: mocks.loadEffectiveAccess,
}));

vi.mock("@/lib/integrations/database", () => ({
  withIntegrationTransaction: mocks.withIntegrationTransaction,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { authenticateIntegrationRequest } from "@/lib/integrations/api-auth";
import {
  INTEGRATION_PROVIDER_APPLICATION_SLUGS,
  integrationConfigInternals,
} from "@/lib/integrations/config";

const ids = {
  access: "f1283000-0000-4000-8000-000000000001",
  application: "f1283000-0000-4000-8000-000000000002",
  connection: "f1283000-0000-4000-8000-000000000003",
  company: "f1283000-0000-4000-8000-000000000004",
  grant: "f1283000-0000-4000-8000-000000000005",
  user: "f1283000-0000-4000-8000-000000000006",
  assignment: "f1283000-0000-4000-8000-000000000007",
} as const;

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
  authVersion: 7,
  preferredLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
};

const principalRow = {
  accessTokenId: ids.access,
  applicationId: ids.application,
  applicationSlug: INTEGRATION_PROVIDER_APPLICATION_SLUGS.zapier,
  clientId: `axora_client_${"a".repeat(24)}`,
  connectionId: ids.connection,
  companyId: ids.company,
  grantId: ids.grant,
  userId: ids.user,
  roleAssignmentId: ids.assignment,
  authVersion: 7,
  scopes: ["requests:read"],
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const request = new Request("https://axora.management/api/v1/requests", {
  headers: { authorization: `Bearer axora_at_${"b".repeat(43)}` },
});

describe("provider feature gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32, 0x73).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    delete process.env.AXORA_ZAPIER_ENABLED;
    integrationConfigInternals.clearKeyCache();
    mocks.loadCurrentAuthorizationIdentity.mockResolvedValue(actor);
    mocks.loadEffectiveAccess.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("invalidates an already-issued Zapier access token while the provider is disabled", async () => {
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [principalRow] });
    await expect(authenticateIntegrationRequest(request, ids.access)).resolves.toEqual({
      ok: false,
      reason: "INVALID",
    });
    expect(mocks.client.query).toHaveBeenCalledTimes(1);
    expect(mocks.loadCurrentAuthorizationIdentity).not.toHaveBeenCalled();
    expect(String(mocks.client.query.mock.calls[0]?.[0])).toContain(
      "JOIN public.integration_applications",
    );
  });

  it("permits the same live principal only when the independent provider flag is enabled", async () => {
    vi.stubEnv("AXORA_ZAPIER_ENABLED", "true");
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [principalRow] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await authenticateIntegrationRequest(request, ids.access);
    expect(result).toMatchObject({
      ok: true,
      principal: {
        applicationId: ids.application,
        connectionId: ids.connection,
        companyId: ids.company,
        actor: { id: ids.user },
      },
    });
    expect(mocks.loadCurrentAuthorizationIdentity).toHaveBeenCalledWith(ids.user);
  });
});

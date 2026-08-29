import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    canManageCompanyIntegrations: vi.fn(async () => false),
    canManageIntegrationApplications: vi.fn(async () => false),
    canViewIntegrationOperations: vi.fn(async () => false),
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
  canManageIntegrationApplications: mocks.canManageIntegrationApplications,
  canViewIntegrationOperations: mocks.canViewIntegrationOperations,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { integrationConfigInternals } from "@/lib/integrations/config";
import { hashIntegrationSecret } from "@/lib/integrations/crypto";
import {
  createIntegrationApplication,
  disconnectIntegration,
  IntegrationManagementError,
  rotateIntegrationClientSecret,
} from "@/lib/integrations/management";

const ids = {
  owner: "f1284000-0000-4000-8000-000000000001",
  ownerAssignment: "f1284000-0000-4000-8000-000000000002",
  administrator: "f1284000-0000-4000-8000-000000000003",
  assignment: "f1284000-0000-4000-8000-000000000004",
  company: "f1284000-0000-4000-8000-000000000005",
  foreignCompany: "f1284000-0000-4000-8000-000000000006",
  application: "f1284000-0000-4000-8000-000000000007",
  connection: "f1284000-0000-4000-8000-000000000008",
  grant: "f1284000-0000-4000-8000-000000000009",
} as const;

const owner: AuthenticatedSessionUser = {
  id: ids.owner,
  email: "owner@example.test",
  name: "Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: ids.ownerAssignment,
  isOwner: true,
  authVersion: 1,
  preferredLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
};

const administrator: AuthenticatedSessionUser = {
  id: ids.administrator,
  email: "administrator@example.test",
  name: "Administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 3,
  preferredLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
};

function queryResult(rows: unknown[] = []) {
  return { rowCount: rows.length, rows };
}

describe("integration management boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32, 0x42).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    integrationConfigInternals.clearKeyCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("keeps application registration Owner-only and stores only the client-secret hash", async () => {
    mocks.canManageIntegrationApplications.mockResolvedValueOnce(false);
    await expect(createIntegrationApplication(administrator, {
      name: "Fixture application",
      slug: "fixture-app",
      description: "Fixture",
      clientType: "CONFIDENTIAL",
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["https://client.example.test/oauth/callback"],
      allowedScopes: ["companies:read"],
    })).rejects.toBeInstanceOf(IntegrationManagementError);
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();

    mocks.canManageIntegrationApplications.mockResolvedValueOnce(true);
    mocks.client.query.mockResolvedValueOnce(queryResult([{ id: ids.application }]));
    const created = await createIntegrationApplication(owner, {
      name: "Fixture application",
      slug: "fixture-app",
      description: "Fixture",
      clientType: "CONFIDENTIAL",
      tokenEndpointAuthMethod: "client_secret_basic",
      redirectUris: ["https://client.example.test/oauth/callback"],
      allowedScopes: ["companies:read", "requests:read"],
    });
    expect(created.clientId).toMatch(/^axora_client_[A-Za-z0-9_-]{32}$/);
    expect(created.clientSecret).toMatch(/^axora_cs_[A-Za-z0-9_-]{43}$/);
    const insert = mocks.client.query.mock.calls[0];
    expect(insert?.[1]?.[0]).toBe(created.clientId);
    expect(insert?.[1]?.[1]).toBe(hashIntegrationSecret(
      "client-secret",
      created.clientSecret!,
    ));
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(created.clientSecret);
  });

  it("binds Company Administrator disconnects to the current company", async () => {
    mocks.canManageIntegrationApplications.mockResolvedValueOnce(false);
    mocks.canManageCompanyIntegrations.mockResolvedValueOnce(true);
    mocks.client.query.mockResolvedValueOnce(queryResult());

    await expect(disconnectIntegration(administrator, ids.connection))
      .rejects.toMatchObject({ reason: "NOT_FOUND" });
    const lookup = mocks.client.query.mock.calls[0];
    expect(String(lookup?.[0])).toContain("AND company_id=$2");
    expect(lookup?.[1]).toEqual([ids.connection, ids.company]);
    expect(mocks.client.query).toHaveBeenCalledTimes(1);
  });

  it("revokes the entire grant family when an Owner rotates a client secret", async () => {
    mocks.canManageIntegrationApplications.mockResolvedValueOnce(true);
    mocks.client.query
      .mockResolvedValueOnce(queryResult([{ id: ids.application }]))
      .mockResolvedValueOnce(queryResult([{ id: ids.grant }]))
      .mockResolvedValue(queryResult());

    const rotated = await rotateIntegrationClientSecret(owner, ids.application);
    expect(rotated.clientSecret).toMatch(/^axora_cs_[A-Za-z0-9_-]{43}$/);
    const calls = mocks.client.query.mock.calls;
    expect(calls[0]?.[1]?.[1]).toBe(hashIntegrationSecret(
      "client-secret",
      rotated.clientSecret,
    ));
    expect(JSON.stringify(calls)).not.toContain(rotated.clientSecret);
    const sql = calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("UPDATE public.integration_oauth_grants");
    expect(sql).toContain("UPDATE public.integration_oauth_access_tokens");
    expect(sql).toContain("UPDATE public.integration_oauth_refresh_families");
    expect(sql).toContain("UPDATE public.integration_oauth_refresh_tokens");
  });
});

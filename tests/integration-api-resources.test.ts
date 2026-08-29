import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withIntegrationTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/integrations/database", () => ({
  withIntegrationTransaction: mocks.withIntegrationTransaction,
}));

import type { IntegrationPrincipal } from "@/lib/integrations/api-auth";
import {
  getExternalCompany,
  getExternalDelivery,
  getExternalInvoice,
  getExternalRequest,
  listExternalDeliveries,
  listExternalInvoices,
  listExternalRequests,
} from "@/lib/integrations/resources";

const ids = {
  company: "f1287000-0000-4000-8000-000000000001",
  foreignCompany: "f1287000-0000-4000-8000-000000000002",
  branch: "f1287000-0000-4000-8000-000000000003",
  user: "f1287000-0000-4000-8000-000000000004",
  assignment: "f1287000-0000-4000-8000-000000000005",
  request: "f1287000-0000-4000-8000-000000000006",
  delivery: "f1287000-0000-4000-8000-000000000007",
  invoice: "f1287000-0000-4000-8000-000000000008",
} as const;

function principal(overrides: IntegrationPrincipal["effectiveAccess"]["subject"]["permissionOverrides"] = []): IntegrationPrincipal {
  return {
    accessTokenId: "f1287000-0000-4000-8000-000000000011",
    applicationId: "f1287000-0000-4000-8000-000000000012",
    clientId: "axora_client_resource_fixture",
    connectionId: "f1287000-0000-4000-8000-000000000013",
    companyId: ids.company,
    grantId: "f1287000-0000-4000-8000-000000000014",
    scopes: ["companies:read", "requests:read", "deliveries:read", "invoices:read"],
    expiresAt: new Date(Date.now() + 60_000),
    actor: {
      id: ids.user,
      email: "resource-admin@example.test",
      name: "Resource administrator",
      role: "COMPANY_ADMIN",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId: ids.company,
      roleAssignmentId: ids.assignment,
      isOwner: false,
      authVersion: 1,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
    },
    effectiveAccess: {
      source: "LIVE_DATABASE",
      capturedAt: new Date(),
      roleAssignmentId: ids.assignment,
      authVersion: 1,
      subject: {
        userId: ids.user,
        role: "COMPANY_ADMIN",
        accountKind: "COMPANY",
        accountStatus: "ACTIVE",
        isOwner: false,
        scopes: [{ type: "COMPANY", companyId: ids.company }],
        roleGrants: [
          "company.view",
          "request.view",
          "delivery.view",
          "finance.invoice.view",
        ],
        permissionOverrides: overrides,
        delegations: [],
        approvalLimits: [],
      },
    },
  };
}

function queryResult(rows: unknown[] = []) {
  return { rowCount: rows.length, rows };
}

describe("external API resource isolation", () => {
  it("makes foreign and random company identifiers indistinguishable", async () => {
    vi.clearAllMocks();
    for (const id of [ids.foreignCompany, "f1287000-0000-4000-8000-000000009999"]) {
      await expect(getExternalCompany(principal(), id))
        .rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
    await expect(getExternalCompany(principal(), "not-a-uuid"))
      .rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });

  it("binds every list query to canonical access policy and the connected company", async () => {
    vi.clearAllMocks();
    mocks.client.query.mockResolvedValue(queryResult());
    const current = principal();
    await listExternalRequests({ principal: current, limit: 25 });
    await listExternalDeliveries({ principal: current, limit: 25 });
    await listExternalInvoices({ principal: current, limit: 25 });

    const calls = mocks.client.query.mock.calls;
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call[1]).toContain(ids.company);
      expect(String(call[0])).toContain("public.axora_operation_request_access_rows");
    }
    expect(String(calls[2]?.[0])).toContain("balance.direction='CUSTOMER'");
    const sql = calls.map(([statement]) => String(statement)).join("\n").toLowerCase();
    for (const forbidden of [
      "supplier_cost",
      "buying_cost",
      "gross_margin",
      "raw_gps",
      "proof_path",
      "password_hash",
    ]) expect(sql).not.toContain(forbidden);
  });

  it("returns the same not-found response after company-scoped canonical lookup misses", async () => {
    vi.clearAllMocks();
    mocks.client.query.mockResolvedValue(queryResult());
    const current = principal();
    for (const load of [
      () => getExternalRequest(current, ids.request),
      () => getExternalDelivery(current, ids.delivery),
      () => getExternalInvoice(current, ids.invoice),
    ]) {
      await expect(load()).rejects.toMatchObject({ status: 404, code: "not_found" });
    }
    for (const call of mocks.client.query.mock.calls) {
      expect(call[1]).toContain(ids.company);
    }
  });

  it("keeps explicit DENY final before any resource query", async () => {
    vi.clearAllMocks();
    const denied = principal([{
      permission: "request.view",
      effect: "DENY",
      scope: { type: "COMPANY", companyId: ids.company },
      active: true,
    }]);
    await expect(listExternalRequests({ principal: denied, limit: 25 }))
      .rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });
});

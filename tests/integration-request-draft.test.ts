import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { IntegrationPrincipal } from "@/lib/integrations/api-auth";
import { ExternalApiProblem } from "@/lib/integrations/api-handler";
import { integrationConfigInternals } from "@/lib/integrations/config";
import { integrationPayloadHash } from "@/lib/integrations/crypto";
import {
  createExternalRequestDraft,
  type ExternalDraftInput,
} from "@/lib/integrations/resources";

const ids = {
  application: "f1283000-0000-4000-8000-000000000001",
  connection: "f1283000-0000-4000-8000-000000000002",
  company: "f1283000-0000-4000-8000-000000000003",
  branch: "f1283000-0000-4000-8000-000000000004",
  user: "f1283000-0000-4000-8000-000000000005",
  assignment: "f1283000-0000-4000-8000-000000000006",
  grant: "f1283000-0000-4000-8000-000000000007",
  token: "f1283000-0000-4000-8000-000000000008",
  idempotency: "f1283000-0000-4000-8000-000000000009",
  draft: "f1283000-0000-4000-8000-000000000010",
  product: "f1283000-0000-4000-8000-000000000011",
  request: "f1283000-0000-4000-8000-000000000012",
} as const;

const actor: AuthenticatedSessionUser = {
  id: ids.user,
  email: "integration-admin@example.test",
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

function principalWithOverrides(permissionOverrides: IntegrationPrincipal["effectiveAccess"]["subject"]["permissionOverrides"] = []): IntegrationPrincipal {
  return {
    accessTokenId: ids.token,
    applicationId: ids.application,
    clientId: "axora_client_draft_fixture",
    connectionId: ids.connection,
    companyId: ids.company,
    grantId: ids.grant,
    scopes: ["requests:draft"],
    expiresAt: new Date(Date.now() + 60_000),
    actor,
    effectiveAccess: {
      source: "LIVE_DATABASE",
      capturedAt: new Date(),
      roleAssignmentId: ids.assignment,
      authVersion: actor.authVersion,
      subject: {
        userId: ids.user,
        role: "COMPANY_ADMIN",
        accountKind: "COMPANY",
        accountStatus: "ACTIVE",
        isOwner: false,
        scopes: [{ type: "COMPANY", companyId: ids.company }],
        roleGrants: ["request.create", "integration.connection.manage"],
        permissionOverrides,
        delegations: [],
        approvalLimits: [],
      },
    },
  };
}

const payload: ExternalDraftInput = {
  branch_id: ids.branch,
  request_type: "Standard",
  department: "Operations",
  needed_by_date: "2099-08-29",
  urgency: "Normal",
  notes: "Review in Axora before submission.",
  items: [{
    product_reference: "item-0123456789abcdefabcd",
    quantity: 2,
    specification: "Fictional test line",
  }],
};

function queryResult(rows: unknown[] = []) {
  return { rowCount: rows.length, rows };
}

function statements() {
  return mocks.client.query.mock.calls.map(([sql]) => String(sql));
}

describe("external request draft safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv(
      "AXORA_INTEGRATION_ENCRYPTION_KEY",
      Buffer.alloc(32, 0x31).toString("base64url"),
    );
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    integrationConfigInternals.clearKeyCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    integrationConfigInternals.clearKeyCache();
  });

  it("creates one review-only draft and replays the completed result", async () => {
    let state: {
      payloadHash?: string;
      status: "PROCESSING" | "COMPLETED";
      responseBody?: Record<string, unknown>;
    } = { status: "PROCESSING" };
    mocks.client.query.mockImplementation(async (sqlValue: unknown, parameters: unknown[] = []) => {
      const sql = String(sqlValue);
      if (sql.includes("INSERT INTO public.integration_api_idempotency")) {
        state.payloadHash ??= String(parameters[4]);
        return queryResult();
      }
      if (sql.includes("FROM public.integration_api_idempotency")) {
        return queryResult([{
          id: ids.idempotency,
          payloadHash: state.payloadHash,
          status: state.status,
          responseBody: state.responseBody,
        }]);
      }
      if (sql.includes("FROM public.branches branch")) {
        return queryResult([{ id: ids.branch, today: "2099-01-01" }]);
      }
      if (sql.includes("FROM public.products")) {
        return queryResult([{
          id: ids.product,
          publicReference: payload.items[0]!.product_reference,
          name: "Fictional item",
          unit: "unit",
        }]);
      }
      if (sql.includes("INSERT INTO public.integration_request_drafts")) {
        return queryResult([{
          id: ids.draft,
          createdAt: "2099-08-01T00:00:00.000Z",
          expiresAt: "2099-08-31T00:00:00.000Z",
        }]);
      }
      if (sql.includes("UPDATE public.integration_api_idempotency")) {
        state = {
          ...state,
          status: "COMPLETED",
          responseBody: JSON.parse(String(parameters[1])) as Record<string, unknown>,
        };
        return queryResult();
      }
      return queryResult();
    });

    const input = {
      principal: principalWithOverrides(),
      payload,
      idempotencyKey: "draft-key-0001",
      requestId: ids.request,
      networkHash: "1".repeat(64),
    };
    const first = await createExternalRequestDraft(input);
    const replay = await createExternalRequestDraft(input);

    expect(first.replayed).toBe(false);
    expect(first.data).toMatchObject({
      id: ids.draft,
      status: "pending_review",
      company_id: ids.company,
      branch_id: ids.branch,
      review_url: `/integrations/drafts/${ids.draft}`,
    });
    expect(replay).toEqual({ data: first.data, replayed: true });
    expect(statements().filter((sql) =>
      sql.includes("INSERT INTO public.integration_request_drafts"))).toHaveLength(1);
    expect(statements().filter((sql) =>
      sql.includes("INSERT INTO public.integration_request_draft_items"))).toHaveLength(1);
    expect(statements().filter((sql) =>
      sql.includes("INSERT INTO public.integration_api_audit"))).toHaveLength(1);

    const databaseEvidence = JSON.stringify(mocks.client.query.mock.calls);
    expect(databaseEvidence).not.toContain(input.idempotencyKey);
    for (const protectedTable of [
      "public.transactional_email_outbox",
      "public.workflow_email_outbox",
      "public.wallet_ledger",
      "public.budget_ledger",
      "public.payments",
      "public.invoices",
      "public.delivery_jobs",
      "public.requests ",
    ]) {
      expect(databaseEvidence).not.toContain(protectedTable);
    }
  });

  it("rejects a different payload for the same idempotency key", async () => {
    const originalHash = integrationPayloadHash(payload);
    mocks.client.query.mockImplementation(async (sqlValue: unknown) => {
      const sql = String(sqlValue);
      if (sql.includes("INSERT INTO public.integration_api_idempotency")) return queryResult();
      if (sql.includes("FROM public.integration_api_idempotency")) {
        return queryResult([{
          id: ids.idempotency,
          payloadHash: originalHash,
          status: "PROCESSING",
        }]);
      }
      return queryResult();
    });
    await expect(createExternalRequestDraft({
      principal: principalWithOverrides(),
      payload: { ...payload, items: [{ ...payload.items[0]!, quantity: 3 }] },
      idempotencyKey: "draft-key-0001",
      requestId: ids.request,
      networkHash: "2".repeat(64),
    })).rejects.toMatchObject({ status: 409, code: "conflict" });
    expect(statements().some((sql) =>
      sql.includes("INSERT INTO public.integration_request_drafts"))).toBe(false);
  });

  it("honors explicit DENY before opening a write transaction", async () => {
    await expect(createExternalRequestDraft({
      principal: principalWithOverrides([{
        permission: "request.create",
        effect: "DENY",
        scope: { type: "BRANCH", companyId: ids.company, branchId: ids.branch },
        active: true,
      }]),
      payload,
      idempotencyKey: "draft-key-0002",
      requestId: ids.request,
      networkHash: "3".repeat(64),
    })).rejects.toBeInstanceOf(ExternalApiProblem);
    expect(mocks.withIntegrationTransaction).not.toHaveBeenCalled();
  });

  it("returns the same not-found class for a foreign or missing branch", async () => {
    let payloadHash = "";
    mocks.client.query.mockImplementation(async (sqlValue: unknown, parameters: unknown[] = []) => {
      const sql = String(sqlValue);
      if (sql.includes("INSERT INTO public.integration_api_idempotency")) {
        payloadHash = String(parameters[4]);
      }
      if (sql.includes("FROM public.integration_api_idempotency")) {
        return queryResult([{
          id: ids.idempotency,
          payloadHash,
          status: "PROCESSING",
        }]);
      }
      if (sql.includes("FROM public.branches branch")) return queryResult();
      return queryResult();
    });
    await expect(createExternalRequestDraft({
      principal: principalWithOverrides(),
      payload,
      idempotencyKey: "draft-key-0003",
      requestId: ids.request,
      networkHash: "4".repeat(64),
    })).rejects.toMatchObject({ status: 404, code: "not_found", field: "branch_id" });
    expect(statements().some((sql) =>
      sql.includes("INSERT INTO public.integration_request_drafts"))).toBe(false);
  });
});

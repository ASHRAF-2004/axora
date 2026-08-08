import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(() => true),
  canAccess: vi.fn(() => true),
  withAuditTransaction: vi.fn(),
  workspace: vi.fn(),
  evaluate: vi.fn(),
  override: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDemoMode: mocks.isDemoMode,
  withAuditTransaction: mocks.withAuditTransaction,
}));
vi.mock("@/lib/permissions", () => ({
  canAccess: mocks.canAccess,
}));
vi.mock("@/lib/customer-matching", () => ({
  getCustomerMatchWorkspace: mocks.workspace,
  evaluateCustomerMatch: mocks.evaluate,
  overrideCustomerMatch: mocks.override,
}));
vi.mock("@/lib/receiving", () => ({
  evaluateThreeWayMatch: vi.fn(),
}));
vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: vi.fn(),
  notifyWorkflowAudience: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  CustomerMatchAccessUnavailableError,
  evaluateAuthorizedCustomerMatch,
  getAuthorizedCustomerMatchWorkspace,
  overrideAuthorizedCustomerMatch,
} from "@/lib/customer-matching-isolation";

const actor: AuthenticatedSessionUser = {
  id: "10000000-0000-4000-8000-000000000050",
  email: "finance-demo@example.test",
  name: "Finance demo",
  role: "FINANCE_REVIEWER",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "20000000-0000-4000-8000-000000000050",
  isOwner: false,
  authVersion: 1,
};

const evaluation = {
  requestLineId: "30000000-0000-4000-8000-000000000050",
  customerInvoiceId: "40000000-0000-4000-8000-000000000050",
  invoicedQuantity: 1,
  invoicedUnitPrice: 20,
  idempotencyKey: "50000000-0000-4000-8000-000000000050",
};

describe("customer matching demo authorization compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(true);
    mocks.canAccess.mockReturnValue(true);
    mocks.workspace.mockResolvedValue({ lines: [], invoices: [], matches: [] });
    mocks.evaluate.mockResolvedValue({
      id: "60000000-0000-4000-8000-000000000050",
      status: "MATCHED",
      exceptionCodes: [],
      created: true,
    });
    mocks.override.mockResolvedValue(undefined);
  });

  it("keeps legacy demo identities usable without a role assignment ID", async () => {
    await expect(getAuthorizedCustomerMatchWorkspace(actor)).resolves.toEqual({
      lines: [],
      invoices: [],
      matches: [],
    });
    await expect(evaluateAuthorizedCustomerMatch(actor, evaluation)).resolves
      .toMatchObject({ status: "MATCHED" });
    await expect(overrideAuthorizedCustomerMatch(
      actor,
      "demo-match-id",
      "Independent demo review",
    )).resolves.toBeUndefined();

    expect(mocks.workspace).toHaveBeenCalledWith(actor);
    expect(mocks.evaluate).toHaveBeenCalledWith(actor, evaluation);
    expect(mocks.override).toHaveBeenCalledWith(
      actor,
      "demo-match-id",
      "Independent demo review",
    );
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("still rejects a production identity without an exact live assignment", async () => {
    mocks.isDemoMode.mockReturnValue(false);
    await expect(getAuthorizedCustomerMatchWorkspace(actor))
      .rejects.toBeInstanceOf(CustomerMatchAccessUnavailableError);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("rejects the demo path when the reviewer permission is absent", async () => {
    mocks.canAccess.mockReturnValue(false);
    await expect(getAuthorizedCustomerMatchWorkspace(actor))
      .rejects.toBeInstanceOf(CustomerMatchAccessUnavailableError);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});

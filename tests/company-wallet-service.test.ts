import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    query: vi.fn(),
    withAuditTransaction: vi.fn(async (
      _context: unknown,
      work: (transactionClient: typeof client) => Promise<unknown>,
    ) => work(client)),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  CompanyWalletUnavailableError,
  CompanyWalletValidationError,
  approveAndPay,
  getCompanyWalletWorkspace,
  recordCompanyWalletTopUp,
  requestCompanyWalletTopUp,
} from "@/lib/company-wallet";

const actor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "finance@example.test",
  name: "Finance actor",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "22222222-2222-4222-8222-222222222222",
  isOwner: true,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;
const companyId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const commandId = "55555555-5555-4555-8555-555555555555";
const invoiceId = "66666666-6666-4666-8666-666666666666";
const correlationId = "77777777-7777-4777-8777-777777777777";

describe("Company Wallet PostgreSQL adapter", () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.client.query.mockReset();
    mocks.withAuditTransaction.mockClear();
  });

  it("parses the scoped workspace and preserves exact monetary strings", async () => {
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ payload: {
        capturedAt: "2026-08-20T01:02:03.000Z",
        wallets: [{
          companyId,
          companyName: "Acme",
          currency: "MYR",
          availableBalance: "9007199254740993.01",
          canRequestTopUp: false,
          canRecordTopUp: true,
          topUpRequests: [],
          ledger: [],
        }],
      } }],
    });

    const workspace = await getCompanyWalletWorkspace(actor, companyId);

    expect(workspace.wallets[0]?.availableBalance).toBe("9007199254740993.01");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_company_wallet_workspace"),
      [actor.id, actor.roleAssignmentId, companyId],
    );
  });

  it("sends a canonical decimal string to request and record functions", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rows: [{ payload: {
        created: true,
        requestId,
        status: "REQUESTED",
        amount: "12.30",
        currency: "MYR",
      } }] })
      .mockResolvedValueOnce({ rows: [{ payload: {
        created: true,
        status: "RECEIVED",
        topUpRequestId: requestId,
        ledgerEntryId: invoiceId,
        amount: "12.30",
        currency: "MYR",
      } }] });

    await requestCompanyWalletTopUp(actor, {
      companyId,
      amount: "00012.3",
      reference: "Contract 42",
      commandId,
    });
    await recordCompanyWalletTopUp(actor, {
      companyId,
      topUpRequestId: requestId,
      amount: "00012.3",
      effectiveDate: "2026-08-20",
      reference: "Receipt 42",
      reason: "Externally received",
      commandId: correlationId,
    });

    expect(mocks.client.query.mock.calls[0]?.[1]?.[3]).toBe("12.30");
    expect(mocks.client.query.mock.calls[1]?.[1]?.[4]).toBe("12.30");
    expect(mocks.client.query.mock.calls.flatMap((call) => call[1] ?? []))
      .not.toContain(12.3);
  });

  it("parses controlled Approve & Pay outcomes without amount coercion", async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ payload: {
      status: "SUCCESS",
      commandId,
      requestId,
      invoiceId,
      amount: "9007199254740993.01",
      currency: "MYR",
      created: true,
      correlationId,
      approvalDecisionId: "ignored-additive-field",
    } }] });

    const result = await approveAndPay(actor, {
      requestId,
      expectedApprovalRevision: 3,
      reason: "Final authorized approval",
      commandId,
    });

    expect(result).toMatchObject({
      status: "SUCCESS",
      amount: "9007199254740993.01",
      created: true,
    });
    expect(mocks.client.query.mock.calls[0]?.[1]).toEqual([
      actor.id,
      actor.roleAssignmentId,
      requestId,
      3,
      "Final authorized approval",
      commandId,
    ]);
  });

  it("rejects invalid money before opening a transaction", async () => {
    await expect(requestCompanyWalletTopUp(actor, {
      companyId,
      amount: "12.345",
      commandId,
    })).rejects.toBeInstanceOf(CompanyWalletValidationError);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when SQL returns a contradictory settled result", async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ payload: {
      status: "SUCCESS",
      commandId,
      requestId,
      invoiceId,
      amount: "10.00",
      currency: "MYR",
      created: false,
      correlationId,
    } }] });

    await expect(approveAndPay(actor, {
      requestId,
      expectedApprovalRevision: 1,
      reason: "Final approval",
      commandId,
    })).rejects.toBeInstanceOf(CompanyWalletUnavailableError);
  });
});

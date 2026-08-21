import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  isDemoMode: () => true,
  query: vi.fn(),
  withAuditTransaction: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  CompanyWalletUnavailableError,
  getCompanyWalletWorkspace,
  recordCompanyWalletTopUp,
  requestCompanyWalletTopUp,
} from "@/lib/company-wallet";

const companyId = "co-youruni";
const requestCommandId = "d8100000-0000-4000-8000-000000000001";
const recordCommandId = "d8100000-0000-4000-8000-000000000002";
const replayCommandId = "d8100000-0000-4000-8000-000000000003";

const companyAdmin = {
  id: "d8100000-0000-4000-8000-000000000010",
  email: "company-admin@fixture.invalid",
  name: "Company admin fixture",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId,
  roleAssignmentId: "d8100000-0000-4000-8000-000000000011",
  isOwner: false,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

const owner = {
  id: "d8100000-0000-4000-8000-000000000020",
  email: "owner@fixture.invalid",
  name: "Owner fixture",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "d8100000-0000-4000-8000-000000000021",
  isOwner: true,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

describe("Company Wallet demo evidence", () => {
  beforeEach(() => {
    globalThis.__axoraDemoFinanceState = undefined;
  });

  it("persists a requested top-up and immutable received-funds ledger evidence", async () => {
    const requested = await requestCompanyWalletTopUp(companyAdmin, {
      companyId,
      amount: "12.30",
      reference: "Contract 42",
      note: "Please review the confirmed transfer.",
      commandId: requestCommandId,
    });

    const afterRequest = await getCompanyWalletWorkspace(companyAdmin, companyId);
    expect(afterRequest.wallets[0]?.topUpRequests).toMatchObject([{
      id: requested.requestId,
      amount: "12.30",
      reference: "Contract 42",
      status: "REQUESTED",
    }]);
    expect(afterRequest.wallets[0]?.ledger).toEqual([]);

    await expect(recordCompanyWalletTopUp(companyAdmin, {
      companyId,
      topUpRequestId: requested.requestId,
      amount: "12.30",
      effectiveDate: "2026-08-21",
      reference: "Receipt 42",
      reason: "Externally received transfer",
      commandId: recordCommandId,
    })).rejects.toBeInstanceOf(CompanyWalletUnavailableError);

    const recorded = await recordCompanyWalletTopUp(owner, {
      companyId,
      topUpRequestId: requested.requestId,
      amount: "12.30",
      effectiveDate: "2026-08-21",
      reference: "Receipt 42",
      reason: "Externally received transfer",
      commandId: recordCommandId,
    });
    expect(recorded.created).toBe(true);

    const afterRecord = await getCompanyWalletWorkspace(owner, companyId);
    expect(afterRecord.wallets[0]).toMatchObject({
      availableBalance: "100012.30",
      topUpRequests: [{ id: requested.requestId, status: "RECEIVED" }],
      ledger: [{
        id: recorded.ledgerEntryId,
        type: "TOP_UP",
        amountDelta: "12.30",
        reference: "Receipt 42",
      }],
    });

    const exposed = afterRecord.wallets[0]?.ledger[0];
    if (!exposed) throw new Error("Expected demo ledger evidence.");
    exposed.reference = "mutated caller copy";
    expect((await getCompanyWalletWorkspace(owner, companyId))
      .wallets[0]?.ledger[0]?.reference).toBe("Receipt 42");
  });

  it("replays only matching commands and never credits one request twice", async () => {
    const requested = await requestCompanyWalletTopUp(companyAdmin, {
      companyId,
      amount: "20.00",
      commandId: requestCommandId,
    });
    await expect(requestCompanyWalletTopUp({
      ...companyAdmin,
      id: "d8100000-0000-4000-8000-000000000012",
      email: "second-company-admin@fixture.invalid",
    }, {
      companyId,
      amount: "20.00",
      commandId: requestCommandId,
    })).rejects.toBeInstanceOf(CompanyWalletUnavailableError);
    await expect(requestCompanyWalletTopUp(companyAdmin, {
      companyId,
      amount: "21.00",
      commandId: requestCommandId,
    })).rejects.toBeInstanceOf(CompanyWalletUnavailableError);

    const payload = {
      companyId,
      topUpRequestId: requested.requestId,
      amount: "20.00",
      effectiveDate: "2026-08-21",
      reference: "Receipt 84",
      reason: "Externally received transfer",
      commandId: recordCommandId,
    } as const;
    const first = await recordCompanyWalletTopUp(owner, payload);
    const exactReplay = await recordCompanyWalletTopUp(owner, payload);
    expect(exactReplay).toEqual(first);

    await expect(recordCompanyWalletTopUp(owner, {
      ...payload,
      amount: "22.00",
    })).rejects.toBeInstanceOf(CompanyWalletUnavailableError);

    const requestReplay = await recordCompanyWalletTopUp(owner, {
      ...payload,
      commandId: replayCommandId,
    });
    expect(requestReplay).toMatchObject({
      created: false,
      ledgerEntryId: first.ledgerEntryId,
      amount: "20.00",
    });
    const workspace = await getCompanyWalletWorkspace(owner, companyId);
    expect(workspace.wallets[0]?.availableBalance).toBe("100020.00");
    expect(workspace.wallets[0]?.ledger).toHaveLength(1);
  });
});

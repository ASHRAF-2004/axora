import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withAuditTransaction: vi.fn(async (
      _context: unknown,
      work: (transactionClient: typeof client) => Promise<unknown>,
    ) => work(client)),
  };
});
vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: vi.fn(),
  withAuditTransaction: mocks.withAuditTransaction,
}));

import {
  CompanyCreationCommandConflictError,
  CompanyLifecycleUnavailableError,
  createCompanyWithoutBrand,
} from "@/lib/company-lifecycle";

const owner = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "creation-owner@example.test",
  name: "Synthetic creation owner",
  role: "PLATFORM_OWNER",
  roleAssignmentId: "22222222-2222-4222-8222-222222222222",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;
const commandId = "33333333-3333-4333-8333-333333333333";
const companyId = "44444444-4444-4444-8444-444444444444";
const input = { name: "Synthetic no-brand company", mainContactName: "Synthetic contact" };
const capturedAt = new Date("2026-10-08T00:00:00.000Z");
const payload = {
  company: null, companyId, companyName: input.name, companyVersion: 1,
  eventKey: "company.created", notificationRecipientIds: [], created: true,
  creationLogoId: null, creationThemeId: null,
};

describe("no-brand company creation parameter contract", () => {
  beforeEach(() => {
    mocks.client.query.mockReset();
    mocks.withAuditTransaction.mockClear();
    mocks.client.query.mockResolvedValue({ rows: [{ snapshot: payload }] });
  });

  it("pins the timestamp argument without changing the twelve bound values", async () => {
    await expect(createCompanyWithoutBrand(input, owner, commandId, capturedAt)).resolves.toEqual(payload);
    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(sql).toContain("$12::timestamptz");
    expect(sql).not.toContain("$13");
    expect(values).toEqual([
      owner.id, owner.roleAssignmentId, commandId, input.name, input.name,
      "", "", null, input.mainContactName, "Monthly", null, capturedAt,
    ]);
    expect(mocks.withAuditTransaction).toHaveBeenCalledWith(
      { actor: owner, reason: "COMPANY_CREATED" }, expect.any(Function),
    );
  });

  it("preserves replay and conflicting-command results", async () => {
    mocks.client.query.mockResolvedValueOnce({ rows: [{ snapshot: { ...payload, created: false } }] });
    await expect(createCompanyWithoutBrand(input, owner, commandId)).resolves.toMatchObject({ companyId, created: false });
    mocks.client.query.mockResolvedValueOnce({ rows: [{ snapshot: { status: "COMMAND_CONFLICT" } }] });
    await expect(createCompanyWithoutBrand(input, owner, commandId)).rejects.toBeInstanceOf(CompanyCreationCommandConflictError);
  });

  it("keeps an unauthorized company account outside the mutation boundary", async () => {
    const requester = { ...owner, role: "REQUESTER", accountKind: "COMPANY", scopeType: "COMPANY", isOwner: false } as AuthenticatedSessionUser;
    await expect(createCompanyWithoutBrand(input, requester, commandId)).rejects.toBeInstanceOf(CompanyLifecycleUnavailableError);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
    expect(mocks.client.query).not.toHaveBeenCalled();
  });
});

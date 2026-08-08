import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    query: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import {
  authorizeAccountSetupDelivery,
  consumeAccountSetupToken,
  hashAccountSetupToken,
} from "@/lib/account-setup";

describe("platform owner account setup lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-account-email-service-key-abcdefghijklmnopqrstuvwxyz";
  });

  it("completes a company-less owner invitation without inventing a membership", async () => {
    const rawToken = "O".repeat(43);
    mocks.query.mockResolvedValue({ rows: [{
      recipientName: "First Owner",
      recipientEmail: "first.owner@example.test",
      companyName: "Axora",
      expiresAt: "2026-08-03T00:00:00Z",
    }] });
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('AS "invitationId"')) {
        return { rowCount: 1, rows: [{
          invitationId: "72000000-0000-4000-8000-000000000001",
          userId: "71000000-0000-4000-8000-000000000001",
          email: "first.owner@example.test",
          displayName: "First Owner",
          role: "PLATFORM_OWNER",
          isOwner: true,
        }] };
      }
      if (sql.includes("UPDATE users")) {
        return { rowCount: 1, rows: [{ authVersion: 2 }] };
      }
      if (sql.includes("INSERT INTO company_memberships")) {
        throw new Error("owner membership must not be created");
      }
      return { rowCount: 1, rows: [] };
    });

    const user = await consumeAccountSetupToken(
      rawToken,
      "a secure owner setup passphrase",
      { displayName: "First Owner", locale: "en", termsAccepted: true, privacyAccepted: true },
    );
    expect(user).toMatchObject({
      id: "71000000-0000-4000-8000-000000000001",
      role: "PLATFORM_OWNER",
      isOwner: true,
      authVersion: 2,
    });
    expect(user.companyId).toBeUndefined();
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO company_memberships")
    )).toBe(false);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("COALESCE(c.name,supplier.name");
    const lockedSql = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("FOR UPDATE OF i,u")
    )?.[0];
    expect(String(lockedSql)).toContain("u.company_id IS NOT DISTINCT FROM i.company_id");
    expect(String(lockedSql)).toContain("intended_role.role_key IN");
    expect(String(lockedSql)).toContain("u.is_owner=(intended_role.role_key='PLATFORM_OWNER')");
  });

  it("authorizes a company-less owner invitation using only its token digest", async () => {
    const invitationId = "72000000-0000-4000-8000-000000000002";
    const rawToken = "P".repeat(43);
    const tokenHash = hashAccountSetupToken(rawToken);
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: invitationId }] });

    await expect(authorizeAccountSetupDelivery(invitationId, rawToken))
      .resolves.toBe(true);

    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(String(sql)).toContain("SET delivery_status='SENDING'");
    expect(String(sql)).toContain("invitation.token_hash=$2");
    expect(String(sql)).toContain("account.account_status='INVITED'");
    expect(String(sql)).toContain("axora_email_recipient_is_suppressed");
    expect(values).toEqual([invitationId, tokenHash]);
    expect(String(sql)).not.toMatch(/lease|ciphertext|token_nonce|authentication_tag/i);
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(rawToken);
  });
});

import { hash as hashBcrypt } from "bcryptjs";
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

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { authenticate } from "@/lib/auth";
import { verifyPassword } from "@/lib/password-policy";

const password = "correct horse battery staple";
const userRow = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.test",
  displayName: "Person",
  authVersion: 1,
};
const identityRow = {
  ...userRow,
  legacyRole: "VIEWER",
  accountKind: "COMPANY",
  isOwner: false,
  legacyCompanyId: "00000000-0000-4000-8000-000000000002",
  legacyCompanyActive: true,
  legacyCompanyMembershipStatus: "ACTIVE",
  assignmentId: "00000000-0000-4000-8000-000000000003",
  assignedRole: "AUDITOR",
  assignmentActive: true,
  assignmentRevokedAt: undefined,
  assignedAt: "2026-08-02T00:00:00.000Z",
  scopeType: "COMPANY",
  companyId: "00000000-0000-4000-8000-000000000002",
  scopeCompanyActive: true,
  companyMembershipStatus: "ACTIVE",
  companyMembershipPrimary: true,
};

describe("login password hash compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SESSION_SECRET_FILE;
    process.env.SESSION_SECRET = "test-only-session-secret-with-at-least-32-characters";
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it("accepts bcrypt and conditionally upgrades it to Argon2id", async () => {
    const legacyHash = await hashBcrypt(password, 4);
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...userRow, passwordHash: legacyHash }] })
      .mockResolvedValueOnce({ rows: [identityRow] });

    await expect(authenticate(userRow.email, password)).resolves.toMatchObject({
      id: userRow.id,
      email: userRow.email,
    });
    const passwordUpgradeWrite = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE users"));
    const values = passwordUpgradeWrite?.[1] as unknown[];
    const upgradedHash = String(values[1]);
    expect(upgradedHash).toMatch(/^\$argon2id\$/);
    expect(values[2]).toBe(legacyHash);
    await expect(verifyPassword(password, upgradedHash)).resolves.toBe(true);
    const normalizedWrite = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO account_credentials"));
    expect(normalizedWrite?.[1]).toEqual([
      userRow.id,
      upgradedHash,
      legacyHash,
      userRow.authVersion,
    ]);
    expect(String(normalizedWrite?.[0])).toContain(
      "account_credentials.password_hash=$3",
    );
  });

  it("uses the normalized credential when present and retains a legacy-table fallback", async () => {
    const currentHash = await hashBcrypt(password, 4);
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...userRow, passwordHash: currentHash }] })
      .mockResolvedValueOnce({ rows: [identityRow] });

    await expect(authenticate(userRow.email, password)).resolves.toMatchObject({
      id: userRow.id,
    });

    const [selectSql] = mocks.query.mock.calls[0];
    expect(String(selectSql)).toContain("LEFT JOIN account_credentials credential");
    expect(String(selectSql)).toContain(
      "CASE WHEN credential.user_id IS NULL THEN account.password_hash",
    );
    expect(String(selectSql)).toContain("account.account_status='ACTIVE'");
    expect(String(selectSql)).toContain("account.account_setup_completed_at IS NOT NULL");
    const [identitySql] = mocks.query.mock.calls[1];
    expect(String(identitySql)).toContain("LEFT JOIN role_assignments assignment");
    expect(String(identitySql)).toContain("LEFT JOIN company_memberships scope_membership");
  });

  it("rejects an invalid password without writing login state", async () => {
    const legacyHash = await hashBcrypt(password, 4);
    mocks.query.mockResolvedValueOnce({ rows: [{ ...userRow, passwordHash: legacyHash }] });

    await expect(authenticate(userRow.email, "definitely the wrong password"))
      .resolves.toBeNull();
    expect(mocks.withAuditTransaction).toHaveBeenCalledTimes(2);
    expect(mocks.withAuditTransaction.mock.calls.some(([context]) =>
      String((context as { reason?: string }).reason).includes("Successful login")))
      .toBe(false);
  });
});

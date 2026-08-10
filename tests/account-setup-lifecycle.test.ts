import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    query: vi.fn(),
    appendWorkflowEvent: vi.fn(),
    notifyWorkflowUsers: vi.fn(),
    lockInvitationCreation: vi.fn(),
    lockInvitationTarget: vi.fn(),
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

vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: mocks.appendWorkflowEvent,
  notifyWorkflowUsers: mocks.notifyWorkflowUsers,
}));

vi.mock("@/lib/account-invitation-isolation", () => ({
  lockAuthorizedInvitationCreationScope: mocks.lockInvitationCreation,
  lockAuthorizedInvitationTarget: mocks.lockInvitationTarget,
}));

import {
  AccountSetupInvitationQuotaError,
  consumeAccountSetupToken,
  createInvitedUser,
  resendAccountSetupInvitation,
} from "@/lib/account-setup";
import type { SessionUser } from "@/lib/auth";
import { PENDING_ACCOUNT_PASSWORD_HASH, verifyPassword } from "@/lib/password-policy";

const actor: SessionUser = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "admin@example.test",
  name: "Company administrator",
  role: "ADMIN",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
};

const platformOwner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000009",
  email: "owner@example.test",
  name: "Platform owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};

describe("account setup transactional lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWorkflowEvent.mockResolvedValue({
      id: "workflow-event-id",
      companyId: actor.companyId,
      aggregateType: "account-invitation",
      aggregateId: "invitation-id",
      eventKey: "invitation.accepted",
      eventVersion: 1,
      correlationId: "invitation-id",
      occurredAt: "2026-08-03T00:00:00Z",
      created: true,
    });
    mocks.notifyWorkflowUsers.mockResolvedValue(1);
    delete process.env.ACCOUNT_SETUP_TTL_HOURS;
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-account-email-service-key-abcdefghijklmnopqrstuvwxyz";
  });

  it("returns a bearer token once while sending only its hash to PostgreSQL", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 19, companyCount: 99 }] };
      }
      if (sql.includes("SELECT name FROM companies")) {
        return { rowCount: 1, rows: [{ name: "Example Company" }] };
      }
      if (sql.includes("INSERT INTO users")) {
        return { rowCount: 1, rows: [{ id: "user-id" }] };
      }
      if (sql.includes("SELECT id::text FROM roles")) {
        return { rowCount: 1, rows: [{ id: "normalized-role-id" }] };
      }
      if (sql.includes("UPDATE users SET account_status='INVITED'")
        || sql.includes("INSERT INTO user_profiles")
        || sql.includes("INSERT INTO account_credentials")
        || sql.includes("INSERT INTO company_memberships")
        || sql.includes("INSERT INTO role_assignments")
        || sql.includes("INSERT INTO onboarding_progress")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO account_setup_invitations")) {
        return {
          rowCount: 1,
          rows: [{ id: "invitation-id", expiresAt: "2026-08-03T00:00:00Z" }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await createInvitedUser({
      email: "New.User@Example.Test",
      displayName: "New User",
      role: "ADMIN",
      preferredLocale: "ar",
    }, actor);

    expect(result).toMatchObject({
      invitationId: "invitation-id",
      userId: "user-id",
      recipientName: "New User",
      recipientEmail: "new.user@example.test",
      companyName: "Example Company",
      role: "COMPANY_ADMIN",
    });
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const statements = mocks.client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements[0]).toContain("axora-account-invite-actor:");
    expect(statements[1]).toContain("axora-account-invite-company:");
    expect(statements.find((sql) => sql.includes('AS "actorId"')))
      .toContain("FOR KEY SHARE OF u,c");
    expect(statements.findIndex((sql) => sql.includes('AS "actorCount"')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("INSERT INTO users")));

    const databaseArguments = JSON.stringify(mocks.client.query.mock.calls);
    expect(databaseArguments).not.toContain(result.rawToken);
    const userCall = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO users"));
    expect(userCall?.[1]?.[2]).toBe(PENDING_ACCOUNT_PASSWORD_HASH);
    const invitationCall = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO account_setup_invitations"));
    expect(invitationCall?.[1]?.[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationCall?.[1]?.[5]).toMatch(/^[0-9a-f-]{36}$/);
    expect(invitationCall?.[1]?.[6]).toBe("ar");
    expect(invitationCall?.[1]?.[7]).toBe("normalized-role-id");
    expect(invitationCall?.[1]?.[8]).toBeNull();
    expect(invitationCall?.[1]?.[9]).toBeNull();
    expect(invitationCall?.[1]?.[10]).toBe("COMPANY");
    expect(invitationCall?.[1]?.[11]).toBeNull();
    const profileCall = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_profiles"));
    expect(profileCall?.[1]?.[3]).toBe("ar");
    const normalizedRole = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT id::text FROM roles"));
    expect(normalizedRole?.[1]).toEqual(["COMPANY_ADMIN"]);
    const roleAssignment = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO role_assignments"));
    expect(roleAssignment?.[1]).toEqual([
      "user-id",
      "normalized-role-id",
      "COMPANY",
      actor.companyId,
      null,
      null,
      null,
      actor.id,
    ]);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO branch_assignments"))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("VALUES ($1,$2,'INVITED',true,$3)"))).toBe(true);
  });

  it("normalizes a branch approver invitation to one tenant and branch scope", async () => {
    const branchId = "20000000-0000-4000-8000-000000000001";
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 0, companyCount: 0 }] };
      }
      if (sql.includes("SELECT name FROM companies")) {
        return { rowCount: 1, rows: [{ name: "Example Company" }] };
      }
      if (sql.includes("SELECT name FROM branches")) {
        return { rowCount: 1, rows: [{ name: "Main Branch" }] };
      }
      if (sql.includes("INSERT INTO users")) {
        return { rowCount: 1, rows: [{ id: "branch-user-id" }] };
      }
      if (sql.includes("SELECT id::text FROM roles")) {
        return { rowCount: 1, rows: [{ id: "branch-role-id" }] };
      }
      if (sql.includes("UPDATE users SET account_status='INVITED'")
        || sql.includes("INSERT INTO user_profiles")
        || sql.includes("INSERT INTO account_credentials")
        || sql.includes("INSERT INTO company_memberships")
        || sql.includes("INSERT INTO branch_assignments")
        || sql.includes("INSERT INTO role_assignments")
        || sql.includes("INSERT INTO onboarding_progress")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO account_setup_invitations")) {
        return {
          rowCount: 1,
          rows: [{ id: "branch-invitation-id", expiresAt: "2026-08-03T00:00:00Z" }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await createInvitedUser({
      email: "approver@example.test",
      displayName: "Branch Approver",
      role: "APPROVER",
      branchId,
    }, actor);

    const normalizedRole = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT id::text FROM roles"));
    expect(normalizedRole?.[1]).toEqual(["BRANCH_APPROVER"]);
    const branchAssignment = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO branch_assignments"));
    expect(branchAssignment?.[1]).toEqual([
      "branch-user-id",
      actor.companyId,
      branchId,
      actor.id,
    ]);
    const roleAssignment = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO role_assignments"));
    expect(roleAssignment?.[1]?.[2]).toBe("BRANCH");
    expect(roleAssignment?.[1]?.[4]).toBe(branchId);
  });

  it.each([
    {
      role: "PLATFORM_OPERATIONS" as const,
      accountKind: "PLATFORM" as const,
      scopeType: "PLATFORM" as const,
      supplierId: undefined,
    },
    {
      role: "DELIVERY_DRIVER" as const,
      accountKind: "DELIVERY" as const,
      scopeType: "DELIVERY" as const,
      supplierId: undefined,
    },
  ])("initializes $accountKind invitations without a company membership", async ({
    role,
    accountKind,
    scopeType,
    supplierId,
  }) => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: platformOwner.id }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 0, companyCount: 0 }] };
      }
      if (sql.includes("SELECT name FROM suppliers")) {
        return { rowCount: 1, rows: [{ name: "Example Supplier" }] };
      }
      if (sql.includes("INSERT INTO users")) {
        return { rowCount: 1, rows: [{ id: `${accountKind.toLowerCase()}-user-id` }] };
      }
      if (sql.includes("SELECT id::text FROM roles")) {
        return { rowCount: 1, rows: [{ id: `${accountKind.toLowerCase()}-role-id` }] };
      }
      if (sql.includes("UPDATE users SET account_status='INVITED'")
        || sql.includes("INSERT INTO user_profiles")
        || sql.includes("INSERT INTO account_credentials")
        || sql.includes("INSERT INTO supplier_memberships")
        || sql.includes("INSERT INTO delivery_agent_profiles")
        || sql.includes("INSERT INTO role_assignments")
        || sql.includes("INSERT INTO onboarding_progress")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO account_setup_invitations")) {
        return {
          rowCount: 1,
          rows: [{ id: `${accountKind.toLowerCase()}-invitation-id`, expiresAt: "2026-08-03T00:00:00Z" }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await createInvitedUser({
      email: `${accountKind.toLowerCase()}@example.test`,
      displayName: `${accountKind} User`,
      role,
      supplierId,
      jobTitle: "Account specialist",
    }, platformOwner);

    expect(result.role).toBe(role);
    const userInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO users"));
    expect(userInsert?.[1]?.[8]).toBe(accountKind);
    const invitationInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO account_setup_invitations"));
    expect(invitationInsert?.[1]?.[1]).toBeNull();
    expect(invitationInsert?.[1]?.[9]).toBeNull();
    expect(invitationInsert?.[1]?.[10]).toBe(scopeType);
    expect(invitationInsert?.[1]?.[11]).toBe(supplierId ?? null);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO company_memberships"))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO supplier_memberships"))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO delivery_agent_profiles"))).toBe(accountKind === "DELIVERY");
  });

  it("blocks the twenty-first invitation by one actor within an hour", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 20, companyCount: 20 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const attempt = createInvitedUser({
      email: "quota@example.test",
      displayName: "Quota User",
      role: "ADMIN",
    }, actor);
    await expect(attempt).rejects.toBeInstanceOf(AccountSetupInvitationQuotaError);
    await expect(attempt).rejects.toMatchObject({
      name: "AccountSetupInvitationQuotaError",
      reason: "actor",
    });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO users"))).toBe(false);
  });

  it("blocks the one-hundred-and-first company invitation within a day", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 1, companyCount: 100 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const attempt = createInvitedUser({
      email: "company.quota@example.test",
      displayName: "Company Quota",
      role: "ADMIN",
    }, actor);
    await expect(attempt).rejects.toBeInstanceOf(AccountSetupInvitationQuotaError);
    await expect(attempt).rejects.toMatchObject({
      name: "AccountSetupInvitationQuotaError",
      reason: "company",
    });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO users"))).toBe(false);
  });

  it("revokes an earlier link before creating a replacement", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("SELECT") && sql.includes("setupCompleted")) {
        return { rowCount: 1, rows: [{
          userId: "user-id",
          recipientName: "Pending User",
          recipientEmail: "pending@example.test",
          role: "AUDITOR",
          roleId: "normalized-role-id",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: actor.companyId,
          companyName: "Example Company",
          active: true,
          setupCompleted: false,
          organizationActive: true,
          membershipReady: true,
          preferredLocale: "en",
        }] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 2, companyCount: 10 }] };
      }
      if (sql.includes('AS "tooSoon"')) {
        return { rowCount: 1, rows: [{ tooSoon: false, lastHour: 1 }] };
      }
      if (sql.includes("UPDATE account_setup_invitations")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("SELECT id::text FROM roles")) {
        return { rowCount: 1, rows: [{ id: "normalized-role-id" }] };
      }
      if (sql.includes("INSERT INTO account_setup_invitations")) {
        return { rowCount: 1, rows: [{
          id: "replacement-id",
          expiresAt: "2026-08-03T00:00:00Z",
        }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const result = await resendAccountSetupInvitation("user-id", actor);
    const statements = mocks.client.query.mock.calls.map(([sql]) => String(sql));
    expect(statements.findIndex((sql) => sql.includes("SET revoked_at=now()")))
      .toBeLessThan(statements.findIndex((sql) => sql.includes("INSERT INTO account_setup_invitations")));
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(result.rawToken);
  });


  it("rate-limits repeated resend attempts before revoking the current link", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("SELECT") && sql.includes("setupCompleted")) {
        return { rowCount: 1, rows: [{
          userId: "user-id",
          recipientName: "Pending User",
          recipientEmail: "pending@example.test",
          role: "AUDITOR",
          roleId: "normalized-role-id",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: actor.companyId,
          companyName: "Example Company",
          active: true,
          setupCompleted: false,
          organizationActive: true,
          membershipReady: true,
        }] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 2, companyCount: 10 }] };
      }
      if (sql.includes('AS "tooSoon"')) {
        return { rowCount: 1, rows: [{ tooSoon: true, lastHour: 1 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    await expect(resendAccountSetupInvitation("user-id", actor)).rejects.toThrow(/one minute/i);
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("SET revoked_at=now()"))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO account_setup_invitations"))).toBe(false);
  });

  it("applies the actor and company quotas to resend exposure", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) {
        return { rowCount: 1, rows: [{}] };
      }
      if (sql.includes("SELECT") && sql.includes("setupCompleted")) {
        return { rowCount: 1, rows: [{
          userId: "user-id",
          recipientName: "Pending User",
          recipientEmail: "pending@example.test",
          role: "AUDITOR",
          roleId: "normalized-role-id",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: actor.companyId,
          companyName: "Example Company",
          active: true,
          setupCompleted: false,
          organizationActive: true,
          membershipReady: true,
        }] };
      }
      if (sql.includes('AS "actorId"')) {
        return { rowCount: 1, rows: [{ actorId: actor.id, companyId: actor.companyId }] };
      }
      if (sql.includes('AS "actorCount"')) {
        return { rowCount: 1, rows: [{ actorCount: 20, companyCount: 50 }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const attempt = resendAccountSetupInvitation("user-id", actor);
    await expect(attempt).rejects.toBeInstanceOf(AccountSetupInvitationQuotaError);
    await expect(attempt).rejects.toMatchObject({
      name: "AccountSetupInvitationQuotaError",
      reason: "actor",
    });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes('AS "tooSoon"'))).toBe(false);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("SET revoked_at=now()"))).toBe(false);
  });

  it("consumes under row locks, stores only an Argon2id hash, and advances auth version", async () => {
    const rawToken = "A".repeat(43);
    const password = "a secure setup passphrase";
    mocks.query.mockResolvedValue({ rows: [{
      recipientName: "Pending User",
      recipientEmail: "pending@example.test",
      companyName: "Example Company",
      expiresAt: "2026-08-03T00:00:00Z",
      locale: "ar",
    }] });
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT i.id::text AS \"invitationId\"")) {
        return { rowCount: 1, rows: [{
          invitationId: "invitation-id",
          userId: "user-id",
          email: "pending@example.test",
          displayName: "Pending User",
          role: "AUDITOR",
          roleAssignmentId: "assignment-id",
          accountKind: "COMPANY",
          scopeType: "COMPANY",
          companyId: actor.companyId,
          createdBy: actor.id,
          isOwner: false,
        }] };
      }
      if (sql.includes("UPDATE users")) {
        return { rowCount: 1, rows: [{ authVersion: 2 }] };
      }
      if (sql.includes("set_config('axora.user_id'")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO account_credentials")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("INSERT INTO user_profiles")
        || sql.includes("INSERT INTO company_memberships")
        || sql.includes("INSERT INTO onboarding_progress")) {
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("UPDATE account_setup_invitations")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const user = await consumeAccountSetupToken(rawToken, password, {
      displayName: "Pending User", locale: "ar",
      termsAccepted: true, privacyAccepted: true,
    });
    expect(user).toMatchObject({ id: "user-id", authVersion: 2 });
    expect(mocks.query.mock.calls[0]?.[1]).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      PENDING_ACCOUNT_PASSWORD_HASH,
    ]);
    const lockedInvitationCall = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("FOR UPDATE OF i,u"));
    expect(lockedInvitationCall?.[1]?.[1]).toBe(PENDING_ACCOUNT_PASSWORD_HASH);
    expect(mocks.client.query.mock.calls.some(([sql, parameters]) =>
      String(sql).includes("set_config('axora.user_id'")
      && parameters?.[0] === "user-id")).toBe(true);
    const databaseArguments = JSON.stringify(mocks.client.query.mock.calls);
    expect(databaseArguments).not.toContain(rawToken);
    expect(databaseArguments).not.toContain(password);
    const userUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("SET password_hash=$2"));
    const storedHash = String(userUpdate?.[1]?.[1]);
    expect(storedHash).toMatch(/^\$argon2id\$v=19\$/);
    await expect(verifyPassword(password, storedHash)).resolves.toBe(true);
    expect(databaseArguments).toContain("$argon2id$");
    expect(databaseArguments).toContain("FOR UPDATE OF i,u");
    const credentialUpsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO account_credentials"));
    expect(credentialUpsert?.[1]).toEqual(["user-id", storedHash, 2]);
    expect(String(credentialUpsert?.[0])).toContain("VALUES ($1,$2,'argon2id'");
    const completedProfile = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO user_profiles"));
    expect(completedProfile?.[1]).toEqual(["user-id", "Pending User", "ar"]);
    expect(String(userUpdate?.[0])).toContain("account_status='ACTIVE'");
    expect(String(userUpdate?.[0])).toContain("email_verified_at=COALESCE");
    const membership = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO company_memberships"));
    expect(membership?.[1]).toEqual(["user-id", actor.companyId]);
    const onboarding = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO onboarding_progress"));
    expect(onboarding?.[1]).toEqual(["user-id"]);
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      companyId: actor.companyId,
      aggregateType: "account-invitation",
      aggregateId: "invitation-id",
      eventKey: "invitation.accepted",
      stableKey: "account-activated",
      previousState: "INVITED",
      newState: "ACTIVE",
    }));
    expect(mocks.notifyWorkflowUsers).toHaveBeenCalledWith(
      mocks.client,
      expect.objectContaining({ eventKey: "invitation.accepted" }),
      {
        recipientUserIds: [actor.id],
        message: { key: "invitation_accepted", accountName: "Pending User" },
        routePath: "/users",
      },
    );
  });


});

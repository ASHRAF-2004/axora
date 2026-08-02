import { describe, expect, it, vi } from "vitest";
import {
  createFirstPlatformOwner,
  parseBootstrapArguments,
  prepareSetupToken,
  validateBootstrapArguments,
} from "../scripts/bootstrap/create_first_platform_owner.mjs";

const input = {
  email: "first.owner@example.test",
  displayName: "First Owner",
  locale: "en",
  operatorIdentity: "operator@example.test",
  reason: "Approved initial empty-database bootstrap",
};

function fakeClient({ ownerExists = false } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, parameters = []) => {
    const statement = String(sql);
    calls.push([statement, parameters]);
    if (statement.includes("AS migration_lock")) {
      return { rows: [{ migration_lock: true, bootstrap_lock: true }], rowCount: 1 };
    }
    if (statement.includes("FROM schema_migrations")) return { rows: [], rowCount: 0 };
    if (statement.includes("AS owner_exists")) {
      return {
        rows: [{
          owner_exists: ownerExists,
          owner_assignment_exists: false,
          owner_invitation_exists: false,
        }],
        rowCount: 1,
      };
    }
    if (statement.includes("lower(email)=lower")) return { rows: [], rowCount: 0 };
    if (statement.includes("role_key='PLATFORM_OWNER' FOR KEY SHARE")) {
      return { rows: [{ id: "70000000-0000-4000-8000-000000000001" }], rowCount: 1 };
    }
    if (statement.includes("INSERT INTO users")) {
      return { rows: [{ id: "71000000-0000-4000-8000-000000000001" }], rowCount: 1 };
    }
    if (statement.includes("INSERT INTO account_setup_invitations")) {
      return {
        rows: [{ id: parameters[0], expires_at: "2026-08-03T00:00:00.000Z" }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 1 };
  });
  return { calls, client: { query, end: vi.fn(async () => {}) } };
}

describe("first platform owner bootstrap command", () => {
  it("accepts only named identity fields plus mandatory operator evidence and confirmation", () => {
    const parsed = parseBootstrapArguments([
      "--email", "First.Owner@Example.Test",
      "--display-name", " First Owner ",
      "--locale", "EN",
      "--operator", "operator@example.test",
      "--reason", "Approved initial empty-database bootstrap",
      "--confirm-first-platform-owner",
    ]);
    expect(validateBootstrapArguments(parsed)).toEqual({
      ...input,
      replacePending: false,
    });
    expect(() => parseBootstrapArguments([
      "--password", "NeverAccepted",
    ])).toThrow(/unknown argument/i);
    expect(() => validateBootstrapArguments(parseBootstrapArguments([
      "--email", "owner@example.test",
      "--display-name", "First Owner",
      "--locale", "en",
      "--operator", "operator@example.test",
      "--reason", "Approved initial empty-database bootstrap",
    ]))).toThrow(/confirm-first-platform-owner/i);
  });

  it("accepts Malay for the localized first-owner invitation", () => {
    const parsed = parseBootstrapArguments([
      "--email", "owner@example.test",
      "--display-name", "Pemilik Platform",
      "--locale", "ms",
      "--operator", "approved-operator",
      "--reason", "Approved initial platform owner bootstrap",
      "--confirm-first-platform-owner",
    ]);
    expect(validateBootstrapArguments(parsed).locale).toBe("ms");
  });

  it("prepares one in-memory bearer token and its persisted digest", () => {
    const result = prepareSetupToken();
    expect(Object.keys(result).sort()).toEqual(["rawToken", "tokenHash"]);
    expect(result.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.tokenHash).not.toContain(result.rawToken);
  });

  it("creates only an INVITED owner and stores no raw token or password in SQL arguments", async () => {
    const fake = fakeClient();
    const assertEmailSenderReady = vi.fn().mockResolvedValue(undefined);
    const deliverBootstrapInvitation = vi.fn().mockResolvedValue({
      status: "SENT",
      messageId: "provider-first-owner-123",
    });
    const result = await createFirstPlatformOwner(input, {
      env: {
        ACCOUNT_SETUP_TTL_HOURS: "24",
        APP_BASE_URL: "https://axora.management",
      },
      dependencies: {
        expectedMigrations: async () => [],
        accountEmailServiceSecret: async () =>
          "test-account-email-key-that-is-long-enough",
        assertEmailSenderReady,
        deliverBootstrapInvitation,
        connectClient: async () => fake.client,
      },
    });

    expect(result).toEqual({
      userId: "71000000-0000-4000-8000-000000000001",
      invitationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      expiresAt: "2026-08-03T00:00:00.000Z",
      deliveryStatus: "SENT",
    });
    const stringArguments = fake.calls
      .flatMap(([, parameters]) => parameters)
      .filter((value) => typeof value === "string");
    expect(stringArguments).not.toContainEqual(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
    const serializedArguments = JSON.stringify(stringArguments);
    expect(serializedArguments).not.toContain("NeverAccepted");
    const userInsert = fake.calls.find(([sql]) => sql.includes("INSERT INTO users"));
    expect(userInsert[0]).toContain("'PLATFORM','INVITED'");
    expect(userInsert[1][2]).toMatch(/^\$2b\$12\$/);
    const invitationInsert = fake.calls.find(([sql]) =>
      sql.includes("INSERT INTO account_setup_invitations")
    );
    expect(invitationInsert[1][2]).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationInsert[1]).toHaveLength(6);
    expect(invitationInsert[1]).not.toContainEqual(expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
    expect(invitationInsert[0]).toContain("intended_scope_type,intended_supplier_id");
    expect(invitationInsert[0]).toContain("'PLATFORM',NULL");
    expect(fake.calls.some(([sql]) =>
      sql.includes("INSERT INTO platform_owner_bootstrap_audits")
    )).toBe(true);
    expect(fake.calls.some(([sql]) =>
      sql.includes("delivery_attempt_count=1")
    )).toBe(true);
    expect(assertEmailSenderReady).toHaveBeenCalledOnce();
    expect(deliverBootstrapInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: result.invitationId,
        rawToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
      expect.objectContaining({ secret: "test-account-email-key-that-is-long-enough" }),
    );
    expect(fake.client.end).toHaveBeenCalledOnce();
  });

  it("rolls back before inserts when any owner already exists", async () => {
    const fake = fakeClient({ ownerExists: true });
    await expect(createFirstPlatformOwner(input, {
      env: { ACCOUNT_SETUP_TTL_HOURS: "24" },
      dependencies: {
        expectedMigrations: async () => [],
        accountEmailServiceSecret: async () =>
          "test-account-email-key-that-is-long-enough",
        assertEmailSenderReady: async () => undefined,
        deliverBootstrapInvitation: vi.fn(),
        connectClient: async () => fake.client,
      },
    })).rejects.toThrow(/recovery is a separate procedure/i);
    expect(fake.calls.some(([sql]) => sql.includes("ROLLBACK"))).toBe(true);
    expect(fake.calls.some(([sql]) => sql.includes("INSERT INTO users"))).toBe(false);
  });
});

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
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  requestEmailVerification,
  requestPasswordReset,
} from "@/lib/security-notifications";
import { verifyPassword } from "@/lib/password-policy";

const userId = "00000000-0000-4000-8000-000000000001";

describe("password reset and email verification notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-security-email-service-key-abcdefghijklmnopqrstuvwxyz";
    mocks.query.mockReset();
  });

  it("returns the same password-reset result for known and unknown accounts", async () => {
    function implementation(known: boolean) {
      mocks.client.query.mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO public_request_rate_buckets")) {
          return { rowCount: 1, rows: [{ request_count: 1 }] };
        }
        if (sql.includes("SELECT id::text FROM users")) {
          return known
            ? { rowCount: 1, rows: [{ id: userId }] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes("UPDATE password_reset_tokens")
          || sql.includes("UPDATE transactional_email_outbox")) {
          return { rowCount: 0, rows: [] };
        }
        if (sql.includes("INSERT INTO password_reset_tokens")
          || sql.includes("INSERT INTO transactional_email_outbox")) {
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      });
    }

    implementation(false);
    const unknown = await requestPasswordReset(
      "unknown@example.test",
      "198.51.100.10",
    );
    expect(unknown).toEqual({ accepted: true });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("INSERT INTO password_reset_tokens"))).toBe(false);

    vi.clearAllMocks();
    implementation(true);
    const known = await requestPasswordReset(
      "KNOWN@EXAMPLE.TEST",
      "198.51.100.10",
    );
    expect(known).toEqual(unknown);
    const tokenInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO password_reset_tokens"));
    expect(tokenInsert?.[1]?.[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenInsert?.[1]?.[4]).toMatch(/^[0-9a-f]{64}$/);
    const outboxInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO transactional_email_outbox"));
    expect(outboxInsert?.[1]?.[1]).toBe("PASSWORD_RESET");
    expect(outboxInsert?.[1]?.[4]).toMatch(/^[A-Za-z0-9_-]{58}$/);
    expect(outboxInsert?.[1]?.[5]).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(outboxInsert?.[1]?.[6]).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain("198.51.100.10");
  });

  it("silently accepts a rate-limited password-reset request", async () => {
    mocks.client.query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(requestPasswordReset(
      "person@example.test",
      "198.51.100.20",
    )).resolves.toEqual({ accepted: true });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("SELECT id::text FROM users"))).toBe(false);
  });

  it("rotates both credential stores and revokes sessions on reset completion", async () => {
    const rawToken = "A".repeat(43);
    const password = "a new memorable password";
    mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ exists: 1 }] });
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('AS "tokenId"')) {
        return { rowCount: 1, rows: [{ tokenId: "token-id", userId }] };
      }
      if (sql.includes("UPDATE users") && sql.includes("auth_version")) {
        return { rowCount: 1, rows: [{ authVersion: 7 }] };
      }
      return { rowCount: 1, rows: [] };
    });

    await expect(consumePasswordResetToken(rawToken, password))
      .resolves.toEqual({ completed: true });
    const userUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE users") && String(sql).includes("auth_version"));
    const storedHash = String(userUpdate?.[1]?.[1]);
    expect(storedHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(password, storedHash)).resolves.toBe(true);
    const credentialUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE account_credentials"));
    expect(credentialUpdate?.[1]).toEqual([userId, storedHash, 7]);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE user_sessions")
      && String(sql).includes("password_reset"))).toBe(true);
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(password);
  });

  it("creates and consumes an email-verification token without returning it", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public_request_rate_buckets")) {
        return { rowCount: 1, rows: [{ request_count: 1 }] };
      }
      if (sql.includes("SELECT id::text FROM users")) {
        return { rowCount: 1, rows: [{ id: userId }] };
      }
      if (sql.includes("INSERT INTO transactional_email_outbox")) {
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    });
    await expect(requestEmailVerification(
      userId,
      "person@example.test",
      "ms",
    )).resolves.toEqual({ accepted: true });
    const outboxInsert = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO transactional_email_outbox"));
    expect(outboxInsert?.[1]?.[1]).toBe("EMAIL_VERIFICATION");
    expect(outboxInsert?.[1]?.[3]).toBe("ms");

    vi.clearAllMocks();
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('AS "tokenId"')) {
        return { rowCount: 1, rows: [{ tokenId: "verification-id", userId }] };
      }
      return { rowCount: 1, rows: [] };
    });
    await expect(consumeEmailVerificationToken("B".repeat(43)))
      .resolves.toEqual({ verified: true, locale: "en" });
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("email_verified_at=COALESCE"))).toBe(true);
    expect(mocks.client.query.mock.calls.some(([sql]) =>
      String(sql).includes("UPDATE email_verification_tokens SET used_at"))).toBe(true);
  });
});

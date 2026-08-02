import { createHash } from "node:crypto";
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
    cookies: vi.fn(async () => ({
      get: vi.fn(() => ({ value: "current-private-cookie" })),
    })),
    hashPassword: vi.fn(),
    verifyPassword: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

vi.mock("@/lib/password-policy", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

import {
  changeOwnPassword,
  revokeAllOtherSessions,
  revokeOtherSession,
} from "@/lib/account-security";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.test",
  name: "Person",
  role: "AUDITOR" as const,
  accountKind: "COMPANY" as const,
  scopeType: "COMPANY" as const,
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
  authVersion: 4,
};
const oldHash = "$argon2id$existing-hash-fixture";
const replacementHash = "$argon2id$replacement-hash-fixture";

describe("personal account security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashPassword.mockResolvedValue(replacementHash);
    mocks.query.mockResolvedValue({
      rowCount: 1,
      rows: [{ passwordHash: oldHash, authVersion: 4 }],
    });
  });

  it("returns the same safe result for a wrong current password without writing", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await expect(changeOwnPassword(
      actor,
      "wrong current password",
      "a sufficiently long replacement password",
    )).resolves.toEqual({ status: "invalid_current" });
    expect(mocks.hashPassword).toHaveBeenCalledOnce();
    expect(mocks.verifyPassword).toHaveBeenCalledTimes(2);
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("rejects password reuse only after proving the current password", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    await expect(changeOwnPassword(
      actor,
      "current memorable password",
      "current memorable password",
    )).resolves.toEqual({ status: "reused" });
    expect(mocks.withAuditTransaction).not.toHaveBeenCalled();
  });

  it("stores only Argon2id output, rotates auth_version, and revokes prior sessions", async () => {
    mocks.verifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ passwordHash: oldHash, authVersion: 4 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ authVersion: 5 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });

    await expect(changeOwnPassword(
      actor,
      "current memorable password",
      "a sufficiently long replacement password",
    )).resolves.toEqual({ status: "changed", authVersion: 5 });

    const accountUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("auth_version=auth_version+1"));
    expect(accountUpdate?.[1]).toEqual([actor.id, replacementHash]);
    const credentialUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE account_credentials"));
    expect(credentialUpdate?.[1]).toEqual([actor.id, replacementHash, 5]);
    const sessionUpdate = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE user_sessions"));
    expect(String(sessionUpdate?.[0])).toContain("WHERE user_id=$1");
    expect(String(sessionUpdate?.[0])).toContain("revoked_by=$1");
    expect(String(sessionUpdate?.[0])).toContain("RETURNING id::text");
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(
      "INSERT INTO audit_logs",
    );
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain("current memorable password");
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain("sufficiently long replacement");
  });

  it("can revoke only another session belonging to the signed-in user", async () => {
    const otherSessionId = "00000000-0000-4000-8000-000000000002";
    mocks.client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ recordId: otherSessionId }] });
    await expect(revokeOtherSession(actor, otherSessionId)).resolves.toBe(true);
    const [sql, values] = mocks.client.query.mock.calls[0];
    const currentHash = createHash("sha256").update("current-private-cookie", "utf8").digest("hex");
    expect(String(sql)).toContain("id=$2 AND user_id=$1 AND token_hash<>$3");
    expect(String(sql)).toContain("revoked_by=$1");
    expect(String(sql)).toContain('RETURNING id::text AS "recordId"');
    expect(values).toEqual([actor.id, otherSessionId, currentHash]);
    expect(JSON.stringify(sql)).not.toContain("network_hash");
    expect(String(sql)).not.toContain("INSERT INTO audit_logs");
  });

  it("revokes all other sessions without matching the current cookie hash", async () => {
    mocks.client.query.mockResolvedValueOnce({ rowCount: 3, rows: [] });
    await expect(revokeAllOtherSessions(actor)).resolves.toBe(3);
    const [sql, values] = mocks.client.query.mock.calls[0];
    const currentHash = createHash("sha256").update("current-private-cookie", "utf8").digest("hex");
    expect(String(sql)).toContain("user_id=$1 AND token_hash<>$2");
    expect(String(sql)).toContain("revoked_by=$1");
    expect(String(sql)).toContain('RETURNING id::text AS "recordId"');
    expect(values).toEqual([actor.id, currentHash]);
    expect(String(sql)).not.toContain("INSERT INTO audit_logs");
  });
});

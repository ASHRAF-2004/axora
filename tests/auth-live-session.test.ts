import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { [name: string]: string } = {};
  const cookieStore = {
    get: vi.fn((name: string) => (
      state[name] ? { value: state[name] } : undefined
    )),
    set: vi.fn((name: string, value: string) => {
      state[name] = value;
    }),
    delete: vi.fn((name: string) => {
      delete state[name];
    }),
  };
  return {
    state,
    cookieStore,
    cookies: vi.fn(async () => cookieStore),
    query: vi.fn(),
    redirect: vi.fn((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    }),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/route-authorization", () => ({
  resolveEffectiveRoutePermissions: vi.fn(async () => []),
}));

import {
  clearSession,
  getAccountLifecycleSession,
  getSession,
  requirePermission,
  requireSession,
  setSession,
} from "@/lib/auth";
import { REQUIRED_POLICY_VERSION } from "@/lib/onboarding-policy";

const userId = "00000000-0000-4000-8000-000000000001";
const companyId = "10000000-0000-4000-8000-000000000001";
const assignmentId = "20000000-0000-4000-8000-000000000001";

function activeIdentity(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    email: "person@example.test",
    displayName: "Person",
    legacyRole: "VIEWER",
    accountKind: "COMPANY",
    isOwner: false,
    authVersion: 7,
    profileCompletedAt: "2026-08-02T00:00:00.000Z",
    requiredPolicyVersion: REQUIRED_POLICY_VERSION,
    requiredPolicyAcceptedAt: "2026-08-02T00:00:00.000Z",
    legacyCompanyId: companyId,
    legacyCompanyActive: true,
    legacyCompanyMembershipStatus: "ACTIVE",
    assignmentId,
    assignedRole: "AUDITOR",
    assignmentActive: true,
    assignedAt: "2026-08-01T00:00:00.000Z",
    scopeType: "COMPANY",
    companyId,
    scopeCompanyActive: true,
    companyMembershipStatus: "ACTIVE",
    companyMembershipPrimary: true,
    ...overrides,
  };
}

async function mintSession() {
  mocks.query
    .mockResolvedValueOnce({ rows: [activeIdentity()] })
    .mockResolvedValueOnce({ rowCount: 1, rows: [] });
  await setSession({
    id: userId,
    email: "stale-address@example.test",
    name: "Stale name",
    role: "VIEWER",
    companyId,
    isOwner: false,
    authVersion: 7,
  });
  return mocks.state.axora_session!;
}

describe("database-bound sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mocks.state.axora_session;
    delete mocks.state.axora_stepup;
    delete process.env.SESSION_SECRET_FILE;
    process.env.SESSION_SECRET = "test-only-session-secret-with-at-least-32-characters";
  });






  it("stores only a hash and requires the same live session on every read", async () => {
    const token = await mintSession();
    const expectedHash = createHash("sha256").update(token, "utf8").digest("hex");

    const [insertSql, insertValues] = mocks.query.mock.calls[1];
    expect(String(insertSql)).toContain("INSERT INTO user_sessions");
    expect(insertValues).toEqual([userId, expectedHash]);
    expect(String(insertValues[1])).not.toContain(token);
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "axora_session",
      token,
      expect.objectContaining({ httpOnly: true, sameSite: "strict", maxAge: 28_800 }),
    );

    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [activeIdentity()] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(getSession()).resolves.toMatchObject({
      id: userId,
      role: "AUDITOR",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId,
      roleAssignmentId: assignmentId,
      authVersion: 7,
    });
    const [liveSql, liveValues] = mocks.query.mock.calls[0];
    expect(String(liveSql)).toContain("FROM user_sessions live_session");
    expect(String(liveSql)).toContain("live_session.revoked_at IS NULL");
    expect(String(liveSql)).toContain("live_session.expires_at > now()");
    expect(String(liveSql)).toContain(
      "public.axora_auth_department_scope(\n      account.id,assignment.id",
    );
    expect(String(liveSql)).not.toContain("JOIN departments");
    expect(String(liveSql)).not.toContain("JOIN department_assignments");
    expect(liveValues).toEqual([userId, expectedHash]);
    expect(String(mocks.query.mock.calls[1][0])).toContain("last_seen_at=now()");
  });

  it("rejects a revoked or expired server-side session", async () => {
    await mintSession();
    mocks.query.mockReset();
    // The identity query's EXISTS clause filters an absent, expired, or revoked
    // user_sessions row before any role data can become a session.
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(getSession()).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a still-signed cookie after its live role or scope changes", async () => {
    await mintSession();
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({
      rows: [activeIdentity({
        legacyRole: "FINANCE",
        assignedRole: "FINANCE_REVIEWER",
        assignmentId: "20000000-0000-4000-8000-000000000002",
      })],
    });

    await expect(getSession()).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("rejects a cookie after auth_version changes", async () => {
    await mintSession();
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [activeIdentity({ authVersion: 8 })] });

    await expect(getSession()).resolves.toBeNull();
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("denies incomplete onboarding through API and action authorization while keeping the narrow lifecycle path usable", async () => {
    await mintSession();
    const incomplete = activeIdentity({
      profileCompletedAt: undefined,
      requiredPolicyVersion: undefined,
      requiredPolicyAcceptedAt: undefined,
    });

    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [incomplete] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(getSession()).resolves.toBeNull();

    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [incomplete] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(getAccountLifecycleSession()).resolves.toMatchObject({
      id: userId,
      companyId,
      role: "AUDITOR",
    });

    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [incomplete] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(requireSession()).rejects.toThrow("REDIRECT:/profile?onboarding=1");

    mocks.query.mockReset();
    mocks.query
      .mockResolvedValueOnce({ rows: [incomplete] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(requirePermission("view_audit"))
      .rejects.toThrow("REDIRECT:/profile?onboarding=1");
  });

  it("requires the live server policy version and acceptance timestamp", async () => {
    await mintSession();
    for (const profileState of [
      { requiredPolicyVersion: "browser-forged-version" },
      { requiredPolicyAcceptedAt: undefined },
    ]) {
      mocks.query.mockReset();
      mocks.query
        .mockResolvedValueOnce({ rows: [activeIdentity(profileState)] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [] });
      await expect(getSession()).resolves.toBeNull();
    }
  });

  it("revokes the durable session and removes the cookie on sign out", async () => {
    const token = await mintSession();
    const expectedHash = createHash("sha256").update(token, "utf8").digest("hex");
    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await clearSession();

    expect(String(mocks.query.mock.calls[0][0])).toContain("revoke_reason");
    expect(String(mocks.query.mock.calls[0][0])).toContain(
      "revoked_by=COALESCE(revoked_by,user_id)",
    );
    expect(mocks.query.mock.calls[0][1]).toEqual([expectedHash]);
    expect(mocks.cookieStore.delete).toHaveBeenCalledWith("axora_session");
    expect(mocks.state.axora_session).toBeUndefined();
  });
});

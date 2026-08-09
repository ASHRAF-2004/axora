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

import {
  completeMyProfile,
  myProfileMeetsRequiredOnboarding,
  type MyProfile,
} from "@/lib/profile";
import { REQUIRED_POLICY_VERSION } from "@/lib/onboarding-policy";
import type { SessionUser } from "@/lib/auth";

const actor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "onboarding@example.test",
  name: "Onboarding User",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
  isOwner: false,
  authVersion: 1,
};

const completeProfile: MyProfile = {
  userId: actor.id,
  email: actor.email,
  displayName: actor.name,
  jobTitle: "Requester",
  phone: "",
  preferredLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
  avatarAvailable: false,
  emailNotifications: true,
  inAppNotifications: true,
  profileCompletedAt: "2026-08-02T00:00:00.000Z",
  requiredPolicyVersion: REQUIRED_POLICY_VERSION,
  requiredPolicyAcceptedAt: "2026-08-02T00:00:00.000Z",
  accountStatus: "ACTIVE",
};

describe("server-authoritative onboarding policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [] });
  });

  it("requires profile completion, the current server version, and an acceptance timestamp", () => {
    expect(myProfileMeetsRequiredOnboarding(completeProfile)).toBe(true);
    expect(myProfileMeetsRequiredOnboarding({
      ...completeProfile,
      requiredPolicyVersion: "older-policy",
    })).toBe(false);
    expect(myProfileMeetsRequiredOnboarding({
      ...completeProfile,
      requiredPolicyAcceptedAt: undefined,
    })).toBe(false);
    expect(myProfileMeetsRequiredOnboarding({
      ...completeProfile,
      profileCompletedAt: undefined,
    })).toBe(false);
  });

  it("ignores a browser-supplied policy version and records only the server version", async () => {
    await completeMyProfile({
      displayName: "Onboarding User",
      jobTitle: "Requester",
      phone: "",
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
      emailNotifications: true,
      inAppNotifications: false,
      policyAccepted: true,
      // Deliberately simulate an extra field supplied by a forged form.
      policyVersion: "browser-forged-version",
    } as Parameters<typeof completeMyProfile>[0], actor);

    const [profileSql, profileValues] = mocks.client.query.mock.calls[0];
    expect(String(profileSql)).toContain("required_policy_version=$9");
    expect(String(profileSql)).toContain("required_policy_version IS DISTINCT FROM $9");
    expect(profileValues[7]).toBe(true);
    expect(profileValues[8]).toBe(REQUIRED_POLICY_VERSION);
    expect(profileValues).not.toContain("browser-forged-version");
  });
});

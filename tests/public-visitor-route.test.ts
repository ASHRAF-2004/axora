import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(),
  buildIdentity: vi.fn(),
  buildRateScope: vi.fn(),
  claim: vi.fn(),
  consumeRateLimit: vi.fn(),
  createCookie: vi.fn(),
  getSnapshot: vi.fn(),
  readCookie: vi.fn(),
  verifyTurnstile: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/db", async () => ({
  ...(await vi.importActual<typeof import("@/lib/db")>("@/lib/db")),
  isDemoMode: mocks.isDemoMode,
}));

vi.mock("@/lib/public-visitor-counter", async () => ({
  ...(await vi.importActual<typeof import("@/lib/public-visitor-counter")>("@/lib/public-visitor-counter")),
  buildVisitorIdentity: mocks.buildIdentity,
  buildVisitorRateLimitScope: mocks.buildRateScope,
  claimPublicVisitor: mocks.claim,
  consumeVisitorClaimRateLimit: mocks.consumeRateLimit,
  createVisitorClaimCookie: mocks.createCookie,
  getPublicVisitorSnapshot: mocks.getSnapshot,
  readVisitorClaimCookie: mocks.readCookie,
}));

vi.mock("@/lib/turnstile", async () => ({
  ...(await vi.importActual<typeof import("@/lib/turnstile")>("@/lib/turnstile")),
  verifyTurnstileVisitorChoice: mocks.verifyTurnstile,
}));

vi.mock("@/lib/auth", () => ({
  getAccountLifecycleSession: mocks.getSession,
}));

import { GET, POST } from "@/app/api/public/visitor-choice/route";
import { GET as GET_RETIRED_STREAM } from "@/app/api/public/visitor-choice/stream/route";
import { VisitorClaimRateLimitError } from "@/lib/public-visitor-counter";
import { TurnstileVerificationError } from "@/lib/turnstile";

const tokenHash = "a".repeat(64);
const rateScope = {
  networkBucketHash: "b".repeat(64),
  bucketStartedAt: new Date("2026-08-15T01:00:00.000Z"),
};
const unclaimed = { version: 12, totalCount: 12, earlyBirdCount: 7, nightOwlCount: 5 };
const claimed = {
  version: 13,
  totalCount: 13,
  earlyBirdCount: 8,
  nightOwlCount: 5,
  visitorNumber: 13,
  choice: "EARLY_BIRD" as const,
  claimedNew: true,
};

function postRequest(body: unknown, options: { origin?: string; contentType?: string; cookie?: string } = {}) {
  const headers = new Headers({
    Origin: options.origin ?? "https://axora.management",
    "Content-Type": options.contentType ?? "application/json",
    "CF-Connecting-IP": "203.0.113.8",
  });
  if (options.cookie) headers.set("Cookie", `axora_visitor_claim=${options.cookie}`);
  return new NextRequest("https://axora.management/api/public/visitor-choice", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("public visitor-choice endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.getSession.mockResolvedValue(null);
    mocks.readCookie.mockImplementation((value: string | undefined) => {
      if (value === "valid-cookie") {
        return { value: "v2.valid-cookie.signature", tokenHash, needsRotation: false };
      }
      if (value === "legacy-cookie") {
        return { value: "v2.rotated-cookie.signature", tokenHash, needsRotation: true };
      }
      return undefined;
    });
    mocks.createCookie.mockReturnValue({
      value: "v2.new-cookie.signature",
      tokenHash,
      needsRotation: false,
    });
    mocks.buildIdentity.mockReturnValue({ tokenHash });
    mocks.buildRateScope.mockReturnValue(rateScope);
    mocks.getSnapshot.mockResolvedValue(unclaimed);
    mocks.consumeRateLimit.mockResolvedValue(undefined);
    mocks.verifyTurnstile.mockResolvedValue({
      success: true,
      challengeTimestamp: new Date().toISOString(),
      hostname: "axora.management",
      action: "visitor_choice",
      ephemeralId: "x:verified-device",
    });
    mocks.claim.mockResolvedValue(claimed);
  });

  it("returns a versioned private snapshot using only cookie identity", async () => {
    const response = await GET(new NextRequest("https://axora.management/api/public/visitor-choice", {
      headers: { "CF-Connecting-IP": "203.0.113.8", Cookie: "axora_visitor_claim=valid-cookie" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...unclaimed, eligible: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.buildIdentity).toHaveBeenCalledWith({
      cookieValue: "v2.valid-cookie.signature",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rotates a valid legacy cookie without changing its claim identity", async () => {
    const response = await GET(new NextRequest("https://axora.management/api/public/visitor-choice", {
      headers: { Cookie: "axora_visitor_claim=legacy-cookie" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("axora_visitor_claim=v2.rotated-cookie.signature");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("verifies and atomically records one same-origin cookie claim", async () => {
    const response = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "verified-turnstile-token",
    }, { cookie: "valid-cookie" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claimed);
    expect(mocks.createCookie).not.toHaveBeenCalled();
    expect(mocks.buildRateScope).toHaveBeenCalledWith("203.0.113.8");
    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(rateScope);
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith({
      token: "verified-turnstile-token",
      remoteIp: "203.0.113.8",
    });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      identity: { tokenHash },
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileHostname: "axora.management",
    }));
    expect(mocks.claim.mock.calls[0]?.[0].identity).not.toHaveProperty("networkHash");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rejects authenticated and privacy-ineligible requests before identity work", async () => {
    mocks.getSession.mockResolvedValueOnce({ userId: "authenticated-fixture" });
    const authenticatedGet = await GET(new NextRequest("https://axora.management/api/public/visitor-choice"));
    expect(authenticatedGet.status).toBe(200);
    await expect(authenticatedGet.json()).resolves.toEqual({ eligible: false });

    mocks.getSession.mockResolvedValueOnce({ userId: "authenticated-fixture" });
    const authenticatedPost = await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "token" }));
    expect(authenticatedPost.status).toBe(403);

    const privacyGet = await GET(new NextRequest("https://axora.management/api/public/visitor-choice", {
      headers: { DNT: "1" },
    }));
    await expect(privacyGet.json()).resolves.toEqual({ eligible: false });
    expect(mocks.readCookie).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("retires EventSource without a reconnecting 429 and blocks ineligible callers", async () => {
    const retired = await GET_RETIRED_STREAM(new NextRequest(
      "https://axora.management/api/public/visitor-choice/stream",
    ));
    expect(retired.status).toBe(204);
    expect(retired.headers.get("x-axora-near-live-transport")).toBe("visibility-aware-polling");

    mocks.getSession.mockResolvedValueOnce({ userId: "authenticated-fixture" });
    const authenticated = await GET_RETIRED_STREAM(new NextRequest(
      "https://axora.management/api/public/visitor-choice/stream",
    ));
    expect(authenticated.status).toBe(403);
  });

  it("fails closed when Turnstile rejects", async () => {
    mocks.verifyTurnstile.mockRejectedValueOnce(new TurnstileVerificationError());
    const response = await POST(postRequest({ choice: "NIGHT_OWL", locale: "ms", turnstileToken: "invalid-token" }));
    expect(response.status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, malformed, extra-field, and wrong-media claims", async () => {
    expect((await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "token" }, { origin: "https://attacker.example" }))).status).toBe(403);
    expect((await POST(postRequest("not-json"))).status).toBe(400);
    expect((await POST(postRequest({ choice: "UNSUPPORTED", locale: "en", turnstileToken: "token" }))).status).toBe(400);
    expect((await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "token", clientSignal: "fingerprint" }))).status).toBe(400);
    expect((await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "token" }, { contentType: "text/plain" }))).status).toBe(415);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("returns a bounded generic rate limit before verification or persistence", async () => {
    mocks.consumeRateLimit.mockRejectedValueOnce(new VisitorClaimRateLimitError());
    const response = await POST(postRequest({ choice: "EARLY_BIRD", locale: "ar", turnstileToken: "token" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    await expect(response.json()).resolves.toEqual({ error: "Too many attempts. Please try again later." });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("fails closed in demo mode and after unexpected persistence errors", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    expect((await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "token" }))).status).toBe(503);
    mocks.claim.mockRejectedValueOnce(new Error("private database detail"));
    const failed = await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "verified-turnstile-token" }));
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ error: "Visitor claiming is temporarily unavailable." });
  });
});

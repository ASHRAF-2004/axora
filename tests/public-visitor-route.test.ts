import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(),
  buildIdentity: vi.fn(),
  claim: vi.fn(),
  consumeRateLimit: vi.fn(),
  createCookie: vi.fn(),
  getSnapshot: vi.fn(),
  tokenHashFromCookie: vi.fn(),
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
  claimPublicVisitor: mocks.claim,
  consumeVisitorClaimRateLimit: mocks.consumeRateLimit,
  createVisitorClaimCookie: mocks.createCookie,
  getPublicVisitorSnapshot: mocks.getSnapshot,
  visitorTokenHashFromCookie: mocks.tokenHashFromCookie,
}));

vi.mock("@/lib/turnstile", async () => ({
  ...(await vi.importActual<typeof import("@/lib/turnstile")>("@/lib/turnstile")),
  verifyTurnstileVisitorChoice: mocks.verifyTurnstile,
}));

vi.mock("@/lib/auth", () => ({
  getAccountLifecycleSession: mocks.getSession,
}));

import { GET, POST } from "@/app/api/public/visitor-choice/route";
import { VisitorClaimRateLimitError } from "@/lib/public-visitor-counter";
import { TurnstileVerificationError } from "@/lib/turnstile";

const tokenHash = "a".repeat(64);
const networkHash = "b".repeat(64);
const unclaimed = { totalCount: 12, earlyBirdCount: 7, nightOwlCount: 5 };
const claimed = { totalCount: 13, earlyBirdCount: 8, nightOwlCount: 5, visitorNumber: 13, choice: "EARLY_BIRD" as const, claimedNew: true };

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
    mocks.tokenHashFromCookie.mockImplementation((value: string | undefined) => value === "valid-cookie" ? tokenHash : undefined);
    mocks.createCookie.mockReturnValue({ value: "v1.new-cookie.signature", tokenHash });
    mocks.buildIdentity.mockImplementation(() => ({
      tokenHash,
      networkHash,
    }));
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

  it("returns a private no-store snapshot without collecting a browser fingerprint", async () => {
    const response = await GET(new NextRequest("https://axora.management/api/public/visitor-choice", {
      headers: { "CF-Connecting-IP": "203.0.113.8", Cookie: "axora_visitor_claim=valid-cookie" },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...unclaimed, eligible: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.buildIdentity).toHaveBeenCalledWith({ cookieValue: "valid-cookie", remoteIp: "203.0.113.8" });
    expect(response.headers.get("set-cookie")).toContain("axora_visitor_claim=valid-cookie");
  });

  it("verifies and atomically records one same-origin choice", async () => {
    const response = await POST(postRequest({ choice: "EARLY_BIRD", locale: "en", turnstileToken: "verified-turnstile-token" }, { cookie: "valid-cookie" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claimed);
    expect(mocks.createCookie).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledOnce();
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith({ token: "verified-turnstile-token", remoteIp: "203.0.113.8" });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({ tokenHash, networkHash }),
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileHostname: "axora.management",
    }));
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rejects authenticated and privacy-ineligible visitor claims before identity work", async () => {
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
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("fails closed when Turnstile rejects instead of using an unauthenticated fallback", async () => {
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

  it("returns a generic rate limit before verification or persistence", async () => {
    mocks.consumeRateLimit.mockRejectedValueOnce(new VisitorClaimRateLimitError());
    const response = await POST(postRequest({ choice: "EARLY_BIRD", locale: "ar", turnstileToken: "token" }));
    expect(response.status).toBe(429);
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

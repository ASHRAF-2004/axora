import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDemoMode: vi.fn(),
  buildIdentity: vi.fn(),
  claim: vi.fn(),
  claimFallback: vi.fn(),
  consumeRateLimit: vi.fn(),
  createCookie: vi.fn(),
  createFallbackCookie: vi.fn(),
  getSnapshot: vi.fn(),
  tokenHashFromCookie: vi.fn(),
  verifyFallbackCookie: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db")>(
    "@/lib/db",
  );
  return {
    ...actual,
    isDemoMode: mocks.isDemoMode,
  };
});

vi.mock("@/lib/public-visitor-counter", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/public-visitor-counter")
  >("@/lib/public-visitor-counter");
  return {
    ...actual,
    buildVisitorIdentity: mocks.buildIdentity,
    claimPublicVisitor: mocks.claim,
    consumeVisitorClaimRateLimit: mocks.consumeRateLimit,
    createVisitorClaimCookie: mocks.createCookie,
    getPublicVisitorSnapshot: mocks.getSnapshot,
    visitorTokenHashFromCookie: mocks.tokenHashFromCookie,
  };
});

vi.mock("@/lib/public-visitor-fallback", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/public-visitor-fallback")
  >("@/lib/public-visitor-fallback");
  return {
    ...actual,
    claimPublicVisitorFallback: mocks.claimFallback,
    createVisitorFallbackCookie: mocks.createFallbackCookie,
    verifyVisitorFallbackCookie: mocks.verifyFallbackCookie,
  };
});

vi.mock("@/lib/turnstile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/turnstile")>(
    "@/lib/turnstile",
  );
  return {
    ...actual,
    verifyTurnstileVisitorChoice: mocks.verifyTurnstile,
  };
});

import { GET, POST } from "@/app/api/public/visitor-choice/route";
import {
  VisitorClaimRateLimitError,
} from "@/lib/public-visitor-counter";
import { TurnstileVerificationError } from "@/lib/turnstile";

const hashes = {
  token: "a".repeat(64),
  network: "b".repeat(64),
  networkDevice: "c".repeat(64),
  clientSignal: "d".repeat(64),
  turnstileDevice: "e".repeat(64),
};

const unclaimed = {
  totalCount: 12,
  earlyBirdCount: 7,
  nightOwlCount: 5,
};

const claimed = {
  totalCount: 13,
  earlyBirdCount: 8,
  nightOwlCount: 5,
  visitorNumber: 13,
  choice: "EARLY_BIRD" as const,
  claimedNew: true,
};

function postRequest(
  body: unknown,
  options: {
    origin?: string;
    contentType?: string;
    cookie?: string;
    fallbackCookie?: string;
  } = {},
) {
  const headers = new Headers({
    Origin: options.origin ?? "https://axora.management",
    "Content-Type": options.contentType ?? "application/json",
    "CF-Connecting-IP": "203.0.113.8",
  });
  const cookies = [
    ...(options.cookie
      ? [`axora_visitor_claim=${options.cookie}`]
      : []),
    ...(options.fallbackCookie
      ? [`axora_visitor_fallback=${options.fallbackCookie}`]
      : []),
  ];
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  return new NextRequest(
    "https://axora.management/api/public/visitor-choice",
    {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

describe("public visitor-choice endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoMode.mockReturnValue(false);
    mocks.tokenHashFromCookie.mockImplementation(
      (value: string | undefined) => value === "valid-cookie"
        ? hashes.token
        : undefined,
    );
    mocks.createCookie.mockReturnValue({
      value: "v1.new-cookie.signature",
      tokenHash: hashes.token,
    });
    mocks.createFallbackCookie.mockReturnValue(
      "v1.signed-network-device-fallback",
    );
    mocks.verifyFallbackCookie.mockReturnValue(false);
    mocks.buildIdentity.mockImplementation((input: {
      ephemeralId?: string;
    }) => ({
      tokenHash: hashes.token,
      networkHash: hashes.network,
      networkDeviceHash: hashes.networkDevice,
      clientSignalHash: hashes.clientSignal,
      ...(input.ephemeralId
        ? { turnstileDeviceHash: hashes.turnstileDevice }
        : {}),
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
    mocks.claimFallback.mockResolvedValue(claimed);
  });

  it("returns a private no-store snapshot and issues a short-lived fallback cookie", async () => {
    const request = new NextRequest(
      "https://axora.management/api/public/visitor-choice",
      {
        headers: {
          "CF-Connecting-IP": "203.0.113.8",
          "X-Axora-Visitor-Signal": hashes.clientSignal,
          Cookie: "axora_visitor_claim=valid-cookie",
        },
      },
    );

    const response = await GET(request);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(unclaimed);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toContain(
      "X-Axora-Visitor-Signal",
    );
    expect(mocks.buildIdentity).toHaveBeenCalledWith({
      cookieValue: "valid-cookie",
      remoteIp: "203.0.113.8",
      clientSignal: hashes.clientSignal,
    });
    expect(mocks.getSnapshot).toHaveBeenCalledOnce();
    expect(mocks.createFallbackCookie).toHaveBeenCalledWith(
      hashes.networkDevice,
    );
    expect(response.headers.get("set-cookie")).toContain(
      "axora_visitor_fallback=v1.signed-network-device-fallback",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("verifies and records one same-origin choice using the existing signed cookie", async () => {
    const response = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "verified-turnstile-token",
      clientSignal: hashes.clientSignal,
    }, { cookie: "valid-cookie" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claimed);
    expect(mocks.createCookie).not.toHaveBeenCalled();
    expect(mocks.consumeRateLimit).toHaveBeenCalledOnce();
    expect(mocks.verifyTurnstile).toHaveBeenCalledWith({
      token: "verified-turnstile-token",
      remoteIp: "203.0.113.8",
    });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        tokenHash: hashes.token,
        turnstileDeviceHash: hashes.turnstileDevice,
      }),
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileHostname: "axora.management",
    }));
    expect(mocks.claimFallback).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain(
      "axora_visitor_claim=valid-cookie",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("records through the signed network-device fallback when Siteverify rejects", async () => {
    mocks.verifyTurnstile.mockRejectedValueOnce(
      new TurnstileVerificationError(),
    );
    mocks.verifyFallbackCookie.mockReturnValueOnce(true);

    const response = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "provider-rejected-token",
      clientSignal: hashes.clientSignal,
    }, {
      cookie: "valid-cookie",
      fallbackCookie: "signed-fallback-cookie",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(claimed);
    expect(mocks.verifyFallbackCookie).toHaveBeenCalledWith(
      "signed-fallback-cookie",
      hashes.networkDevice,
    );
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.claimFallback).toHaveBeenCalledWith({
      identity: expect.objectContaining({
        tokenHash: hashes.token,
        networkHash: hashes.network,
        networkDeviceHash: hashes.networkDevice,
        clientSignalHash: hashes.clientSignal,
      }),
      choice: "EARLY_BIRD",
      locale: "en",
    });
    expect(response.headers.get("set-cookie")).toContain(
      "axora_visitor_claim=valid-cookie",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "axora_visitor_fallback=;",
    );
  });

  it("rejects cross-origin, malformed, and unverified claims without counting", async () => {
    expect((await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "token",
    }, { origin: "https://attacker.example" }))).status).toBe(403);

    expect((await POST(postRequest("not-json"))).status).toBe(400);
    expect((await POST(postRequest({
      choice: "UNSUPPORTED",
      locale: "en",
      turnstileToken: "token",
    }))).status).toBe(400);
    expect((await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "token",
    }, { contentType: "text/plain" }))).status).toBe(415);

    mocks.verifyTurnstile.mockRejectedValueOnce(
      new TurnstileVerificationError(),
    );
    expect((await POST(postRequest({
      choice: "NIGHT_OWL",
      locale: "ms",
      turnstileToken: "invalid-token",
      clientSignal: hashes.clientSignal,
    }))).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.claimFallback).not.toHaveBeenCalled();
  });

  it("returns a generic limit response before Turnstile and persistence", async () => {
    mocks.consumeRateLimit.mockRejectedValueOnce(
      new VisitorClaimRateLimitError(),
    );
    const response = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "ar",
      turnstileToken: "token",
    }));
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Too many attempts. Please try again later.",
    });
    expect(mocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.claimFallback).not.toHaveBeenCalled();
  });

  it("fails closed in demo mode or after an unexpected persistence error", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    const demo = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "token",
    }));
    expect(demo.status).toBe(503);

    mocks.claim.mockRejectedValueOnce(new Error("private database detail"));
    const failed = await POST(postRequest({
      choice: "EARLY_BIRD",
      locale: "en",
      turnstileToken: "verified-turnstile-token",
    }));
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({
      error: "Visitor claiming is temporarily unavailable.",
    });
  });
});

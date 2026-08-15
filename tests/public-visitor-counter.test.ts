import { createHmac } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  buildVisitorIdentity,
  buildVisitorRateLimitScope,
  createVisitorClaimCookie,
  normalizedPublicNetworkIdentifier,
  readVisitorClaimCookie,
  VISITOR_CLAIM_COOKIE_MAX_AGE,
  visitorTokenHashFromCookie,
} from "@/lib/public-visitor-counter";
import { publicVisitorCopy } from "@/lib/public-visitor-copy";
import {
  TurnstileVerificationError,
  verifyTurnstileVisitorChoice,
} from "@/lib/turnstile";

const sessionSecret = "visitor-test-secret-".repeat(4);
const originalEnvironment = {
  sessionSecret: process.env.SESSION_SECRET,
  sessionSecretFile: process.env.SESSION_SECRET_FILE,
  turnstileSecret: process.env.TURNSTILE_SECRET,
  turnstileSecretFile: process.env.TURNSTILE_SECRET_FILE,
  turnstileHostnames: process.env.TURNSTILE_HOSTNAMES,
};

describe("public visitor identity", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = sessionSecret;
    delete process.env.SESSION_SECRET_FILE;
    process.env.TURNSTILE_SECRET = "turnstile-test-secret-".repeat(3);
    delete process.env.TURNSTILE_SECRET_FILE;
    process.env.TURNSTILE_HOSTNAMES = "axora.management";
  });

  afterAll(() => {
    for (const [key, value] of Object.entries({
      SESSION_SECRET: originalEnvironment.sessionSecret,
      SESSION_SECRET_FILE: originalEnvironment.sessionSecretFile,
      TURNSTILE_SECRET: originalEnvironment.turnstileSecret,
      TURNSTILE_SECRET_FILE: originalEnvironment.turnstileSecretFile,
      TURNSTILE_HOSTNAMES: originalEnvironment.turnstileHostnames,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("signs a versioned opaque cookie, rejects tampering, and bounds its lifetime", () => {
    const claim = createVisitorClaimCookie();
    expect(claim.value).toMatch(/^v2\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(claim.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(claim.needsRotation).toBe(false);
    expect(visitorTokenHashFromCookie(claim.value)).toBe(claim.tokenHash);
    expect(VISITOR_CLAIM_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);

    const parts = claim.value.split(".");
    const signature = parts[2];
    if (!signature) throw new Error("The test cookie signature is missing.");
    parts[2] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    expect(readVisitorClaimCookie(parts.join("."))).toBeUndefined();
    expect(readVisitorClaimCookie("not-a-cookie")).toBeUndefined();
  });

  it("rotates a valid v1 cookie in place without changing its claim identity", () => {
    const rawToken = Buffer.alloc(32, 7).toString("base64url");
    const legacySignature = createHmac("sha256", sessionSecret)
      .update("axora-public-visitor-cookie-v1\0", "utf8")
      .update(rawToken, "utf8")
      .digest("base64url");
    const legacyValue = `v1.${rawToken}.${legacySignature}`;

    const verified = readVisitorClaimCookie(legacyValue);
    expect(verified).toMatchObject({ needsRotation: true });
    expect(verified?.value).toMatch(/^v2\./);
    expect(visitorTokenHashFromCookie(verified?.value)).toBe(verified?.tokenHash);
  });

  it("uses only the signed claim cookie as durable identity", () => {
    const cookie = createVisitorClaimCookie();
    const first = buildVisitorIdentity({ cookieValue: cookie.value });
    const repeated = buildVisitorIdentity({ cookieValue: cookie.value });

    expect(first).toEqual(repeated);
    expect(first).toEqual({ tokenHash: cookie.tokenHash });
    expect(Object.keys(first)).toEqual(["tokenHash"]);
  });

  it("rotates the network abuse bucket each hour without exposing the address", () => {
    expect(normalizedPublicNetworkIdentifier("203.0.113.8")).toBe("203.0.113.8");
    expect(normalizedPublicNetworkIdentifier("2001:0DB8:0:0::1")).toBe("2001:db8::1");

    const first = buildVisitorRateLimitScope(
      "203.0.113.8",
      new Date("2026-08-15T01:05:00.000Z"),
    );
    const sameHour = buildVisitorRateLimitScope(
      "203.0.113.8",
      new Date("2026-08-15T01:59:59.000Z"),
    );
    const nextHour = buildVisitorRateLimitScope(
      "203.0.113.8",
      new Date("2026-08-15T02:00:00.000Z"),
    );

    expect(first).toEqual(sameHour);
    expect(first.networkBucketHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.networkBucketHash).not.toContain("203.0.113.8");
    expect(nextHour.networkBucketHash).not.toBe(first.networkBucketHash);
    expect(first.bucketStartedAt?.toISOString()).toBe("2026-08-15T01:00:00.000Z");
  });

  it("ignores malformed or unavailable network input for abuse control", () => {
    expect(normalizedPublicNetworkIdentifier("not-an-ip")).toBeUndefined();
    expect(buildVisitorRateLimitScope("not-an-ip")).toEqual({});
    expect(buildVisitorIdentity({})).toEqual({});
  });

  it("describes browser-cookie persistence honestly in English, Arabic, and Malay", () => {
    for (const copy of Object.values(publicVisitorCopy)) {
      const disclosure = `${copy.eyebrow} ${copy.body} ${copy.privacy}`;
      expect(disclosure).toMatch(/cookie|ارتباط|kuki/i);
      expect(disclosure).not.toMatch(/one public network can hold|يمكن لكل شبكة عامة حجز|satu rangkaian awam boleh memegang|retains a permanent keyed hash|تحتفظ أكسورا ببصمة دائمة|menyimpan cincangan berkunci kekal/i);
    }
  });

  it("validates the dedicated visitor-choice Turnstile action", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      success: true,
      challenge_ts: new Date().toISOString(),
      hostname: "axora.management",
      action: "visitor_choice",
      metadata: { ephemeral_id: "x:visitor-test-ephemeral" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(verifyTurnstileVisitorChoice({
      token: "valid-test-token",
      remoteIp: "203.0.113.8",
      fetcher,
    })).resolves.toMatchObject({
      success: true,
      hostname: "axora.management",
      action: "visitor_choice",
      ephemeralId: "x:visitor-test-ephemeral",
    });
  });

  it("rejects a valid token issued for another Turnstile action", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      success: true,
      challenge_ts: new Date().toISOString(),
      hostname: "axora.management",
      action: "contact",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    await expect(verifyTurnstileVisitorChoice({
      token: "wrong-action-token",
      fetcher,
    })).rejects.toBeInstanceOf(TurnstileVerificationError);
  });
});

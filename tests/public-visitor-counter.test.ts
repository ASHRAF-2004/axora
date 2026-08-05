import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  buildVisitorIdentity,
  createVisitorClaimCookie,
  normalizedPublicNetworkIdentifier,
  visitorTokenHashFromCookie,
} from "@/lib/public-visitor-counter";
import {
  TurnstileVerificationError,
  verifyTurnstileVisitorChoice,
} from "@/lib/turnstile";

const originalEnvironment = {
  sessionSecret: process.env.SESSION_SECRET,
  sessionSecretFile: process.env.SESSION_SECRET_FILE,
  turnstileSecret: process.env.TURNSTILE_SECRET,
  turnstileSecretFile: process.env.TURNSTILE_SECRET_FILE,
  turnstileHostnames: process.env.TURNSTILE_HOSTNAMES,
};

describe("public visitor identity", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "visitor-test-secret-".repeat(4);
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

  it("signs the first-party claim cookie and rejects tampering", () => {
    const claim = createVisitorClaimCookie();
    expect(claim.value).toMatch(/^v1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
    expect(claim.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(visitorTokenHashFromCookie(claim.value)).toBe(claim.tokenHash);

    const lastCharacter = claim.value.at(-1);
    const tampered = `${claim.value.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;
    expect(visitorTokenHashFromCookie(tampered)).toBeUndefined();
    expect(visitorTokenHashFromCookie("not-a-cookie")).toBeUndefined();
  });

  it("retains only domain-separated irreversible identity fingerprints", () => {
    const cookie = createVisitorClaimCookie();
    const first = buildVisitorIdentity({
      cookieValue: cookie.value,
      remoteIp: "203.0.113.42",
      clientSignal: "a".repeat(64),
      ephemeralId: "x:visitor-test-ephemeral",
    });
    const repeated = buildVisitorIdentity({
      cookieValue: cookie.value,
      remoteIp: "203.0.113.42",
      clientSignal: "a".repeat(64),
      ephemeralId: "x:visitor-test-ephemeral",
    });

    expect(first).toEqual(repeated);
    for (const value of Object.values(first)) {
      expect(value).toMatch(/^[0-9a-f]{64}$/);
      expect(value).not.toContain("203.0.113.42");
    }
    expect(first.networkDeviceHash).not.toBe(first.networkHash);
    expect(first.turnstileDeviceHash).not.toBe(first.clientSignalHash);
  });

  it("ignores malformed or unavailable network and browser signals", () => {
    expect(normalizedPublicNetworkIdentifier("203.0.113.8")).toBe(
      "203.0.113.8",
    );
    expect(normalizedPublicNetworkIdentifier("not-an-ip")).toBeUndefined();
    expect(buildVisitorIdentity({
      remoteIp: "not-an-ip",
      clientSignal: "not-a-hash",
      ephemeralId: "invalid",
    })).toEqual({});
  });

  it("validates the dedicated visitor-choice Turnstile action", async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      success: true,
      challenge_ts: new Date().toISOString(),
      hostname: "axora.management",
      action: "visitor_choice",
      metadata: {
        ephemeral_id: "x:visitor-test-ephemeral",
      },
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

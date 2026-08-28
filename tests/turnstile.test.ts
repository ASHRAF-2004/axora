import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TurnstileVerificationError, verifyTurnstileContact } from "../src/lib/turnstile";

const originalSecret = process.env.TURNSTILE_SECRET;
const originalHostnames = process.env.TURNSTILE_HOSTNAMES;

beforeEach(() => {
  process.env.TURNSTILE_SECRET = "test-secret-with-more-than-thirty-two-characters";
  process.env.TURNSTILE_HOSTNAMES = "axora.management";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET;
  else process.env.TURNSTILE_SECRET = originalSecret;
  if (originalHostnames === undefined) delete process.env.TURNSTILE_HOSTNAMES;
  else process.env.TURNSTILE_HOSTNAMES = originalHostnames;
});

function result(body: unknown, status = 200) {
  return async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Turnstile contact verification", () => {
  it("accepts only a successful contact result from the approved hostname", async () => {
    const verified = await verifyTurnstileContact({
      token: "fresh-browser-token",
      remoteIp: "203.0.113.12",
      fetcher: result({ success: true, action: "contact", hostname: "axora.management", challenge_ts: new Date().toISOString() }),
    });
    expect(verified).toMatchObject({ success: true, action: "contact", hostname: "axora.management" });
  });

  it.each([
    { success: false, action: "contact", hostname: "axora.management", challenge_ts: new Date().toISOString() },
    { success: true, action: "login", hostname: "axora.management", challenge_ts: new Date().toISOString() },
    { success: true, action: "contact", hostname: "attacker.example", challenge_ts: new Date().toISOString() },
    { success: true, action: "contact", hostname: "axora.management" },
  ])("rejects an untrusted verification response", async (body) => {
    await expect(verifyTurnstileContact({ token: "fresh-browser-token", fetcher: result(body) }))
      .rejects.toBeInstanceOf(TurnstileVerificationError);
  });

  it("fails closed for upstream and malformed token failures", async () => {
    await expect(verifyTurnstileContact({ token: "", fetcher: result({}) }))
      .rejects.toMatchObject({ reason: "invalid_token" });
    await expect(verifyTurnstileContact({ token: "fresh-browser-token", fetcher: result({}, 503) }))
      .rejects.toMatchObject({ reason: "provider_http_error" });
    await expect(verifyTurnstileContact({
      token: "fresh-browser-token",
      fetcher: async () => { throw new TypeError("network unavailable"); },
    })).rejects.toMatchObject({ reason: "provider_unavailable" });
  });
});

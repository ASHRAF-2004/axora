import { describe, expect, it } from "vitest";
import { authenticationInternals } from "@/lib/auth";

describe("authentication abuse protection", () => {
  it("uses conservative account lockout thresholds", () => {
    expect(authenticationInternals.accountFailureLimit).toBe(5);
    expect(authenticationInternals.accountFailureWindowMinutes).toBe(15);
    expect(authenticationInternals.accountLockMinutes).toBe(15);
  });

  it("stores keyed fingerprints rather than raw identifiers", () => {
    process.env.SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";
    const email = "person@example.com";
    const network = "203.0.113.9";
    const emailHash = authenticationInternals.authenticationRateKey("identifier", email);
    const networkHash = authenticationInternals.authenticationRateKey("network", network);

    expect(emailHash).toMatch(/^[0-9a-f]{64}$/);
    expect(networkHash).toMatch(/^[0-9a-f]{64}$/);
    expect(emailHash).not.toContain(email);
    expect(networkHash).not.toContain(network);
    expect(emailHash).not.toBe(networkHash);
    expect(authenticationInternals.authenticationRateKey("identifier", " Person@Example.com "))
      .toBe(emailHash);
  });
});

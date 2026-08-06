import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  createVisitorFallbackCookie,
  verifyVisitorFallbackCookie,
  VISITOR_FALLBACK_COOKIE_MAX_AGE,
} from "@/lib/public-visitor-fallback";

const originalEnvironment = {
  sessionSecret: process.env.SESSION_SECRET,
  sessionSecretFile: process.env.SESSION_SECRET_FILE,
};

const networkHash = "a".repeat(64);
const anotherNetworkHash = "b".repeat(64);
const issuedAt = Date.UTC(2026, 7, 6, 8, 0, 0);

describe("public visitor fallback proof", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = "visitor-fallback-test-secret-".repeat(4);
    delete process.env.SESSION_SECRET_FILE;
  });

  afterAll(() => {
    if (originalEnvironment.sessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = originalEnvironment.sessionSecret;
    }
    if (originalEnvironment.sessionSecretFile === undefined) {
      delete process.env.SESSION_SECRET_FILE;
    } else {
      process.env.SESSION_SECRET_FILE = originalEnvironment.sessionSecretFile;
    }
  });

  it("issues a short-lived signed proof bound to one irreversible network hash", () => {
    const value = createVisitorFallbackCookie(networkHash, issuedAt);

    expect(value).toMatch(
      /^v1\.[0-9a-z]{1,12}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(value).not.toContain(networkHash);
    expect(verifyVisitorFallbackCookie(
      value,
      networkHash,
      issuedAt + 30_000,
    )).toBe(true);
    expect(verifyVisitorFallbackCookie(
      value,
      anotherNetworkHash,
      issuedAt + 30_000,
    )).toBe(false);
  });

  it("rejects tampering, expiry, malformed values, and missing network context", () => {
    const value = createVisitorFallbackCookie(networkHash, issuedAt);
    const parts = value.split(".");
    const signature = parts[3];
    if (!signature) throw new Error("The fallback signature is missing.");
    parts[3] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    expect(verifyVisitorFallbackCookie(
      parts.join("."),
      networkHash,
      issuedAt + 30_000,
    )).toBe(false);
    expect(verifyVisitorFallbackCookie(
      value,
      networkHash,
      issuedAt + (VISITOR_FALLBACK_COOKIE_MAX_AGE + 1) * 1_000,
    )).toBe(false);
    expect(verifyVisitorFallbackCookie(
      "not-a-cookie",
      networkHash,
      issuedAt,
    )).toBe(false);
    expect(verifyVisitorFallbackCookie(value, undefined, issuedAt)).toBe(false);
  });
});

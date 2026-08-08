import { afterEach, describe, expect, it } from "vitest";
import {
  createDeliveryEvidenceAccessUrl,
  deliveryImageDimensions,
  deliveryProofInternals,
  hashDeliveryOtp,
  verifyDeliveryEvidenceAccess,
} from "@/lib/delivery-proof";

const secret = "delivery-proof-test-secret-at-least-thirty-two-bytes";

afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET_FILE;
});

describe("delivery proof cryptography and image validation", () => {
  it("stores a purpose-bound HMAC rather than a six-digit OTP", () => {
    process.env.SESSION_SECRET = secret;
    const hash = hashDeliveryOtp("10000000-0000-4000-8000-000000000001", "004271");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("004271");
    expect(hashDeliveryOtp("10000000-0000-4000-8000-000000000001", "004271")).toBe(hash);
    expect(hashDeliveryOtp("10000000-0000-4000-8000-000000000002", "004271")).not.toBe(hash);
  });

  it("binds short-lived evidence links to actor, evidence and expiry", () => {
    process.env.SESSION_SECRET = secret;
    const now = new Date("2026-08-09T00:00:00Z");
    const url = createDeliveryEvidenceAccessUrl({
      actorId: "10000000-0000-4000-8000-000000000001",
      evidenceId: "20000000-0000-4000-8000-000000000001",
      now,
    });
    const parsed = new URL(url, "https://axora.example.test");
    const input = {
      actorId: "10000000-0000-4000-8000-000000000001",
      evidenceId: "20000000-0000-4000-8000-000000000001",
      expires: parsed.searchParams.get("expires"),
      signature: parsed.searchParams.get("signature"),
    };
    expect(verifyDeliveryEvidenceAccess({ ...input, now })).toBe(true);
    expect(verifyDeliveryEvidenceAccess({ ...input, actorId: "other", now })).toBe(false);
    expect(verifyDeliveryEvidenceAccess({
      ...input,
      now: new Date(now.getTime() + (deliveryProofInternals.maximumSignedAccessSeconds + 1) * 1000),
    })).toBe(false);
  });

  it("reads bounded PNG dimensions and rejects malformed images", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
    png.writeUInt32BE(1280, 16);
    png.writeUInt32BE(720, 20);
    expect(deliveryImageDimensions("image/png", png)).toEqual({ width: 1280, height: 720 });
    png.writeUInt32BE(20_000, 16);
    expect(() => deliveryImageDimensions("image/png", png)).toThrow("dimensions");
  });
});

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const OTP_PATTERN = /^\d{6}$/;
const MAX_SIGNED_ACCESS_SECONDS = 300;

function proofSecret() {
  const path = process.env.SESSION_SECRET_FILE?.trim();
  const value = path
    ? readFileSync(path, "utf8").trim()
    : process.env.SESSION_SECRET?.trim();
  if (!value || Buffer.byteLength(value) < 32) {
    throw new Error("Delivery proof signing is unavailable.");
  }
  return value;
}

function digest(secret: string, purpose: string, value: string) {
  return createHmac("sha256", secret)
    .update(`${purpose}\0${value}`, "utf8")
    .digest("hex");
}

function equalHex(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function generateDeliveryOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashDeliveryOtp(deliveryJobId: string, code: string) {
  if (!OTP_PATTERN.test(code)) throw new Error("Delivery confirmation code is invalid.");
  return digest(proofSecret(), "delivery-otp-v1", `${deliveryJobId}:${code}`);
}

export function createDeliveryEvidenceAccessUrl(input: {
  actorId: string;
  evidenceId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const expires = Math.floor(now.getTime() / 1000) + MAX_SIGNED_ACCESS_SECONDS;
  const signature = digest(
    proofSecret(),
    "delivery-evidence-v1",
    `${input.actorId}:${input.evidenceId}:${expires}`,
  );
  return `/api/delivery-evidence/${input.evidenceId}?expires=${expires}&signature=${signature}`;
}

export function verifyDeliveryEvidenceAccess(input: {
  actorId: string;
  evidenceId: string;
  expires: string | null;
  signature: string | null;
  now?: Date;
}) {
  const expires = Number(input.expires);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isSafeInteger(expires)
    || expires < nowSeconds
    || expires > nowSeconds + MAX_SIGNED_ACCESS_SECONDS
    || !input.signature) return false;
  const expected = digest(
    proofSecret(),
    "delivery-evidence-v1",
    `${input.actorId}:${input.evidenceId}:${expires}`,
  );
  return equalHex(expected, input.signature);
}

function pngDimensions(bytes: Buffer) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
      .includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += length + 2;
  }
  return null;
}

function webpDimensions(bytes: Buffer) {
  if (bytes.length < 30
    || bytes.toString("ascii", 0, 4) !== "RIFF"
    || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    return { width, height };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function deliveryImageDimensions(contentType: string, bytes: Buffer) {
  const result = contentType === "image/png"
    ? pngDimensions(bytes)
    : contentType === "image/jpeg"
      ? jpegDimensions(bytes)
      : contentType === "image/webp"
        ? webpDimensions(bytes)
        : null;
  if (!result
    || result.width < 1 || result.width > 12_000
    || result.height < 1 || result.height > 12_000) {
    throw new Error("Delivery evidence image dimensions are invalid.");
  }
  return result;
}

export const deliveryProofInternals = {
  digest,
  equalHex,
  maximumSignedAccessSeconds: MAX_SIGNED_ACCESS_SECONDS,
};

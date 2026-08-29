import { createHmac, timingSafeEqual } from "node:crypto";

const signaturePattern = /^v1=([0-9a-f]{64})$/;

export function signWebhookPayload(
  credential: string,
  timestamp: number,
  rawPayload: string,
) {
  if (!Number.isSafeInteger(timestamp) || timestamp < 1
    || !/^axora_whsec_[A-Za-z0-9_-]{43}$/.test(credential)) {
    throw new Error("Webhook signature inputs are invalid.");
  }
  return `v1=${createHmac("sha256", credential)
    .update(`${timestamp}.`, "utf8")
    .update(rawPayload, "utf8")
    .digest("hex")}`;
}

export function verifyWebhookSignature(input: {
  credential: string;
  timestamp: string;
  signature: string;
  rawPayload: string;
  now?: number;
  toleranceSeconds?: number;
}) {
  if (!/^\d{10,13}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > tolerance) {
    return false;
  }
  const match = signaturePattern.exec(input.signature);
  if (!match) return false;
  let expected: string;
  try {
    expected = signWebhookPayload(input.credential, timestamp, input.rawPayload);
  } catch {
    return false;
  }
  const actualBuffer = Buffer.from(input.signature, "ascii");
  const expectedBuffer = Buffer.from(expected, "ascii");
  return actualBuffer.byteLength === expectedBuffer.byteLength
    && timingSafeEqual(actualBuffer, expectedBuffer);
}

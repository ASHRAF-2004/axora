import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { integrationRootKey } from "./config";

export type IntegrationSecretDomain =
  | "access-token"
  | "refresh-token"
  | "authorization-code"
  | "authorization-request"
  | "client-secret"
  | "idempotency-key"
  | "rate-limit"
  | "network"
  | "cursor"
  | "webhook-endpoint";

export function opaqueIntegrationSecret(prefix: string, bytes = 32) {
  if (!/^[a-z][a-z0-9_]{1,20}_$/.test(prefix)) {
    throw new Error("Opaque secret prefix is invalid.");
  }
  return `${prefix}${randomBytes(bytes).toString("base64url")}`;
}

export function hashIntegrationSecret(
  domain: IntegrationSecretDomain,
  value: string,
) {
  return createHmac("sha256", integrationRootKey())
    .update(`axora-integration-${domain}-v1\0`, "utf8")
    .update(value, "utf8")
    .digest("hex");
}

export function integrationSecretHashMatches(
  domain: IntegrationSecretDomain,
  value: string,
  expectedHash: string,
) {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashIntegrationSecret(domain, value), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Canonical integration payloads require finite numbers.");
  }
  return value;
}

export function canonicalIntegrationJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function integrationPayloadHash(value: unknown) {
  return createHash("sha256")
    .update(canonicalIntegrationJson(value), "utf8")
    .digest("hex");
}

function encryptionKey(purpose: string) {
  return Buffer.from(hkdfSync(
    "sha256",
    integrationRootKey(),
    Buffer.from("axora-integration-encryption-v1", "utf8"),
    Buffer.from(purpose, "utf8"),
    32,
  ));
}

export interface EncryptedIntegrationValue {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}

export function encryptIntegrationValue(purpose: string, plaintext: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(purpose), nonce);
  cipher.setAAD(Buffer.from(`axora:${purpose}:v1`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1 as const,
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptIntegrationValue(
  purpose: string,
  value: EncryptedIntegrationValue,
) {
  if (!value || value.version !== 1
    || !/^[A-Za-z0-9_-]{16}$/.test(value.nonce)
    || !/^[A-Za-z0-9_-]{1,4096}$/.test(value.ciphertext)
    || !/^[A-Za-z0-9_-]{22}$/.test(value.tag)) {
    throw new Error("Unsupported integration ciphertext.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(purpose),
    Buffer.from(value.nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(`axora:${purpose}:v1`, "utf8"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

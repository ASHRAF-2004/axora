#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const IDENTIFIER_PATTERN = /^[a-f0-9]{32}$/i;
const MAX_RESPONSE_BYTES = 1_000_000;

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith("--")) {
    throw new Error(`Missing ${name}.`);
  }
  return process.argv[index + 1];
}

export function runtimeValue(source, key) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error("Invalid production runtime configuration key.");
  }
  const values = source
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1).trim());
  if (values.length !== 1 || !values[0]) {
    throw new Error(`Production runtime configuration must contain exactly one ${key}.`);
  }
  return values[0];
}

async function cloudflareGet(path, token, label, fetchImpl) {
  const response = await fetchImpl(`${CLOUDFLARE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  const responseText = await response.text();
  if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} returned an oversized response.`);
  }

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error(`${label} returned HTTP ${response.status} with invalid JSON.`);
  }
  if (!response.ok || payload?.success !== true) {
    throw new Error(`${label} was rejected with HTTP ${response.status}.`);
  }
  return payload;
}

export async function verifyEmailServiceConfiguration({
  runtimeSource,
  tokenSource,
  fetchImpl = globalThis.fetch,
}) {
  const accountId = runtimeValue(runtimeSource, "CLOUDFLARE_ACCOUNT_ID");

  const zoneId = runtimeValue(runtimeSource, "CLOUDFLARE_ZONE_ID");
  const fromAddress = runtimeValue(runtimeSource, "AXORA_EMAIL_FROM_ADDRESS").toLowerCase();
  const senderDomain = fromAddress.split("@")[1];
  const token = tokenSource.trim();
  if (!IDENTIFIER_PATTERN.test(accountId)) throw new Error("Cloudflare account ID is invalid.");
  if (!IDENTIFIER_PATTERN.test(zoneId)) throw new Error("Cloudflare zone ID is invalid.");
  if (!/^[^\s@]+@[^\s@]+$/.test(fromAddress) || !senderDomain
    || (senderDomain !== "axora.management"
    && !senderDomain.endsWith(".axora.management"))) {
    throw new Error("Axora sender domain is invalid.");
  }
  if (token.length < 20 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error("The dedicated Cloudflare Email Sending token is malformed.");
  }

  const tokenPayload = await cloudflareGet(
    `/accounts/${accountId}/tokens/verify`,
    token,
    "Cloudflare account/token verification",
    fetchImpl,
  );
  if (tokenPayload.result?.status !== "active") {
    throw new Error("The dedicated Cloudflare account token is not active.");
  }

  const domainPayload = await cloudflareGet(
    `/zones/${zoneId}/email/sending/subdomains`,
    token,
    "Cloudflare Email Sending domain verification",
    fetchImpl,
  );
  if (!Array.isArray(domainPayload.result)) {
    throw new Error("Cloudflare Email Sending domain verification returned an invalid result.");
  }
  const configured = domainPayload.result.find((entry) => (
    typeof entry?.name === "string"
    && entry.name.toLowerCase() === senderDomain
  ));
  if (configured?.enabled !== true) {
    throw new Error(`Cloudflare Email Sending is not enabled for ${senderDomain}.`);
  }
  // New sending domains may enable seven-day body previews by default. Axora
  // security emails contain live bearer links, so provider-side body preview
  // must be explicitly disabled before delivery can be enabled.
  if (configured.preview_enabled !== false) {
    throw new Error(
      `Cloudflare Email preview must be disabled for ${senderDomain} before Axora sends security links.`,
    );
  }
  return { accountId, zoneId, senderDomain };
}

async function verifyEmailService() {
  const runtimeFile = argument("--runtime-file");
  const tokenFile = argument("--token-file");
  const [runtimeSource, tokenSource] = await Promise.all([
    readFile(runtimeFile, "utf8"),
    readFile(tokenFile, "utf8"),
  ]);
  const { senderDomain } = await verifyEmailServiceConfiguration({ runtimeSource, tokenSource });
  process.stdout.write(`Cloudflare Email Sending is ready for ${senderDomain}.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  verifyEmailService().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown verification failure.";
    process.stderr.write(`[axora-production] ERROR: ${message}\n`);
    process.exitCode = 1;
  });
}

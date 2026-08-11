#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const IDENTIFIER_PATTERN = /^[a-f0-9]{32}$/i;
const MAX_RESPONSE_BYTES = 1_000_000;
const ZEPTOMAIL_PROVIDER_AGENT_KEY_MAXIMUM_LENGTH = 200;
const ZEPTOMAIL_PROVIDER_AGENT_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

export function isZeptoMailProviderAgentKey(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= ZEPTOMAIL_PROVIDER_AGENT_KEY_MAXIMUM_LENGTH
    && ZEPTOMAIL_PROVIDER_AGENT_KEY_PATTERN.test(value);
}

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

export function optionalRuntimeValue(source, key) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new Error("Invalid production runtime configuration key.");
  }
  if (source.includes("\r") || source.split("\n").some((line) => line
    && !line.startsWith("#")
    && !/^[A-Z][A-Z0-9_]*=/.test(line))) {
    throw new Error("Production runtime configuration contains an invalid line.");
  }
  const values = source
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${key}=`))
    .map((line) => line.slice(key.length + 1));
  if (values.length !== 1) {
    throw new Error(`Production runtime configuration must contain exactly one ${key}.`);
  }
  return values[0];
}

function runtimeBoolean(source, key) {
  const value = runtimeValue(source, key);
  if (value !== "true" && value !== "false") {
    throw new Error(`${key} must be exactly true or false.`);
  }
  return value === "true";
}

export function inspectZeptoMailRuntimeState({ runtimeSource }) {
  if (runtimeValue(runtimeSource, "AXORA_EMAIL_PROVIDER") !== "zeptomail") {
    throw new Error("ZeptoMail runtime inspection requires AXORA_EMAIL_PROVIDER=zeptomail.");
  }
  const deliveryEnabled = runtimeBoolean(runtimeSource, "AXORA_EMAIL_DELIVERY_ENABLED");
  const eventsEnabled = runtimeBoolean(runtimeSource, "AXORA_EMAIL_EVENTS_ENABLED");
  const bootstrapEnabled = runtimeBoolean(runtimeSource, "ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED");
  const gates = Object.fromEntries([
    "ZEPTOMAIL_ACCOUNT_REVIEWED",
    "ZEPTOMAIL_DOMAIN_VERIFIED",
    "ZEPTOMAIL_CREDITS_READY",
    "ZEPTOMAIL_WEBHOOK_VERIFIED",
  ].map((key) => [key, runtimeBoolean(runtimeSource, key)]));
  const providerAgentKey = optionalRuntimeValue(runtimeSource, "ZEPTOMAIL_MAIL_AGENT_KEY");
  const providerAgentConfigured = isZeptoMailProviderAgentKey(providerAgentKey);

  if (bootstrapEnabled && (deliveryEnabled || eventsEnabled)) {
    throw new Error(
      "ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED requires email delivery and provider events to remain disabled.",
    );
  }
  if (deliveryEnabled && !eventsEnabled) {
    throw new Error("ZeptoMail delivery requires signed provider events to be enabled.");
  }
  if ((bootstrapEnabled || eventsEnabled || deliveryEnabled) && !providerAgentConfigured) {
    throw new Error(
      "ZEPTOMAIL_MAIL_AGENT_KEY must be the opaque ZeptoMail webhook mailagent_key, not an Agent display name.",
    );
  }
  if (gates.ZEPTOMAIL_WEBHOOK_VERIFIED && (bootstrapEnabled || !eventsEnabled)) {
    throw new Error(
      "ZEPTOMAIL_WEBHOOK_VERIFIED requires bootstrap to be disabled and signed provider events to be enabled.",
    );
  }

  const blockers = Object.entries(gates)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  let state = "DELIVERY_DISABLED";
  if (bootstrapEnabled) state = "WEBHOOK_BOOTSTRAP";
  else if (deliveryEnabled) state = "FULLY_ENABLED";
  else if (eventsEnabled && !gates.ZEPTOMAIL_WEBHOOK_VERIFIED) state = "SIGNED_WEBHOOK_CONFIGURED";
  else if (eventsEnabled && blockers.length === 0) state = "READY_FOR_CONTROLLED_SEND";
  else if (!gates.ZEPTOMAIL_ACCOUNT_REVIEWED) state = "ACCOUNT_REVIEW_PENDING";

  if (deliveryEnabled && blockers.length) {
    throw new Error(`${blockers.join(", ")} must be true before ZeptoMail delivery is enabled.`);
  }
  return {
    provider: "zeptomail",
    state,
    deliveryEnabled,
    eventsEnabled,
    bootstrapEnabled,
    providerAgentConfigured,
    gates,
    blockers,
  };
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

export function verifyZeptoMailConfiguration({ runtimeSource, tokenSource }) {
  const readiness = inspectZeptoMailRuntimeState({ runtimeSource });
  if (!readiness.deliveryEnabled || readiness.state !== "FULLY_ENABLED") {
    throw new Error("ZeptoMail is not fully enabled for production sending.");
  }
  const fromAddress = runtimeValue(runtimeSource, "AXORA_EMAIL_FROM_ADDRESS").toLowerCase();
  const senderDomain = fromAddress.split("@")[1];
  const token = tokenSource.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(fromAddress) || !senderDomain
    || (senderDomain !== "axora.management"
      && !senderDomain.endsWith(".axora.management"))) {
    throw new Error("Axora sender domain is invalid.");
  }
  if (token.length < 20 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error("The active ZeptoMail Send Mail Token is malformed.");
  }
  return { provider: "zeptomail", senderDomain, agentCount: 1 };
}

async function verifyEmailService() {
  const runtimeFile = argument("--runtime-file");
  const runtimeSource = await readFile(runtimeFile, "utf8");
  const provider = runtimeValue(runtimeSource, "AXORA_EMAIL_PROVIDER");
  if (provider === "zeptomail") {
    const readiness = inspectZeptoMailRuntimeState({ runtimeSource });
    if (process.argv.includes("--configuration-only")) {
      const blockers = readiness.blockers.length ? readiness.blockers.join(", ") : "none";
      process.stdout.write(`ZeptoMail state: ${readiness.state}; blockers: ${blockers}.\n`);
      return;
    }
    const tokenFile = argument("--token-file");
    const tokenSource = await readFile(tokenFile, "utf8");
    const { senderDomain, agentCount } = verifyZeptoMailConfiguration({
      runtimeSource,
      tokenSource,
    });
    process.stdout.write(
      `ZeptoMail launch evidence is configured for ${senderDomain} across ${agentCount} Agents.\n`,
    );
    return;
  }
  if (provider !== "cloudflare-email-service") {
    throw new Error("Unsupported production email provider.");
  }
  const tokenFile = argument("--token-file");
  const tokenSource = await readFile(tokenFile, "utf8");
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

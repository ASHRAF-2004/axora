#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function runtimeBoolean(source, key) {
  const value = runtimeValue(source, key);
  if (value !== "true" && value !== "false") {
    throw new Error(`${key} must be exactly true or false.`);
  }
  return value === "true";
}

export function inspectResendRuntimeState({ runtimeSource }) {
  if (runtimeValue(runtimeSource, "AXORA_EMAIL_PROVIDER") !== "resend") {
    throw new Error("Production email requires AXORA_EMAIL_PROVIDER=resend.");
  }
  const deliveryEnabled = runtimeBoolean(runtimeSource, "AXORA_EMAIL_DELIVERY_ENABLED");
  const eventsEnabled = runtimeBoolean(runtimeSource, "AXORA_EMAIL_EVENTS_ENABLED");
  const gates = {
    RESEND_DOMAIN_VERIFIED: runtimeBoolean(runtimeSource, "RESEND_DOMAIN_VERIFIED"),
    RESEND_WEBHOOK_VERIFIED: runtimeBoolean(runtimeSource, "RESEND_WEBHOOK_VERIFIED"),
  };
  if (deliveryEnabled && !eventsEnabled) {
    throw new Error("Resend delivery requires signed provider events to be enabled.");
  }
  if (gates.RESEND_WEBHOOK_VERIFIED && !eventsEnabled) {
    throw new Error("RESEND_WEBHOOK_VERIFIED requires signed provider events to be enabled.");
  }
  const blockers = Object.entries(gates)
    .filter(([, ready]) => !ready)
    .map(([key]) => key);
  if (deliveryEnabled && blockers.length) {
    throw new Error(`${blockers.join(", ")} must be true before Resend delivery is enabled.`);
  }
  let state = "DELIVERY_DISABLED";
  if (deliveryEnabled) state = "FULLY_ENABLED";
  else if (eventsEnabled && !gates.RESEND_WEBHOOK_VERIFIED) state = "SIGNED_WEBHOOK_CONFIGURED";
  else if (eventsEnabled && blockers.length === 0) state = "READY_FOR_CONTROLLED_SEND";
  return {
    provider: "resend",
    state,
    deliveryEnabled,
    eventsEnabled,
    gates,
    blockers,
  };
}

export function verifyResendConfiguration({ runtimeSource, tokenSource }) {
  const readiness = inspectResendRuntimeState({ runtimeSource });
  if (!readiness.deliveryEnabled || readiness.state !== "FULLY_ENABLED") {
    throw new Error("Resend is not fully enabled for production sending.");
  }
  const fromAddress = runtimeValue(runtimeSource, "AXORA_EMAIL_FROM_ADDRESS").toLowerCase();
  const senderDomain = fromAddress.split("@")[1];
  const token = tokenSource.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(fromAddress) || !senderDomain
    || (senderDomain !== "axora.management"
      && !senderDomain.endsWith(".axora.management"))) {
    throw new Error("Axora sender domain is invalid.");
  }
  if (token.length < 23 || token.length > 4096
    || !/^re_[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("The Resend API key is malformed.");
  }
  return { provider: "resend", senderDomain };
}

async function verifyEmailService() {
  const runtimeFile = argument("--runtime-file");
  const runtimeSource = await readFile(runtimeFile, "utf8");
  const readiness = inspectResendRuntimeState({ runtimeSource });
  if (process.argv.includes("--configuration-only")) {
    const blockers = readiness.blockers.length ? readiness.blockers.join(", ") : "none";
    process.stdout.write(`Resend state: ${readiness.state}; blockers: ${blockers}.\n`);
    return;
  }
  const tokenSource = await readFile(argument("--token-file"), "utf8");
  const { senderDomain } = verifyResendConfiguration({ runtimeSource, tokenSource });
  process.stdout.write(`Resend launch evidence is configured for ${senderDomain}.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  verifyEmailService().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown verification failure.";
    process.stderr.write(`[axora-production] ERROR: ${message}\n`);
    process.exitCode = 1;
  });
}

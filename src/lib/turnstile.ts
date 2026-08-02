import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const responseSchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().max(80).optional(),
  hostname: z.string().max(253).optional(),
  action: z.string().max(32).optional(),
  "error-codes": z.array(z.string().max(100)).optional(),
}).passthrough();

export class TurnstileVerificationError extends Error {
  constructor() {
    super("Request verification failed.");
    this.name = "TurnstileVerificationError";
  }
}

function readTurnstileSecret() {
  const file = process.env.TURNSTILE_SECRET_FILE?.trim();
  const secret = file && existsSync(file)
    ? readFileSync(file, "utf8").trim()
    : process.env.NODE_ENV !== "production"
      ? process.env.TURNSTILE_SECRET?.trim()
      : undefined;
  if (!secret || secret.length > 2_048 || /[\s\u0000-\u001f\u007f]/.test(secret)) {
    throw new TurnstileVerificationError();
  }
  return secret;
}

function allowedHostnames() {
  const hosts = (process.env.TURNSTILE_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (!hosts.length || hosts.some((host) => host.length > 253 || host.includes(":") || host.includes("/"))) {
    throw new TurnstileVerificationError();
  }
  return new Set(hosts);
}

export async function verifyTurnstileContact(input: {
  token: string;
  remoteIp?: string;
  fetcher?: typeof fetch;
}) {
  if (!input.token || input.token.length > 2_048 || /[\u0000-\u001f\u007f]/.test(input.token)) {
    throw new TurnstileVerificationError();
  }
  const body = new URLSearchParams({
    secret: readTurnstileSecret(),
    response: input.token,
    idempotency_key: randomUUID(),
  });
  if (input.remoteIp && input.remoteIp.length <= 64 && /^[0-9a-f:.]+$/i.test(input.remoteIp)) {
    body.set("remoteip", input.remoteIp);
  }
  try {
    const response = await (input.fetcher ?? fetch)("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) throw new TurnstileVerificationError();
    const result = responseSchema.parse(await response.json());
    const hostname = result.hostname?.toLowerCase();
    if (!result.success || result.action !== "contact" || !hostname || !allowedHostnames().has(hostname) || !result.challenge_ts) {
      throw new TurnstileVerificationError();
    }
    return {
      success: true as const,
      challengeTimestamp: result.challenge_ts,
      hostname,
      action: "contact" as const,
    };
  } catch (error) {
    if (error instanceof TurnstileVerificationError) throw error;
    throw new TurnstileVerificationError();
  }
}

export const turnstileInternals = { allowedHostnames };

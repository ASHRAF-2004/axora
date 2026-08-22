import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import {
  authorizeAccountSetupDelivery,
  type AccountSetupInvitationResult,
} from "./account-setup";
import {
  recordResendQuotaSnapshotSafely,
  resendQuotaSnapshotSchema,
} from "./email-operations";

const EMAIL_SERVICE_SECRET_MINIMUM_LENGTH = 32;
const EMAIL_SERVICE_CLOCK_SKEW_SECONDS = 90;
const EMAIL_SERVICE_REPLAY_WINDOW_SECONDS = 5 * 60;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const seenServiceRequestIds = new Map<string, number>();

export interface AccountSetupEmailDelivery {
  succeeded: boolean;
  providerMessageId?: string;
  status: "sent" | "disabled" | "failed" | "uncertain";
}

function emailSenderUrl() {
  const configured = process.env.AXORA_EMAIL_SENDER_URL ?? "http://email-sender:3100";
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" || parsed.hostname !== "email-sender"
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || (parsed.pathname !== "/" && parsed.pathname !== "")) {
    throw new Error("AXORA_EMAIL_SENDER_URL must point to the private email-sender service.");
  }
  return new URL("/v1/account-setup", parsed);
}

export function buildAccountSetupUrl(rawToken: string) {
  const base = process.env.APP_BASE_URL ?? "https://axora.management";
  const parsed = new URL(base);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("APP_BASE_URL must be the canonical Axora HTTPS origin.");
  }
  const url = new URL("/account/setup", parsed);
  // Keep the bearer token out of HTTP request targets and access logs. The
  // setup page reads this fragment in the browser and removes it immediately.
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}

function emailServiceSecret() {
  const filename = process.env.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE;
  let value = "";
  if (filename) {
    try {
      value = readFileSync(filename, "utf8").trim();
    } catch {
      throw new Error("The private account-email service key is unavailable.");
    }
  } else if (process.env.NODE_ENV !== "production") {
    value = (process.env.AXORA_EMAIL_SERVICE_AUTH_KEY ?? "").trim();
  }
  if (value.length < EMAIL_SERVICE_SECRET_MINIMUM_LENGTH
    || value.length > 4_096 || /[\s\u0000-\u001F\u007F]/.test(value)) {
    throw new Error("The private account-email service key is unavailable.");
  }
  return value;
}

function signingKey() {
  return createHash("sha256")
    .update("axora-account-email-service-auth-v1\0", "utf8")
    .update(emailServiceSecret(), "utf8")
    .digest();
}

function canonicalServiceRequest(
  method: string,
  pathname: string,
  body: string,
  timestamp: string,
  requestId: string,
) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return [timestamp, requestId, method.toUpperCase(), pathname, bodyHash].join("\n");
}

export function signEmailServiceRequest(
  method: string,
  pathname: string,
  body: string,
  options: { now?: number; requestId?: string } = {},
) {
  const timestamp = String(Math.floor((options.now ?? Date.now()) / 1_000));
  const requestId = options.requestId ?? randomUUID();
  if (!REQUEST_ID_PATTERN.test(requestId) || !pathname.startsWith("/")) {
    throw new Error("The private account-email request metadata is invalid.");
  }
  const signature = createHmac("sha256", signingKey())
    .update(canonicalServiceRequest(method, pathname, body, timestamp, requestId), "utf8")
    .digest("base64url");
  return {
    "X-Axora-Email-Timestamp": timestamp,
    "X-Axora-Email-Request-Id": requestId,
    "X-Axora-Email-Signature": signature,
  };
}

type HeaderSource = Headers | Record<string, string | string[] | undefined>;

function headerValue(headers: HeaderSource, name: string) {
  if (headers instanceof Headers) return headers.get(name) ?? "";
  const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  const value = matchingKey ? headers[matchingKey] : undefined;
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function forgetOldRequestIds(nowSeconds: number) {
  for (const [requestId, seenAt] of seenServiceRequestIds) {
    if (seenAt < nowSeconds - EMAIL_SERVICE_REPLAY_WINDOW_SECONDS) {
      seenServiceRequestIds.delete(requestId);
    }
  }
}

export function verifyEmailServiceRequest(input: {
  method: string;
  pathname: string;
  body: string;
  headers: HeaderSource;
  now?: number;
}) {
  try {
    const timestamp = headerValue(input.headers, "x-axora-email-timestamp");
    const requestId = headerValue(input.headers, "x-axora-email-request-id");
    const signature = headerValue(input.headers, "x-axora-email-signature");
    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor((input.now ?? Date.now()) / 1_000);
    if (!Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds) > EMAIL_SERVICE_CLOCK_SKEW_SECONDS
      || !REQUEST_ID_PATTERN.test(requestId)
      || !SIGNATURE_PATTERN.test(signature)
      || !input.pathname.startsWith("/")) {
      return false;
    }

    forgetOldRequestIds(nowSeconds);
    if (seenServiceRequestIds.has(requestId)) return false;
    const expected = createHmac("sha256", signingKey())
      .update(canonicalServiceRequest(
        input.method,
        input.pathname,
        input.body,
        timestamp,
        requestId,
      ), "utf8")
      .digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return false;
    }
    seenServiceRequestIds.set(requestId, nowSeconds);
    return true;
  } catch {
    return false;
  }
}

function safeProviderMessageId(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 255 || /[\r\n]/.test(value)) {
    throw new Error("invalid_provider_message_id");
  }
  return value;
}

function responseOutcome(
  response: Response,
  payload: unknown,
): AccountSetupEmailDelivery["status"] {
  const result = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  if (response.ok && result.succeeded === true
    && ["delivered", "queued", "submitted"].includes(String(result.status))) {
    return "sent";
  }
  if (result.disposition === "retry") {
    return "failed";
  }
  if (result.disposition === "uncertain") {
    return "uncertain";
  }
  if (result.disposition === "failed") {
    return "failed";
  }
  if (response.status === 429) {
    return "failed";
  }
  if (response.status >= 500) {
    return "uncertain";
  }
  return "failed";
}

export async function sendAccountSetupEmail(
  invitation: AccountSetupInvitationResult,
): Promise<AccountSetupEmailDelivery> {
  if (process.env.AXORA_EMAIL_DELIVERY_ENABLED !== "true") {
    return { succeeded: false, status: "disabled" };
  }

  try {
    if (!await authorizeAccountSetupDelivery(
      invitation.invitationId,
      invitation.rawToken,
    )) {
      return { succeeded: false, status: "failed" };
    }
  } catch {
    return { succeeded: false, status: "failed" };
  }

  let outcome: AccountSetupEmailDelivery["status"] = "uncertain";
  let providerMessageId: string | undefined;
  let requestStarted = false;
  try {
    const url = emailSenderUrl();
    const body = JSON.stringify({
      deliveryId: invitation.invitationId,
      recipientName: invitation.recipientName,
      recipientEmail: invitation.recipientEmail,
      companyName: invitation.companyName,
      role: invitation.role,
      branchName: invitation.branchName,
      expiresAt: invitation.expiresAt,
      locale: invitation.locale,
      setupUrl: buildAccountSetupUrl(invitation.rawToken),
    });
    requestStarted = true;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signEmailServiceRequest("POST", url.pathname, body),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(18_000),
    });
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      result = undefined;
    }
    outcome = responseOutcome(response, result);
    const quotaSnapshot = resendQuotaSnapshotSchema.safeParse(
      (result as Record<string, unknown> | undefined)?.quotaSnapshot,
    );
    if (quotaSnapshot.success) {
      await recordResendQuotaSnapshotSafely(quotaSnapshot.data);
    }
    if (outcome === "sent") {
      providerMessageId = safeProviderMessageId(
        (result as Record<string, unknown> | undefined)?.messageId,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_provider_message_id") {
      outcome = "uncertain";
    } else if (!requestStarted) {
      outcome = "failed";
    }
  }

  if (outcome === "sent") {
    return {
      succeeded: true,
      ...(providerMessageId ? { providerMessageId } : {}),
      status: "sent",
    };
  }
  return { succeeded: false, status: outcome };
}

export const accountEmailInternals = {
  replayCache: seenServiceRequestIds,
};

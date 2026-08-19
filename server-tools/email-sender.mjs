import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { renderAccountSetupEmail } from "./account-setup-email.mjs";
import { renderTransactionalEmail } from "./transactional-email.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MIN_API_TOKEN_LENGTH = 23;
const MAX_API_TOKEN_LENGTH = 4_096;
const MIN_SERVICE_SECRET_LENGTH = 32;
const SERVICE_CLOCK_SKEW_SECONDS = 90;
const SERVICE_REPLAY_WINDOW_SECONDS = 5 * 60;
const DELIVERY_CACHE_TTL_SECONDS = 24 * 60 * 60;
const DELIVERY_CACHE_MAX_ENTRIES = 1_000;
const OUTBOX_POLL_INTERVAL_MS = 10_000;
const PROVIDER_AGENTS = [
  "axora-auth", "axora-procurement", "axora-budget", "axora-delivery",
  "axora-documents", "axora-platform",
];
const INLINE_ASSETS = [
  ["axora-logo", "axora-email.png", new URL("../public/brand/axora-email.png", import.meta.url)],
  ["account-envelope", "account-envelope.png", new URL("../public/email/account-setup/account-envelope.png", import.meta.url)],
];

// Provider requests are intentionally single-attempt. Resend receives a stable
// idempotency key per Axora delivery, while durable queues own retry scheduling.
export const MAX_PROVIDER_ATTEMPTS = 1;
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 7_000;
export const PROVIDER_RETRY_DELAY_MS = 60_000;
export const SERVER_HANDLER_TIMEOUT_MS = 9_000;

let inlineAttachmentsPromise;
const seenServiceRequestIds = new Map();
const deliveryCache = new Map();

function emailError(message, statusCode, disposition, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  if (statusCode !== undefined) error.statusCode = statusCode;
  if (disposition !== undefined) error.disposition = disposition;
  return error;
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

async function requestBodyText(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function emailDeliveryEnabled(env = process.env) {
  const configured = String(env.AXORA_EMAIL_DELIVERY_ENABLED ?? "false").trim().toLowerCase();
  if (!configured || configured === "false") return false;
  if (configured !== "true") throw new Error("email_not_configured");
  return true;
}

async function readBoundedSecret(filename, {
  readFileImpl = readFile,
  minimumLength,
  maximumLength = MAX_API_TOKEN_LENGTH,
} = {}) {
  if (!filename) throw new Error("email_not_configured");
  try {
    const value = (await readFileImpl(filename, "utf8")).trim();
    if (value.length < minimumLength || value.length > maximumLength
      || /[\s\u0000-\u001F\u007F]/.test(value)) {
      throw new Error("email_not_configured");
    }
    return value;
  } catch {
    throw new Error("email_not_configured");
  }
}

export function apiToken({
  env = process.env,
  readFileImpl = readFile,
  provider = String(env.AXORA_EMAIL_PROVIDER ?? "resend").trim(),
} = {}) {
  if (provider !== "resend") throw new Error("email_not_configured");
  return readBoundedSecret(String(env.RESEND_API_KEY_FILE ?? "").trim(), {
    readFileImpl,
    minimumLength: MIN_API_TOKEN_LENGTH,
  });
}

export function serviceAuthSecret({ env = process.env, readFileImpl = readFile } = {}) {
  return readBoundedSecret(String(env.AXORA_EMAIL_SERVICE_AUTH_KEY_FILE ?? "").trim(), {
    readFileImpl,
    minimumLength: MIN_SERVICE_SECRET_LENGTH,
  });
}

export async function loadInlineAttachments({
  readFileImpl = readFile,
  contentIds,
} = {}) {
  try {
    const selectedAssets = contentIds
      ? INLINE_ASSETS.filter(([contentId]) => contentIds.includes(contentId))
      : INLINE_ASSETS;
    if (!selectedAssets.length) throw new Error("email_not_configured");
    return await Promise.all(selectedAssets.map(async ([contentId, filename, assetUrl]) => {
      const contents = await readFileImpl(assetUrl);
      const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
      if (buffer.byteLength === 0) throw new Error("email_not_configured");
      return {
        content: buffer.toString("base64"),
        filename,
        type: "image/png",
        disposition: "inline",
        content_id: contentId,
      };
    }));
  } catch {
    throw new Error("email_not_configured");
  }
}

export async function loadTransactionalAttachment(attachment, {
  env = process.env,
  readFileImpl = readFile,
} = {}) {
  const root = path.resolve(String(
    env.AXORA_UPLOADS_CONTAINER_DIR ?? "/app/data/uploads",
  ));
  const storagePath = String(attachment?.storagePath ?? "");
  const fileName = String(attachment?.fileName ?? "");
  const checksum = String(attachment?.checksum ?? "");
  const fileSize = Number(attachment?.fileSize);
  if (!/^generated-documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(storagePath)
    || !/^Axora-Invoice-[A-Za-z0-9._-]{1,120}\.pdf$/.test(fileName)
    || attachment?.contentType !== "application/pdf"
    || !/^[0-9a-f]{64}$/.test(checksum)
    || !Number.isSafeInteger(fileSize) || fileSize < 100
    || fileSize > 10 * 1024 * 1024) {
    throw new Error("email_attachment_unavailable");
  }
  const target = path.resolve(root, ...storagePath.split("/"));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error("email_attachment_unavailable");
  }
  const bytes = await readFileImpl(target);
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.length !== fileSize
    || !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !buffer.subarray(Math.max(0, buffer.length - 1024)).includes(Buffer.from("%%EOF"))
    || createHash("sha256").update(buffer).digest("hex") !== checksum) {
    throw new Error("email_attachment_unavailable");
  }
  return {
    content: buffer.toString("base64"), filename: fileName,
    type: "application/pdf", disposition: "attachment",
  };
}

async function inlineAttachments() {
  inlineAttachmentsPromise ??= loadInlineAttachments().catch((error) => {
    inlineAttachmentsPromise = undefined;
    throw error;
  });
  return inlineAttachmentsPromise;
}

export function senderConfiguration(env = process.env) {
  const fromAddress = String(env.AXORA_EMAIL_FROM_ADDRESS ?? "").trim().toLowerCase();
  const fromName = String(env.AXORA_EMAIL_FROM_NAME ?? "Axora").trim();
  const supportEmail = String(env.AXORA_EMAIL_REPLY_TO ?? "").trim().toLowerCase();
  const appBaseUrl = String(env.APP_BASE_URL ?? "https://axora.management").trim();
  const provider = String(env.AXORA_EMAIL_PROVIDER ?? "resend").trim();
  if (provider !== "resend"
    || !EMAIL_PATTERN.test(fromAddress)
    || !EMAIL_PATTERN.test(supportEmail) || !fromName || fromName.length > 100
    || /[\r\n]/.test(fromName)) {
    throw new Error("email_not_configured");
  }

  let appUrl;
  try {
    appUrl = new URL(appBaseUrl);
  } catch {
    throw new Error("email_not_configured");
  }
  if (appUrl.protocol !== "https:" || appUrl.username || appUrl.password
    || appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
    throw new Error("email_not_configured");
  }

  const fromDomain = fromAddress.split("@")[1];
  const appHostname = appUrl.hostname.toLowerCase();
  if (fromDomain !== appHostname && !fromDomain.endsWith(`.${appHostname}`)) {
    throw new Error("email_not_configured");
  }
  return {
    fromAddress,
    fromName,
    supportEmail,
    appBaseUrl: appUrl.toString(),
    provider,
  };
}

export function outboxConfiguration(env = process.env) {
  let url;
  try {
    url = new URL(String(
      env.AXORA_EMAIL_OUTBOX_URL ?? "http://app:3000/account/email-outbox",
    ));
  } catch {
    throw new Error("email_not_configured");
  }
  if (url.protocol !== "http:" || url.hostname !== "app" || url.port !== "3000"
    || url.pathname !== "/account/email-outbox" || url.username || url.password
    || url.search || url.hash) {
    throw new Error("email_not_configured");
  }
  return url;
}

export async function fetchWithRetry(url, options, {
  fetchImpl = globalThis.fetch,
} = {}) {
  try {
    return await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(PROVIDER_ATTEMPT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw emailError("provider_unavailable", undefined, "uncertain", cause);
  }
}

function resendAddress(address, name) {
  if (typeof address !== "string" || address.length > 254 || !EMAIL_PATTERN.test(address)
    || /[\r\n]/.test(address) || typeof name !== "string" || !name.trim()
    || name.length > 200 || /[\r\n]/.test(name)) {
    throw emailError("provider_rejected", undefined, "failed");
  }
  return { address: address.toLowerCase(), name: name.trim() };
}

function resendBody(message) {
  if (!UUID_PATTERN.test(String(message.deliveryId ?? ""))
    || !PROVIDER_AGENTS.includes(message.providerAgent)
    || typeof message.subject !== "string" || !message.subject.trim()
    || message.subject.length > 500 || /[\r\n]/.test(message.subject)
    || typeof message.html !== "string" || !message.html
    || typeof message.text !== "string" || !message.text) {
    throw emailError("provider_rejected", undefined, "failed");
  }
  const from = resendAddress(message.from?.address, message.from?.name);
  const replyTo = resendAddress(message.reply_to?.address, message.reply_to?.name);
  const recipient = resendAddress(message.to, message.recipientName);
  const body = {
    from: `${from.name} <${from.address}>`,
    to: [recipient.address],
    reply_to: replyTo.address,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: {
      ...(message.headers ?? {}),
      "X-Axora-Delivery-Id": message.deliveryId,
      "X-Axora-Provider-Agent": message.providerAgent,
    },
    attachments: (message.attachments ?? []).map((attachment) => ({
      content: attachment.content,
      filename: attachment.filename,
      content_type: attachment.type,
      ...(attachment.disposition === "inline" && attachment.content_id
        ? { content_id: attachment.content_id }
        : {}),
    })),
  };
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > RESEND_MAX_MESSAGE_BYTES) {
    throw emailError("provider_content_too_large", 413, "failed");
  }
  return serialized;
}

export function parseResendEmailId(provider) {
  const emailId = provider?.id;
  if (typeof emailId !== "string" || !emailId.trim()
    || emailId.length > 255 || /[\r\n]/.test(emailId)) {
    throw emailError("provider_rejected", undefined, "uncertain");
  }
  return emailId.trim();
}

export function createResendEmailProvider({ token, fetchImpl = globalThis.fetch } = {}) {
  if (!token) throw new Error("email_not_configured");
  return {
    name: "resend",
    async send(message) {
      const response = await fetchWithRetry(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `axora-delivery-${message.deliveryId}`,
        },
        body: resendBody(message),
      }, { fetchImpl });
      let providerResponse;
      try {
        providerResponse = await response.json();
      } catch {
        providerResponse = undefined;
      }
      if (!response.ok) {
        if (response.status === 429) {
          throw emailError("provider_rate_limited", response.status, "retry");
        }
        if ([401, 403].includes(response.status)) {
          throw emailError(
            "provider_configuration_incident",
            response.status,
            "configuration",
          );
        }
        if (response.status >= 500) {
          throw emailError("provider_unavailable", response.status, "retry");
        }
        throw emailError("provider_rejected", response.status, "failed");
      }
      return {
        status: "submitted",
        messageId: parseResendEmailId(providerResponse),
      };
    },
  };
}

export function resolveEmailProvider(name, dependencies) {
  if (name === "resend") return createResendEmailProvider(dependencies);
  throw new Error("email_not_configured");
}

export async function readinessStatus({ env = process.env, readFileImpl = readFile } = {}) {
  try {
    if (!emailDeliveryEnabled(env)) {
      return { statusCode: 200, body: { status: "disabled" } };
    }
    const configuration = senderConfiguration(env);
    outboxConfiguration(env);
    await Promise.all([
      apiToken({ env, readFileImpl, provider: configuration.provider }),
      serviceAuthSecret({ env, readFileImpl }),
      loadInlineAttachments({ readFileImpl }),
    ]);
    return { statusCode: 200, body: { status: "ready" } };
  } catch {
    return { statusCode: 503, body: { status: "not_ready" } };
  }
}

export async function sendAccountSetup(payload, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  provider,
} = {}) {
  if (!emailDeliveryEnabled(env)) throw new Error("email_not_configured");
  const configuration = senderConfiguration(env);
  const rendered = await renderAccountSetupEmail(payload, {
    appBaseUrl: configuration.appBaseUrl,
    supportEmail: configuration.supportEmail,
  });
  const attachments = readFileImpl === readFile
    ? await inlineAttachments()
    : await loadInlineAttachments({ readFileImpl });
  const selectedProvider = provider ?? resolveEmailProvider(configuration.provider, {
    token: await apiToken({
      env,
      readFileImpl,
      provider: configuration.provider,
    }),
    fetchImpl,
  });
  if (selectedProvider.name !== "resend") throw new Error("email_not_configured");
  const result = await selectedProvider.send({
    deliveryId: payload.deliveryId,
    providerAgent: "axora-auth",
    to: rendered.recipientEmail,
    recipientName: rendered.recipientName,
    from: { address: configuration.fromAddress, name: configuration.fromName },
    reply_to: { address: rendered.supportEmail, name: "Axora support" },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments,
    headers: {
      "X-Axora-Template": payload.role === "COMPANY_ADMIN"
        ? "company-admin-invitation-v1" : "internal-user-invitation-v1",
    },
  });
  return {
    succeeded: true,
    status: result.status,
    providerName: "resend",
    providerAgent: "axora-auth",
    ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
  };
}

export async function sendTransactionalEmail(payload, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  provider,
} = {}) {
  if (!emailDeliveryEnabled(env)) throw new Error("email_not_configured");
  const configuration = senderConfiguration(env);
  const rendered = await renderTransactionalEmail(payload, {
    appBaseUrl: configuration.appBaseUrl,
    supportEmail: configuration.supportEmail,
  });
  const attachments = readFileImpl === readFile
    ? (await inlineAttachments()).filter((attachment) => (
      attachment.content_id === "axora-logo"
    ))
    : await loadInlineAttachments({ readFileImpl, contentIds: ["axora-logo"] });
  if (payload.attachment) {
    attachments.push(await loadTransactionalAttachment(
      payload.attachment,
      { env, readFileImpl },
    ));
  }
  const providerAgent = PROVIDER_AGENTS.includes(payload.providerAgent)
    ? payload.providerAgent : rendered.providerAgent;
  if (!PROVIDER_AGENTS.includes(providerAgent)) throw new Error("email_not_configured");
  const selectedProvider = provider ?? resolveEmailProvider(configuration.provider, {
    token: await apiToken({
      env,
      readFileImpl,
      provider: configuration.provider,
    }),
    fetchImpl,
  });
  if (selectedProvider.name !== "resend") throw new Error("email_not_configured");
  const result = await selectedProvider.send({
    deliveryId: payload.deliveryId,
    providerAgent,
    to: rendered.recipientEmail,
    recipientName: rendered.recipientName,
    from: { address: configuration.fromAddress, name: configuration.fromName },
    reply_to: { address: rendered.replyToEmail, name: rendered.replyToName },
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    attachments,
    headers: { "X-Axora-Template": `${rendered.templateKey}-v${rendered.templateVersion}` },
  });
  return {
    succeeded: true,
    status: result.status,
    providerName: "resend",
    providerAgent,
    ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
  };
}

function signingKey(secret) {
  return createHash("sha256")
    .update("axora-account-email-service-auth-v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function canonicalServiceRequest(method, pathname, body, timestamp, requestId) {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return [timestamp, requestId, method.toUpperCase(), pathname, bodyHash].join("\n");
}

function pruneReplayCache(nowSeconds) {
  for (const [requestId, seenAt] of seenServiceRequestIds) {
    if (seenAt < nowSeconds - SERVICE_REPLAY_WINDOW_SECONDS) {
      seenServiceRequestIds.delete(requestId);
    }
  }
}

export async function verifyServiceRequest({
  method,
  pathname,
  body,
  headers,
  env = process.env,
  readFileImpl = readFile,
  now = Date.now(),
}) {
  try {
    const timestamp = String(headers["x-axora-email-timestamp"] ?? "");
    const requestId = String(headers["x-axora-email-request-id"] ?? "");
    const signature = String(headers["x-axora-email-signature"] ?? "");
    const timestampSeconds = Number(timestamp);
    const nowSeconds = Math.floor(now / 1_000);
    if (!Number.isSafeInteger(timestampSeconds)
      || Math.abs(nowSeconds - timestampSeconds) > SERVICE_CLOCK_SKEW_SECONDS
      || !UUID_PATTERN.test(requestId) || !SIGNATURE_PATTERN.test(signature)) {
      return false;
    }
    pruneReplayCache(nowSeconds);
    if (seenServiceRequestIds.has(requestId)) return false;
    const secret = await serviceAuthSecret({ env, readFileImpl });
    const expected = createHmac("sha256", signingKey(secret))
      .update(canonicalServiceRequest(method, pathname, body, timestamp, requestId), "utf8")
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

export async function signServiceRequest(method, pathname, body, {
  env = process.env,
  readFileImpl = readFile,
  now = Date.now(),
  requestId = randomUUID(),
} = {}) {
  const timestamp = String(Math.floor(now / 1_000));
  const secret = await serviceAuthSecret({ env, readFileImpl });
  const signature = createHmac("sha256", signingKey(secret))
    .update(canonicalServiceRequest(method, pathname, body, timestamp, requestId), "utf8")
    .digest("base64url");
  return {
    "X-Axora-Email-Timestamp": timestamp,
    "X-Axora-Email-Request-Id": requestId,
    "X-Axora-Email-Signature": signature,
  };
}

function pruneDeliveryCache(nowSeconds) {
  for (const [deliveryId, entry] of deliveryCache) {
    if (entry.createdAt < nowSeconds - DELIVERY_CACHE_TTL_SECONDS) {
      deliveryCache.delete(deliveryId);
    }
  }
  while (deliveryCache.size > DELIVERY_CACHE_MAX_ENTRIES) {
    deliveryCache.delete(deliveryCache.keys().next().value);
  }
}

async function idempotentDelivery(payload, rawBody, sendAccountSetupImpl) {
  if (!UUID_PATTERN.test(String(payload?.deliveryId ?? ""))) {
    throw new Error("invalid_request");
  }
  const nowSeconds = Math.floor(Date.now() / 1_000);
  pruneDeliveryCache(nowSeconds);
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const existing = deliveryCache.get(payload.deliveryId);
  if (existing) {
    if (existing.bodyHash !== bodyHash) throw new Error("invalid_request");
    return existing.promise;
  }
  const promise = Promise.resolve().then(() => sendAccountSetupImpl(payload));
  deliveryCache.set(payload.deliveryId, { bodyHash, promise, createdAt: nowSeconds });
  try {
    return await promise;
  } catch (error) {
    if (error?.disposition !== "uncertain") deliveryCache.delete(payload.deliveryId);
    throw error;
  }
}

export function createEmailSenderHandler({
  sendAccountSetupImpl = sendAccountSetup,
  sendTransactionalEmailImpl = sendTransactionalEmail,
  readinessStatusImpl = readinessStatus,
  verifyServiceRequestImpl = verifyServiceRequest,
} = {}) {
  return async (request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      json(response, 200, { status: "live" });
      return;
    }
    if (request.method === "GET" && request.url === "/health/ready") {
      try {
        const readiness = await readinessStatusImpl();
        json(response, readiness.statusCode, readiness.body);
      } catch {
        json(response, 503, { status: "not_ready" });
      }
      return;
    }
    const supportedDeliveryPath = request.url === "/v1/account-setup"
      || request.url === "/v1/transactional";
    if (request.method !== "POST" || !supportedDeliveryPath) {
      json(response, 404, { succeeded: false, error: "not_found" });
      return;
    }
    if (!String(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      json(response, 415, { succeeded: false, error: "unsupported_media_type" });
      return;
    }

    let rawBody = "";
    try {
      rawBody = await requestBodyText(request);
      if (!await verifyServiceRequestImpl({
        method: request.method,
        pathname: request.url,
        body: rawBody,
        headers: request.headers,
      })) {
        json(response, 401, { succeeded: false, error: "unauthorized" });
        return;
      }
      const payload = JSON.parse(rawBody);
      const deliveryImpl = request.url === "/v1/transactional"
        ? sendTransactionalEmailImpl
        : sendAccountSetupImpl;
      const result = await idempotentDelivery(payload, rawBody, deliveryImpl);
      json(response, 200, result);
    } catch (error) {
      const category = error instanceof Error && [
        "request_too_large",
        "email_not_configured",
        "provider_rate_limited",
        "provider_rejected",
        "provider_unavailable",
        "provider_content_too_large",
        "invalid_request",
      ].includes(error.message) ? error.message : "invalid_request";
      const disposition = error?.disposition === "retry" ? "retry"
        : error?.disposition === "uncertain" ? "uncertain"
          : error?.disposition === "configuration" ? "configuration" : "failed";
      const status = category === "request_too_large" ? 413
        : category === "invalid_request" ? 400
          : category === "email_not_configured" ? 503
            : 502;
      // Never log rawBody: account-setup and security messages may contain
      // short-lived bearer links or private workflow content.
      console.error(JSON.stringify({
        event: request.url === "/v1/transactional"
          ? "transactional_email_failed"
          : "account_setup_email_failed",
        category,
        disposition,
        providerStatus: error?.statusCode,
      }));
      json(response, status, { succeeded: false, error: category, disposition });
    }
  };
}

async function internalOutboxRequest(body, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
} = {}) {
  const url = outboxConfiguration(env);
  const rawBody = JSON.stringify(body);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...await signServiceRequest("POST", url.pathname, rawBody, { env, readFileImpl }),
    },
    body: rawBody,
    signal: AbortSignal.timeout(5_000),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  if (!response.ok) throw new Error("outbox_unavailable");
  return payload;
}

function providerFailureOutcome(error) {
  if (error?.disposition === "retry") {
    return {
      outcome: "retry",
      errorCode: error?.message === "provider_rate_limited"
        ? "provider_rate_limited" : "provider_unavailable",
      ...(Number.isInteger(error?.statusCode) ? { httpStatus: error.statusCode } : {}),
    };
  }
  if (error?.disposition === "configuration") {
    return {
      outcome: "paused",
      errorCode: "provider_configuration_incident",
      ...(Number.isInteger(error?.statusCode) ? { httpStatus: error.statusCode } : {}),
    };
  }
  if (error?.disposition === "uncertain") {
    return {
      outcome: "uncertain",
      errorCode: "provider_outcome_uncertain",
      ...(Number.isInteger(error?.statusCode) ? { httpStatus: error.statusCode } : {}),
    };
  }
  return {
    outcome: "failed",
    errorCode: "provider_rejected",
    ...(Number.isInteger(error?.statusCode) ? { httpStatus: error.statusCode } : {}),
  };
}

function completionProviderName(env) {
  const value = String(env?.AXORA_EMAIL_PROVIDER ?? "resend").trim();
  return ["resend", "test"].includes(value) ? value : "unconfigured";
}

export async function pollTransactionalEmailOutboxOnce(dependencies = {}) {
  const claim = await internalOutboxRequest({
    action: "claim",
    queue: "transactional",
  }, dependencies);
  const job = claim?.job;
  if (job === null) return { claimed: false };
  if (!job || !UUID_PATTERN.test(String(job.deliveryId ?? ""))
    || !UUID_PATTERN.test(String(job.leaseId ?? ""))) {
    throw new Error("outbox_unavailable");
  }

  let completion;
  try {
    const result = await sendTransactionalEmail(job, dependencies);
    completion = {
      outcome: "sent",
      ...(result.messageId ? { providerMessageId: result.messageId } : {}),
      providerName: result.providerName,
      providerAgent: result.providerAgent,
    };
  } catch (error) {
    completion = {
      ...providerFailureOutcome(error),
      providerName: completionProviderName(dependencies.env ?? process.env),
      providerAgent: job.providerAgent,
    };
  }
  await internalOutboxRequest({
    action: "complete",
    queue: "transactional",
    deliveryId: job.deliveryId,
    leaseId: job.leaseId,
    ...completion,
  }, dependencies);
  return { claimed: true, outcome: completion.outcome };
}

export async function pollWorkflowEmailOutboxOnce(dependencies = {}) {
  const claim = await internalOutboxRequest({
    action: "claim",
    queue: "workflow",
  }, dependencies);
  const job = claim?.job;
  if (job === null) return { claimed: false };
  if (!job || !UUID_PATTERN.test(String(job.deliveryId ?? ""))
    || !UUID_PATTERN.test(String(job.leaseId ?? ""))
    || job.messageKind !== "WORKFLOW_UPDATE") {
    throw new Error("outbox_unavailable");
  }

  let completion;
  try {
    const result = await sendTransactionalEmail(job, dependencies);
    completion = {
      outcome: "sent",
      ...(result.messageId ? { providerMessageId: result.messageId } : {}),
      providerName: result.providerName,
      providerAgent: result.providerAgent,
    };
  } catch (error) {
    completion = {
      ...providerFailureOutcome(error),
      providerName: completionProviderName(dependencies.env ?? process.env),
      providerAgent: job.providerAgent,
    };
  }
  await internalOutboxRequest({
    action: "complete",
    queue: "workflow",
    deliveryId: job.deliveryId,
    leaseId: job.leaseId,
    ...completion,
  }, dependencies);
  return { claimed: true, outcome: completion.outcome };
}

export function createEmailSenderServer(dependencies) {
  const server = createServer(createEmailSenderHandler(dependencies));
  server.timeout = SERVER_HANDLER_TIMEOUT_MS;
  server.requestTimeout = SERVER_HANDLER_TIMEOUT_MS;
  server.headersTimeout = 8_000;
  return server;
}

function senderPort(env) {
  const port = Number.parseInt(env.EMAIL_SENDER_PORT ?? "3100", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("EMAIL_SENDER_PORT must be a valid TCP port.");
  }
  return port;
}

function scheduleOutboxPoll(env = process.env) {
  let active = false;
  const timer = setInterval(async () => {
    if (active || !emailDeliveryEnabled(env)) return;
    active = true;
    try {
      try {
        await pollTransactionalEmailOutboxOnce({ env });
      } catch {
        console.error(JSON.stringify({ event: "transactional_email_outbox_poll_failed" }));
      }
      try {
        await pollWorkflowEmailOutboxOnce({ env });
      } catch {
        console.error(JSON.stringify({ event: "workflow_email_outbox_poll_failed" }));
      }
    } finally {
      active = false;
    }
  }, OUTBOX_POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}

export function startEmailSender({ env = process.env } = {}) {
  const port = senderPort(env);
  const server = createEmailSenderServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({ event: "email_sender_started", port, provider: "resend" }));
  });
  const pollTimer = scheduleOutboxPoll(env);
  server.on("close", () => clearInterval(pollTimer));
  return server;
}

export const emailSenderInternals = {
  deliveryCache,
  replayCache: seenServiceRequestIds,
};

const entrypoint = process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url) {
  startEmailSender();
}

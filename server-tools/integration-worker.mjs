import http from "node:http";
import https from "node:https";
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const DEFAULT_INTERVAL_MS = 5_000;
const MAX_RESPONSE_BYTES = 65_536;
const REQUEST_TIMEOUT_MS = 10_000;
const DNS_TIMEOUT_MS = 3_000;

function readSecret(path) {
  return path ? readFileSync(path, "utf8").trim() : undefined;
}

export function integrationWorkerDatabaseConfig(env = process.env) {
  if (env.DATABASE_URL) {
    if (env.NODE_ENV === "production") {
      throw new Error("Production integration worker database credentials must be file-mounted.");
    }
    let databaseUrl;
    try { databaseUrl = new URL(env.DATABASE_URL); } catch {
      throw new Error("Integration worker database configuration is incomplete.");
    }
    if (decodeURIComponent(databaseUrl.username) !== "axora_integration_worker") {
      throw new Error("Integration worker requires its dedicated database principal.");
    }
    return {
      connectionString: env.DATABASE_URL,
      ssl: env.DATABASE_SSL === "false"
        ? false
        : env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
          : undefined,
    };
  }
  const password = readSecret(env.DB_PASSWORD_FILE) ?? env.DB_PASSWORD;
  if (env.NODE_ENV === "production" && !env.DB_PASSWORD_FILE && env.DB_PASSWORD) {
    throw new Error("Production integration worker database credentials must be file-mounted.");
  }
  if (!env.DB_HOST || !env.DB_NAME
    || env.DB_USER !== "axora_integration_worker" || !password) {
    throw new Error("Integration worker database configuration is incomplete.");
  }
  const port = Number(env.DB_PORT ?? 5432);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Integration worker database configuration is incomplete.");
  }
  return {
    host: env.DB_HOST,
    port,
    database: env.DB_NAME,
    user: env.DB_USER,
    password,
  };
}

function integrationRootKey(env = process.env) {
  const filename = env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE?.trim();
  const inline = env.AXORA_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (env.NODE_ENV === "production" && inline) {
    throw new Error("Production integration encryption material must be file-mounted.");
  }
  const encoded = filename ? readSecret(filename) : inline;
  if (!encoded || !/^[A-Za-z0-9_-]{43,512}$/.test(encoded)) {
    throw new Error("Dedicated integration encryption material is unavailable.");
  }
  const key = Buffer.from(encoded, "base64url");
  if (key.byteLength < 32) throw new Error("Integration encryption material is too short.");
  return key;
}

function encryptionKey(rootKey, purpose) {
  return Buffer.from(hkdfSync(
    "sha256",
    rootKey,
    Buffer.from("axora-integration-encryption-v1", "utf8"),
    Buffer.from(purpose, "utf8"),
    32,
  ));
}

export function decryptWorkerIntegrationValue(rootKey, purpose, value) {
  if (!value || value.version !== 1
    || !/^[A-Za-z0-9_-]{16}$/.test(value.nonce)
    || !/^[A-Za-z0-9_-]{1,4096}$/.test(value.ciphertext)
    || !/^[A-Za-z0-9_-]{22}$/.test(value.tag)) {
    throw new Error("Integration ciphertext is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(rootKey, purpose),
    Buffer.from(value.nonce, "base64url"),
  );
  decipher.setAAD(Buffer.from(`axora:${purpose}:v1`, "utf8"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptWorkerIntegrationValue(rootKey, purpose, plaintext) {
  const nonce=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",encryptionKey(rootKey,purpose),nonce);
  cipher.setAAD(Buffer.from(`axora:${purpose}:v1`,"utf8"));
  const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
  return {
    version:1,nonce:nonce.toString("base64url"),
    ciphertext:ciphertext.toString("base64url"),
    tag:cipher.getAuthTag().toString("base64url"),
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Canonical webhook payloads require finite numbers.");
  }
  return value;
}

export function canonicalWebhookJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function webhookSignature(credential, timestamp, rawPayload) {
  if (!/^axora_whsec_[A-Za-z0-9_-]{43}$/.test(credential)
    || !Number.isSafeInteger(timestamp) || timestamp < 1) {
    throw new Error("Webhook signature inputs are invalid.");
  }
  return `v1=${createHmac("sha256", credential)
    .update(`${timestamp}.`, "utf8")
    .update(rawPayload, "utf8")
    .digest("hex")}`;
}

const forbiddenIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["168.63.129.16", 32], ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.31.196.0", 24],
  ["192.52.193.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["192.175.48.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) forbiddenIpv4Addresses.addSubnet(network, prefix, "ipv4");
const forbiddenIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["::", 96], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48],
  ["2001:10::", 28], ["2001:20::", 28], ["2001:30::", 28],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7],
  ["3fff::", 20], ["5f00::", 16], ["fe80::", 10], ["fec0::", 10],
  ["ff00::", 8],
]) forbiddenIpv6Addresses.addSubnet(network, prefix, "ipv6");

export function workerAddressIsPublic(address, family = isIP(address)) {
  if (family !== 4 && family !== 6) return false;
  try {
    return family === 4
      ? !forbiddenIpv4Addresses.check(address, "ipv4")
      : !forbiddenIpv6Addresses.check(address, "ipv6");
  } catch {
    return false;
  }
}

function unbracket(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function hostnameIsInternal(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return !normalized.includes(".") || normalized === "localhost"
    || normalized.endsWith(".localhost") || normalized.endsWith(".local")
    || normalized.endsWith(".internal") || normalized.endsWith(".home")
    || normalized.endsWith(".lan") || normalized.endsWith(".test")
    || normalized.endsWith(".invalid") || normalized.endsWith(".example");
}

export async function resolveWorkerWebhookDestination(endpoint, resolver = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true })) {
  let url;
  try { url = new URL(endpoint); } catch { throw Object.assign(new Error(), { category: "SSRF_BLOCKED" }); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash
    || (url.port && url.port !== "443") || endpoint.length > 2048) {
    throw Object.assign(new Error(), { category: "SSRF_BLOCKED" });
  }
  const originalHostname = unbracket(url.hostname).toLowerCase();
  const hostname = originalHostname.replace(/\.$/, "");
  if (hostname !== originalHostname) url.hostname = hostname;
  const family = isIP(hostname);
  if ((!family && hostnameIsInternal(hostname))
    || (family && !workerAddressIsPublic(hostname, family))) {
    throw Object.assign(new Error(), { category: "SSRF_BLOCKED" });
  }
  let addresses;
  try {
    if (family) {
      addresses = [{ address: hostname, family }];
    } else {
      let timer;
      try {
        addresses = await Promise.race([
          resolver(hostname),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Object.assign(new Error(), { code: "AXORA_DNS_TIMEOUT" })),
              DNS_TIMEOUT_MS,
            );
            timer.unref();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch {
    throw Object.assign(new Error(), { category: "DNS_ERROR" });
  }
  if (!addresses.length || addresses.length > 16
    || addresses.some((entry) => !workerAddressIsPublic(entry.address, entry.family))) {
    throw Object.assign(new Error(), { category: "SSRF_BLOCKED" });
  }
  const unique = [...new Map(addresses.map((entry) => [
    `${entry.family}:${entry.address}`,
    { address: entry.address, family: entry.family },
  ])).values()].sort((left, right) =>
    left.family - right.family || left.address.localeCompare(right.address));
  return { url, hostname, addresses: unique };
}

export function parseWebhookRetryAfter(value, nowMs = Date.now()) {
  if (!value) return undefined;
  if (/^\d{1,6}$/.test(value.trim())) {
    const seconds = Number(value.trim());
    return seconds >= 1 ? Math.min(seconds, 3600) : undefined;
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date) || date <= nowMs) return undefined;
  return Math.min(3600, Math.max(1, Math.ceil((date - nowMs) / 1000)));
}

export function webhookRetryDelaySeconds(cycleAttempt, retryAfter, random = Math.random) {
  if (retryAfter) return Math.min(3600, Math.max(1, retryAfter));
  const base = Math.min(3600, 5 * (2 ** Math.max(0, cycleAttempt - 1)));
  return Math.min(3600, Math.max(1, Math.round(base * (0.5 + random()))));
}

export function classifyWebhookStatus(status, retryAfterHeader, nowMs = Date.now()) {
  if (status >= 200 && status < 300) return { outcome: "SUCCEEDED", responseStatus:status };
  if (status === 429) return {
    outcome: "RETRY",
    errorCategory: "RATE_LIMITED",
    responseStatus:status,
    retryAfterSeconds: parseWebhookRetryAfter(retryAfterHeader, nowMs),
  };
  if (status === 408) return { outcome: "RETRY", errorCategory: "NETWORK_TIMEOUT", responseStatus:status };
  if (status >= 500 && status < 600) {
    return { outcome: "RETRY", errorCategory: "HTTP_SERVER_ERROR", responseStatus:status };
  }
  if (status >= 300 && status < 400) {
    return { outcome: "FAILED", errorCategory: "REDIRECT_REJECTED", responseStatus:status };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "FAILED", errorCategory: "HTTP_CLIENT_ERROR", responseStatus:status };
  }
  return { outcome: "FAILED", errorCategory: "UNKNOWN", responseStatus:status || undefined };
}

function networkErrorCategory(error) {
  if (error?.category) return error.category;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(error?.code)) return "DNS_ERROR";
  if (["ETIMEDOUT", "ESOCKETTIMEDOUT", "AXORA_TIMEOUT"].includes(error?.code)) {
    return "NETWORK_TIMEOUT";
  }
  if (String(error?.code ?? "").startsWith("CERT_")
    || String(error?.code ?? "").startsWith("ERR_TLS")) return "TLS_ERROR";
  return "CONNECTION_ERROR";
}

export function webhookPayloadForJob(job) {
  return {
    event_id: job.event_id,
    event_type: job.event_type,
    schema_version: Number(job.schema_version),
    occurred_at: new Date(job.occurred_at).toISOString(),
    company_id: job.company_id,
    resource_id: job.resource_id,
    resource_type: job.resource_type,
    resource_url: job.resource_url,
    data: job.summary ?? {},
  };
}

export async function deliverWebhookAttempt(input, options = {}) {
  const started = Date.now();
  try {
    const resolved = await resolveWorkerWebhookDestination(input.endpoint, options.resolver);
    const selected = resolved.addresses[(input.attemptNumber - 1) % resolved.addresses.length];
    const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
    const rawPayload = canonicalWebhookJson(input.payload);
    const headers = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(rawPayload, "utf8")),
      "user-agent": "Axora-Webhooks/1.0",
      "axora-event-id": input.payload.event_id,
      "axora-event-type": input.payload.event_type,
      "axora-event-schema-version": String(input.payload.schema_version),
      "axora-timestamp": String(timestamp),
      "axora-signature": webhookSignature(input.credential, timestamp, rawPayload),
    };
    const statusResult = await new Promise((resolveResult, rejectResult) => {
      let settled = false;
      let deadline;
      const settle = (value, reject = false) => {
        if (settled) return;
        settled = true;
        if (deadline) clearTimeout(deadline);
        (reject ? rejectResult : resolveResult)(value);
      };
      const request = (options.request ?? https.request)(resolved.url, {
        method: "POST",
        headers,
        agent: false,
        family: selected.family,
        servername: isIP(resolved.hostname) ? undefined : resolved.hostname,
        lookup(_hostname, _lookupOptions, callback) {
          callback(null, selected.address, selected.family);
        },
      }, (response) => {
        let responseBytes = 0;
        response.on("data", (chunk) => {
          responseBytes += Buffer.byteLength(chunk);
          if (responseBytes > (options.maxResponseBytes ?? MAX_RESPONSE_BYTES)) {
            response.destroy();
            settle({ outcome: "FAILED", errorCategory: "RESPONSE_TOO_LARGE" });
          }
        });
        response.on("end", () => settle(classifyWebhookStatus(
          Number(response.statusCode ?? 0),
          Array.isArray(response.headers["retry-after"])
            ? response.headers["retry-after"][0]
            : response.headers["retry-after"],
        )));
        response.on("error", (error) => settle(error, true));
      });
      request.on("socket", (socket) => {
        socket.once("connect", () => {
          if (socket.remoteAddress && !workerAddressIsPublic(socket.remoteAddress)) {
            request.destroy(Object.assign(new Error(), { category: "SSRF_BLOCKED" }));
          }
        });
      });
      request.setTimeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS, () => {
        request.destroy(Object.assign(new Error(), { code: "AXORA_TIMEOUT" }));
      });
      // ClientRequest#setTimeout is an inactivity timeout, so a receiver could
      // otherwise keep a worker slot occupied indefinitely by trickling bytes.
      // This independent deadline bounds the entire request/response exchange.
      deadline = setTimeout(() => {
        request.destroy(Object.assign(new Error(), { code: "AXORA_TIMEOUT" }));
      }, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      deadline.unref();
      request.on("error", (error) => settle(error, true));
      request.end(rawPayload);
    });
    return {
      ...statusResult,
      durationMs: Math.min(120_000, Date.now() - started),
    };
  } catch (error) {
    return {
      outcome: networkErrorCategory(error) === "SSRF_BLOCKED" ? "FAILED" : "RETRY",
      errorCategory: networkErrorCategory(error),
      durationMs: Math.min(120_000, Date.now() - started),
    };
  }
}

async function completeDelivery(db, workerId, job, result) {
  const retryAfter = result.outcome === "RETRY"
    ? webhookRetryDelaySeconds(
      Number(job.cycle_attempt_number),
      result.retryAfterSeconds,
    )
    : null;
  await db.query(
    "SELECT public.axora_complete_integration_webhook_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) AS status",
    [
      workerId, job.delivery_id, job.lease_token, result.outcome,
      result.responseStatus ?? null, result.errorCategory ?? null,
      result.durationMs, retryAfter, Number(job.credential_version),
    ],
  );
}

function isZapierWebhookEndpoint(endpoint) {
  try {
    const parsed=new URL(endpoint);
    return parsed.protocol==="https:" && parsed.hostname==="hooks.zapier.com";
  } catch {
    return false;
  }
}

async function processWebhookJob(
  db,workerId,rootKey,deliver,zapierEnabled,job,
) {
  const authorization = await db.query(
    "SELECT public.axora_claimed_webhook_delivery_is_authorized($1,$2,$3,now()) AS allowed",
    [workerId,job.delivery_id,job.lease_token],
  );
  if (authorization.rows[0]?.allowed !== true) {
    await completeDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"AUTHORIZATION_REVOKED",durationMs:0,
    });
    return;
  }
  let endpoint;
  try {
    endpoint = decryptWorkerIntegrationValue(
      rootKey,`webhook-endpoint:${job.subscription_id}`,job.endpoint_ciphertext,
    );
  } catch {
    await completeDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"CONFIGURATION_ERROR",durationMs:0,
    });
    return;
  }
  if (!zapierEnabled && isZapierWebhookEndpoint(endpoint)) {
    await completeDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"CONFIGURATION_ERROR",durationMs:0,
    });
    return;
  }
  let credential;
  try {
    credential = decryptWorkerIntegrationValue(
      rootKey,`webhook-credential:${job.subscription_id}`,job.credential_ciphertext,
    );
  } catch {
    await completeDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"CONFIGURATION_ERROR",durationMs:0,
    });
    return;
  }
  const result = await deliver({
    endpoint,credential,attemptNumber:Number(job.attempt_number),
    payload:webhookPayloadForJob(job),
  });
  await completeDelivery(db,workerId,job,result);
}

export function slackWorkerConfiguration(env=process.env) {
  const inline=env.AXORA_SLACK_CLIENT_SECRET?.trim();
  if (env.NODE_ENV==="production" && inline) {
    throw new Error("Production Slack credentials must be file-mounted.");
  }
  const clientId=env.AXORA_SLACK_CLIENT_ID?.trim()??"";
  const clientSecret=env.AXORA_SLACK_CLIENT_SECRET_FILE
    ? readSecret(env.AXORA_SLACK_CLIENT_SECRET_FILE):inline;
  let origin;
  try { origin=new URL(env.APP_BASE_URL??"https://axora.management"); }
  catch { throw new Error("Slack worker configuration is unavailable."); }
  if (!/^\d{6,20}\.\d{6,20}$/.test(clientId)
    || !clientSecret || clientSecret.length<24 || clientSecret.length>512
    || /[\s\x00-\x1f\x7f]/.test(clientSecret)
    || origin.protocol!=="https:" || origin.pathname!=="/"
    || origin.search || origin.hash || origin.username || origin.password) {
    throw new Error("Slack worker configuration is unavailable.");
  }
  return {clientId,clientSecret,origin:origin.origin};
}

function slackAccessPurpose(installationId,tokenVersion) {
  return `slack-access-token:${installationId}:v${tokenVersion}`;
}

function slackRefreshPurpose(installationId,tokenVersion) {
  return `slack-refresh-token:${installationId}:v${tokenVersion}`;
}

function safeSlackText(value,maximum=120) {
  if (typeof value!=="string") return undefined;
  const normalized=value.replace(/[\x00-\x1f\x7f]/g," ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0,maximum);
}

function safeAmount(value) {
  const text=safeSlackText(value,40);
  return text&&/^-?\d{1,20}(?:\.\d{1,4})?$/.test(text)?text:undefined;
}

function safeCurrency(value) {
  const text=safeSlackText(value,3);
  return text&&/^[A-Z]{3}$/.test(text)?text:undefined;
}

export function slackMessageForJob(job,origin) {
  const titles={
    "request.submitted":"Purchase request submitted",
    "request.approved":"Purchase request approved",
    "invoice.finalized":"Customer invoice finalized",
    "delivery.out_for_delivery":"Delivery is out for delivery",
    "delivery.completed":"Delivery completed",
  };
  const title=titles[job.event_type];
  if (!title || !/^[0-9a-f-]{36}$/.test(job.resource_id)
    || !["request","invoice","delivery"].includes(job.resource_type)) {
    throw new Error("Slack event payload is unavailable.");
  }
  const summary=job.summary&&typeof job.summary==="object"?job.summary:{};
  const order=safeSlackText(summary.order_code,80);
  const invoice=safeSlackText(summary.invoice_number,80);
  const delivery=safeSlackText(summary.job_code,80);
  const branch=safeSlackText(summary.branch_name,120);
  const currency=safeCurrency(summary.currency);
  const total=safeAmount(summary.total);
  const path=job.resource_type==="request"
    ? `/requests/${encodeURIComponent(job.resource_id)}`
    :job.resource_type==="delivery"?"/deliveries":"/finance";
  const link=new URL(path,origin).toString();
  const facts=[];
  if (order) facts.push({type:"plain_text",text:`Order: ${order}`});
  if (invoice) facts.push({type:"plain_text",text:`Invoice: ${invoice}`});
  if (delivery) facts.push({type:"plain_text",text:`Delivery: ${delivery}`});
  if (branch) facts.push({type:"plain_text",text:`Branch: ${branch}`});
  if (currency&&total) facts.push({type:"plain_text",text:`Total: ${currency} ${total}`});
  const fallback=[title,...facts.map((fact)=>fact.text),`Open in Axora: ${link}`].join(". ");
  return {
    channel:job.channel_id,
    client_msg_id:job.event_id,
    text:fallback.slice(0,4000),
    blocks:[
      {type:"header",text:{type:"plain_text",text:title}},
      ...(facts.length?[{type:"section",fields:facts}]:[]),
      {type:"actions",elements:[{
        type:"button",text:{type:"plain_text",text:"Open in Axora"},url:link,
        action_id:"open_in_axora",
      }]},
    ],
    mrkdwn:false,unfurl_links:false,unfurl_media:false,
  };
}

async function boundedFetchText(response,maximum=MAX_RESPONSE_BYTES) {
  const declared=Number(response.headers.get("content-length")??0);
  if (Number.isFinite(declared)&&declared>maximum) {
    throw Object.assign(new Error(),{category:"INVALID_RESPONSE"});
  }
  if (!response.body) return "";
  const reader=response.body.getReader();
  const chunks=[];
  let received=0;
  while(true) {
    const {value,done}=await reader.read();
    if(done)break;
    received+=value.byteLength;
    if(received>maximum) {
      await reader.cancel();
      throw Object.assign(new Error(),{category:"INVALID_RESPONSE"});
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk)=>Buffer.from(chunk)),received).toString("utf8");
}

function slackRetryAfter(response) {
  const value=response.headers.get("retry-after")?.trim()??"";
  if(!/^\d{1,5}$/.test(value))return undefined;
  const seconds=Number(value);
  return seconds>=1&&seconds<=86400?seconds:undefined;
}

function slackApiFailure(error,status=200,retryAfterSeconds) {
  if (["invalid_auth","token_revoked","token_expired","account_inactive"]
    .includes(error)) return {outcome:"FAILED",errorCategory:"TOKEN_REVOKED",responseStatus:status};
  if (error==="missing_scope") {
    return {outcome:"FAILED",errorCategory:"MISSING_SCOPE",responseStatus:status};
  }
  if (["channel_not_found","not_in_channel","is_archived","no_permission",
    "restricted_action_read_only_channel","team_access_not_granted"].includes(error)) {
    return {outcome:"FAILED",errorCategory:"CHANNEL_UNAVAILABLE",responseStatus:status};
  }
  if (["ratelimited","rate_limited"].includes(error)) {
    return {outcome:"RETRY",errorCategory:"RATE_LIMITED",responseStatus:status,retryAfterSeconds};
  }
  if (["internal_error","fatal_error","service_unavailable","request_timeout"]
    .includes(error)) {
    return {outcome:"RETRY",errorCategory:"PROVIDER_UNAVAILABLE",responseStatus:status};
  }
  return {outcome:"FAILED",errorCategory:"PROVIDER_REJECTED",responseStatus:status};
}

export async function deliverSlackAttempt(input,options={}) {
  const started=Date.now();
  try {
    const response=await (options.fetchImpl??fetch)("https://slack.com/api/chat.postMessage",{
      method:"POST",headers:{
        Accept:"application/json","Content-Type":"application/json;charset=UTF-8",
        Authorization:`Bearer ${input.accessToken}`,
        "User-Agent":"Axora-Slack/1.0",
      },body:JSON.stringify(input.message),redirect:"error",
      signal:AbortSignal.timeout(options.timeoutMs??REQUEST_TIMEOUT_MS),
    });
    const text=await boundedFetchText(response,options.maxResponseBytes);
    let result;
    if(response.status===429) {
      result={outcome:"RETRY",errorCategory:"RATE_LIMITED",responseStatus:429,
        retryAfterSeconds:slackRetryAfter(response)};
    } else if(response.status>=500) {
      result={outcome:"RETRY",errorCategory:"PROVIDER_UNAVAILABLE",responseStatus:response.status};
    } else if(response.status!==200) {
      result={outcome:"FAILED",errorCategory:"PROVIDER_REJECTED",responseStatus:response.status};
    } else {
      let payload;
      try {payload=JSON.parse(text);} catch {payload=undefined;}
      if(payload?.ok===true&&typeof payload.ts==="string") {
        result={outcome:"SUCCEEDED",responseStatus:200};
      } else if(payload?.ok===false&&typeof payload.error==="string") {
        result=slackApiFailure(payload.error,200,slackRetryAfter(response));
      } else {
        result={outcome:"FAILED",errorCategory:"INVALID_RESPONSE",responseStatus:200};
      }
    }
    return {...result,durationMs:Math.min(120000,Date.now()-started)};
  } catch(error) {
    const timedOut=error?.name==="TimeoutError"||error?.name==="AbortError";
    const invalid=error?.category==="INVALID_RESPONSE";
    return {outcome:invalid?"FAILED":"RETRY",
      errorCategory:invalid?"INVALID_RESPONSE":timedOut?"TIMEOUT":"NETWORK_ERROR",
      durationMs:Math.min(120000,Date.now()-started)};
  }
}

async function refreshSlackWorkerToken(configuration,refreshToken,options={}) {
  const started=Date.now();
  try {
    const form=new URLSearchParams({
      client_id:configuration.clientId,client_secret:configuration.clientSecret,
      grant_type:"refresh_token",refresh_token:refreshToken,
    });
    const response=await (options.fetchImpl??fetch)("https://slack.com/api/oauth.v2.access",{
      method:"POST",headers:{
        Accept:"application/json",
        "Content-Type":"application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent":"Axora-Slack/1.0",
      },body:form.toString(),redirect:"error",
      signal:AbortSignal.timeout(options.timeoutMs??REQUEST_TIMEOUT_MS),
    });
    const text=await boundedFetchText(response);
    if(response.status===429)return {failure:{
      outcome:"RETRY",errorCategory:"RATE_LIMITED",responseStatus:429,
      retryAfterSeconds:slackRetryAfter(response),durationMs:Date.now()-started,
    }};
    if(response.status>=500)return {failure:{
      outcome:"RETRY",errorCategory:"PROVIDER_UNAVAILABLE",
      responseStatus:response.status,durationMs:Date.now()-started,
    }};
    let payload;
    try {payload=JSON.parse(text);}catch{return {failure:{
      outcome:"FAILED",errorCategory:"INVALID_RESPONSE",
      responseStatus:response.status,durationMs:Date.now()-started,
    }}};
    if(payload?.ok===false&&typeof payload.error==="string")return {failure:{
      ...slackApiFailure(payload.error,response.status,slackRetryAfter(response)),
      durationMs:Date.now()-started,
    }};
    const scopes=typeof payload?.scope==="string"
      ?[...new Set(payload.scope.split(/[ ,]+/).filter(Boolean))].sort():[];
    if(payload?.ok!==true
      || !/^(?:xoxb-|xoxe\.xoxb-)[A-Za-z0-9._-]{12,512}$/.test(payload.access_token??"")
      || !/^xoxe-[A-Za-z0-9._-]{12,512}$/.test(payload.refresh_token??"")
      || !Number.isInteger(payload.expires_in)||payload.expires_in<300
      || payload.expires_in>43200
      || scopes.join(",")!=="channels:read,chat:write")return {failure:{
        outcome:"FAILED",errorCategory:"MISSING_SCOPE",
        responseStatus:response.status,durationMs:Date.now()-started,
      }};
    return {accessToken:payload.access_token,refreshToken:payload.refresh_token,
      expiresIn:payload.expires_in};
  } catch(error) {
    const timedOut=error?.name==="TimeoutError"||error?.name==="AbortError";
    const invalid=error?.category==="INVALID_RESPONSE";
    return {failure:{outcome:invalid?"FAILED":"RETRY",
      errorCategory:invalid?"INVALID_RESPONSE":timedOut?"TIMEOUT":"NETWORK_ERROR",
      durationMs:Math.min(120000,Date.now()-started)}};
  }
}

async function completeSlackDelivery(db,workerId,job,result,tokenVersion) {
  const retryAfter=result.outcome==="RETRY"
    ?webhookRetryDelaySeconds(Number(job.cycle_attempt_number),result.retryAfterSeconds):null;
  await db.query(
    "SELECT public.axora_complete_integration_slack_delivery($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) AS status",
    [workerId,job.delivery_id,job.lease_token,result.outcome,
      result.responseStatus??null,result.errorCategory??null,
      Math.min(120000,Math.max(0,Number(result.durationMs??0))),retryAfter,tokenVersion],
  );
}

async function processSlackJob(
  db,workerId,rootKey,configuration,deliver,job,
) {
  let tokenVersion=Number(job.token_version);
  const authorized=await db.query(
    "SELECT public.axora_claimed_slack_delivery_is_authorized($1,$2,$3,now()) AS allowed",
    [workerId,job.delivery_id,job.lease_token],
  );
  if(authorized.rows[0]?.allowed!==true) {
    await completeSlackDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"AUTHORIZATION_REVOKED",durationMs:0,
    },tokenVersion);
    return;
  }
  let accessToken;
  try {
    accessToken=decryptWorkerIntegrationValue(
      rootKey,slackAccessPurpose(job.installation_id,tokenVersion),
      job.access_token_ciphertext,
    );
  } catch {
    await completeSlackDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"INVALID_RESPONSE",durationMs:0,
    },tokenVersion);
    return;
  }
  if(new Date(job.access_token_expires_at).getTime()<=Date.now()+5*60_000) {
    let refreshToken;
    try {
      refreshToken=decryptWorkerIntegrationValue(
        rootKey,slackRefreshPurpose(job.installation_id,tokenVersion),
        job.refresh_token_ciphertext,
      );
    } catch {
      await completeSlackDelivery(db,workerId,job,{
        outcome:"FAILED",errorCategory:"TOKEN_REVOKED",durationMs:0,
      },tokenVersion);
      return;
    }
    const rotated=await refreshSlackWorkerToken(configuration,refreshToken);
    if(rotated.failure) {
      await completeSlackDelivery(db,workerId,job,rotated.failure,tokenVersion);
      return;
    }
    const nextVersion=tokenVersion+1;
    const expiresAt=new Date(Date.now()+rotated.expiresIn*1000);
    const updated=await db.query(
      "SELECT public.axora_rotate_claimed_slack_token($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,now()) AS version",
      [workerId,job.delivery_id,job.lease_token,tokenVersion,
        JSON.stringify(encryptWorkerIntegrationValue(
          rootKey,slackAccessPurpose(job.installation_id,nextVersion),rotated.accessToken,
        )),
        JSON.stringify(encryptWorkerIntegrationValue(
          rootKey,slackRefreshPurpose(job.installation_id,nextVersion),rotated.refreshToken,
        )),expiresAt],
    );
    tokenVersion=Number(updated.rows[0]?.version);
    accessToken=rotated.accessToken;
  }
  const reauthorized=await db.query(
    "SELECT public.axora_claimed_slack_delivery_is_authorized($1,$2,$3,now()) AS allowed",
    [workerId,job.delivery_id,job.lease_token],
  );
  if(reauthorized.rows[0]?.allowed!==true) {
    await completeSlackDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"AUTHORIZATION_REVOKED",durationMs:0,
    },tokenVersion);
    return;
  }
  let message;
  try {message=slackMessageForJob(job,configuration.origin);}
  catch {
    await completeSlackDelivery(db,workerId,job,{
      outcome:"FAILED",errorCategory:"INVALID_RESPONSE",durationMs:0,
    },tokenVersion);
    return;
  }
  const result=await deliver({accessToken,message});
  await completeSlackDelivery(db,workerId,job,result,tokenVersion);
}

async function revokeSlackWorkerToken(token,options={}) {
  try {
    const response=await (options.fetchImpl??fetch)("https://slack.com/api/auth.revoke",{
      method:"POST",headers:{
        Accept:"application/json",Authorization:`Bearer ${token}`,
        "Content-Type":"application/json;charset=UTF-8",
        "User-Agent":"Axora-Slack/1.0",
      },body:"{}",redirect:"error",signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text=await boundedFetchText(response);
    if(response.status===429)return {succeeded:false,errorCategory:"RATE_LIMITED",
      retryAfterSeconds:slackRetryAfter(response)};
    if(response.status>=500)return {succeeded:false,errorCategory:"PROVIDER_UNAVAILABLE"};
    let payload;
    try {payload=JSON.parse(text);}catch{return {succeeded:false,errorCategory:"INVALID_RESPONSE"};}
    if(payload?.ok===true)return {succeeded:true};
    if(payload?.ok===false&&["invalid_auth","token_revoked","token_expired"]
      .includes(payload.error))return {succeeded:true};
    return {succeeded:false,errorCategory:"INVALID_RESPONSE"};
  } catch {
    return {succeeded:false,errorCategory:"NETWORK_ERROR"};
  }
}

async function processSlackRevocation(db,workerId,rootKey,job,revoke) {
  const version=Number(job.token_version);
  let accessToken;
  let refreshToken;
  try {
    accessToken=decryptWorkerIntegrationValue(rootKey,
      slackAccessPurpose(job.installation_id,version),job.access_token_ciphertext);
    refreshToken=decryptWorkerIntegrationValue(rootKey,
      slackRefreshPurpose(job.installation_id,version),job.refresh_token_ciphertext);
  } catch {
    await db.query(
      "SELECT public.axora_complete_slack_revocation($1,$2,$3,false,'INVALID_RESPONSE',null,now()) AS status",
      [workerId,job.installation_id,job.lease_token],
    );
    return;
  }
  const results=await Promise.all([
    revoke(accessToken),revoke(refreshToken),
  ]);
  const failed=results.find((result)=>!result.succeeded);
  await db.query(
    "SELECT public.axora_complete_slack_revocation($1,$2,$3,$4,$5,$6,now()) AS status",
    [workerId,job.installation_id,job.lease_token,!failed,
      failed?.errorCategory??null,failed?.retryAfterSeconds??null],
  );
}

export async function pollIntegrationWorkerOnce({
  db,
  workerId,
  enabled = true,
  webhooksEnabled = enabled,
  zapierEnabled = false,
  slackEnabled = false,
  slackConfiguration,
  rootKey,
  deliver = deliverWebhookAttempt,
  deliverSlack = deliverSlackAttempt,
  revokeSlack = revokeSlackWorkerToken,
  runCleanup = false,
}) {
  if (!enabled) return { projected: false, claimed: 0, disabled: true };
  await db.query(
    "SELECT public.axora_project_integration_events_with_capabilities(100,now(),$1,$2) AS result",
    [webhooksEnabled,slackEnabled],
  );
  const claimed = webhooksEnabled ? await db.query(`
      SELECT
        delivery_id::text,event_id::text,subscription_id::text,company_id::text,
        attempt_number,cycle_attempt_number,credential_version,
        endpoint_ciphertext,credential_ciphertext,event_type,schema_version,
        occurred_at::text,resource_type,resource_id::text,resource_url,summary,
        lease_token::text
      FROM public.axora_claim_integration_webhook_deliveries($1,10,45,now())
    `,[workerId]) : { rows:[] };
  const webhookDeliveries=await Promise.allSettled(claimed.rows.map((job)=>
    processWebhookJob(db,workerId,rootKey,deliver,zapierEnabled,job)));
  const slackClaimed=slackEnabled ? await db.query(`
      SELECT delivery_id::text,event_id::text,installation_id::text,
        connection_id::text,company_id::text,attempt_number,
        cycle_attempt_number,token_version,access_token_ciphertext,
        refresh_token_ciphertext,access_token_expires_at::text,
        workspace_id,channel_id,event_type,schema_version,occurred_at::text,
        resource_type,resource_id::text,resource_url,summary,lease_token::text
      FROM public.axora_claim_integration_slack_deliveries($1,10,45,now())
    `,[workerId]) : { rows:[] };
  const slackDeliveries=await Promise.allSettled(slackClaimed.rows.map((job)=>
    processSlackJob(
      db,workerId,rootKey,slackConfiguration,deliverSlack,job,
    )));
  const revocations=slackEnabled ? await db.query(`
      SELECT installation_id::text,token_version,access_token_ciphertext,
        refresh_token_ciphertext,attempt_number,lease_token::text
      FROM public.axora_claim_slack_revocations($1,5,45,now())
    `,[workerId]) : { rows:[] };
  const revoked=await Promise.allSettled(revocations.rows.map((job)=>
    processSlackRevocation(db,workerId,rootKey,job,revokeSlack)));
  const failedJobs=[...webhookDeliveries,...slackDeliveries,...revoked]
    .filter((result)=>result.status==="rejected").length;
  if (runCleanup) {
    await db.query("SELECT public.axora_cleanup_integration_runtime(now()) AS result");
    await db.query("SELECT public.axora_cleanup_slack_runtime(now()) AS result");
  }
  return {
    projected:true,
    claimed:claimed.rows.length+slackClaimed.rows.length+revocations.rows.length,
    webhookClaimed:claimed.rows.length,slackClaimed:slackClaimed.rows.length,
    revocationsClaimed:revocations.rows.length,failedJobs,disabled:false,
  };
}

export function createIntegrationWorkerServer(state) {
  return http.createServer((request, response) => {
    if (request.method !== "GET"
      || (request.url !== "/health/live" && request.url !== "/health/ready")) {
      response.writeHead(404).end();
      return;
    }
    const ready = request.url === "/health/live" || !state.enabled
      || (state.lastSuccessfulPollAt
        && Date.now() - state.lastSuccessfulPollAt < state.maxReadyAgeMs);
    response.writeHead(ready ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({
      status: ready ? "ok" : "not_ready",
      enabled: state.enabled,
      active: state.active,
      providers: { zapier: state.zapierEnabled,slack:state.slackEnabled },
    }));
  });
}

export function startIntegrationWorker({ env = process.env } = {}) {
  const workerId = env.INTEGRATION_WORKER_ID ?? `integration-${randomUUID()}`;
  const intervalMs = Number(env.INTEGRATION_WORKER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const port=Number(env.INTEGRATION_WORKER_PORT ?? 3104);
  if (!/^integration-[A-Za-z0-9_-]{8,120}$/.test(workerId)
    || !Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000
    || !Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Integration worker runtime configuration is invalid.");
  }
  const webhooksEnabled=env.AXORA_INTEGRATION_WEBHOOKS_ENABLED==="true";
  const zapierEnabled = env.AXORA_ZAPIER_ENABLED === "true";
  const slackEnabled=env.AXORA_SLACK_ENABLED==="true";
  const enabled=webhooksEnabled||slackEnabled;
  const slackConfiguration=slackEnabled?slackWorkerConfiguration(env):undefined;
  const state = {
    workerId,enabled,webhooksEnabled,zapierEnabled,slackEnabled,active:false,
    lastSuccessfulPollAt:enabled ? 0 : Date.now(),
    lastCleanupAt:0,maxReadyAgeMs:Math.max(intervalMs*6,60_000),
  };
  const db = new pg.Pool({
    ...integrationWorkerDatabaseConfig(env),max:2,
    connectionTimeoutMillis:10_000,idleTimeoutMillis:30_000,
    statement_timeout:15_000,query_timeout:20_000,
    application_name:"axora-integration-worker",
  });
  const rootKey = enabled ? integrationRootKey(env) : undefined;
  const poll = async () => {
    if (state.active) return;
    state.active = true;
    try {
      const runCleanup = Date.now()-state.lastCleanupAt>=60*60_000;
      const result=await pollIntegrationWorkerOnce({
        db,workerId,enabled,webhooksEnabled,zapierEnabled,slackEnabled,
        slackConfiguration,rootKey,runCleanup,
      });
      if (result.failedJobs) {
        console.error(JSON.stringify({
          event:"integration_worker_delivery_completion_failed",
          count:result.failedJobs,
        }));
      }
      state.lastSuccessfulPollAt=Date.now();
      if (runCleanup) state.lastCleanupAt=Date.now();
    } catch {
      console.error(JSON.stringify({ event:"integration_worker_poll_failed" }));
    } finally {
      state.active=false;
    }
  };
  void poll();
  const timer=setInterval(()=>void poll(),intervalMs);
  timer.unref();
  const server=createIntegrationWorkerServer(state);
  const shutdown=()=>server.close();
  process.once("SIGTERM",shutdown);
  process.once("SIGINT",shutdown);
  server.listen(port,"0.0.0.0",()=>{
    console.log(JSON.stringify({
      event:"integration_worker_started",port,enabled,
      webhooksEnabled,zapierEnabled,slackEnabled,
    }));
  });
  server.on("close",()=>{
    process.off("SIGTERM",shutdown);process.off("SIGINT",shutdown);
    clearInterval(timer);void db.end();
  });
  return { server,state,shutdown };
}

const entrypoint=process.argv[1];
if (entrypoint && pathToFileURL(resolve(entrypoint)).href===import.meta.url) {
  startIntegrationWorker();
}

import http from "node:http";
import https from "node:https";
import { createDecipheriv, createHmac, hkdfSync, randomUUID } from "node:crypto";
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

export async function pollIntegrationWorkerOnce({
  db,
  workerId,
  enabled = true,
  zapierEnabled = false,
  rootKey,
  deliver = deliverWebhookAttempt,
  runCleanup = false,
}) {
  if (!enabled) return { projected: false, claimed: 0, disabled: true };
  await db.query("SELECT public.axora_project_integration_events(100,now()) AS result");
  const claimed = await db.query(`
    SELECT
      delivery_id::text,event_id::text,subscription_id::text,company_id::text,
      attempt_number,cycle_attempt_number,credential_version,
      endpoint_ciphertext,credential_ciphertext,event_type,schema_version,
      occurred_at::text,resource_type,resource_id::text,resource_url,summary,
      lease_token::text
    FROM public.axora_claim_integration_webhook_deliveries($1,10,45,now())
  `, [workerId]);
  const deliveries = await Promise.allSettled(claimed.rows.map((job) =>
    processWebhookJob(db,workerId,rootKey,deliver,zapierEnabled,job)));
  const failedJobs=deliveries.filter((result)=>result.status==="rejected").length;
  if (runCleanup) {
    await db.query("SELECT public.axora_cleanup_integration_runtime(now()) AS result");
  }
  return {
    projected: true,claimed: claimed.rows.length,failedJobs,disabled: false,
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
      providers: { zapier: state.zapierEnabled },
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
  const enabled = env.AXORA_INTEGRATION_WEBHOOKS_ENABLED === "true";
  const zapierEnabled = env.AXORA_ZAPIER_ENABLED === "true";
  const state = {
    workerId,enabled,zapierEnabled,active:false,
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
        db,workerId,enabled,zapierEnabled,rootKey,runCleanup,
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
      event:"integration_worker_started",port,enabled,zapierEnabled,
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

import { createCipheriv, createHmac, hkdfSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalWebhookJson,
  classifyWebhookStatus,
  decryptWorkerIntegrationValue,
  deliverWebhookAttempt,
  integrationWorkerDatabaseConfig,
  parseWebhookRetryAfter,
  pollIntegrationWorkerOnce,
  resolveWorkerWebhookDestination,
  webhookRetryDelaySeconds,
  webhookSignature,
  workerAddressIsPublic,
} from "../server-tools/integration-worker.mjs";

const PUBLIC_IPV4 = "93.184.216.34";
const endpoint = "https://hooks.receiver.dev/axora";
const credential = `axora_whsec_${"b".repeat(43)}`;
const payload = {
  event_id: "10000000-0000-4000-8000-000000000001",
  event_type: "request.approved",
  schema_version: 1,
  occurred_at: "2026-08-29T00:00:00.000Z",
  company_id: "10000000-0000-4000-8000-000000000002",
  resource_id: "10000000-0000-4000-8000-000000000003",
  resource_type: "request",
  resource_url: "/api/v1/requests/10000000-0000-4000-8000-000000000003",
  data: { order_code: "ORD-FICTIONAL" },
};

function encryptedWorkerValue(rootKey,purpose,plaintext) {
  const nonce=Buffer.alloc(12,purpose.includes("endpoint") ? 0x30 : 0x31);
  const key=Buffer.from(hkdfSync(
    "sha256",rootKey,Buffer.from("axora-integration-encryption-v1"),
    Buffer.from(purpose),32,
  ));
  const cipher=createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(Buffer.from(`axora:${purpose}:v1`));
  const encrypted=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
  return {
    version:1,
    nonce:nonce.toString("base64url"),
    ciphertext:encrypted.toString("base64url"),
    tag:cipher.getAuthTag().toString("base64url"),
  };
}

function requestFixture({
  status = 204,
  headers = {},
  chunks = [],
  requestError,
  triggerTimeout = false,
  remoteAddress = PUBLIC_IPV4,
  inspect,
} = {}) {
  return (url, options, callback) => {
    inspect?.(url, options);
    const request = new EventEmitter();
    let timeoutHandler;
    let destroyedError;
    request.setTimeout = (_milliseconds, handler) => {
      timeoutHandler = handler;
      return request;
    };
    request.destroy = (error) => {
      destroyedError = error;
      return request;
    };
    request.end = () => queueMicrotask(() => {
      const socket = new EventEmitter();
      socket.remoteAddress = remoteAddress;
      request.emit("socket", socket);
      socket.emit("connect");
      if (destroyedError) {
        request.emit("error", destroyedError);
        return;
      }
      if (requestError) {
        request.emit("error", requestError);
        return;
      }
      if (triggerTimeout) {
        timeoutHandler?.();
        if (destroyedError) request.emit("error", destroyedError);
        return;
      }
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = headers;
      response.destroy = () => response;
      callback(response);
      for (const chunk of chunks) response.emit("data", chunk);
      response.emit("end");
    });
    return request;
  };
}

const deliver = (fixture, overrides = {}) => deliverWebhookAttempt({
  endpoint,
  credential,
  attemptNumber: 1,
  payload,
}, {
  resolver: async () => [{ address: PUBLIC_IPV4, family: 4 }],
  request: requestFixture(fixture),
  timestamp: 1_800_000_000,
  ...overrides,
});

describe("isolated webhook worker security", () => {
  it("decrypts only the app's authenticated integration envelope", () => {
    const rootKey=Buffer.alloc(32,0x51);
    const purpose="webhook-credential:fictional-subscription";
    const envelope=encryptedWorkerValue(rootKey,purpose,credential);
    expect(decryptWorkerIntegrationValue(rootKey,purpose,envelope)).toBe(credential);
    expect(()=>decryptWorkerIntegrationValue(rootKey,purpose,{
      ...envelope,tag:envelope.tag.slice(1),
    })).toThrow(/ciphertext/i);
  });

  it("requires the dedicated database principal and file-mounted production secret", () => {
    expect(() => integrationWorkerDatabaseConfig({
      NODE_ENV: "production",
      DB_HOST: "db",
      DB_NAME: "axora",
      DB_USER: "axora_app",
      DB_PASSWORD: "fixture",
    })).toThrow(/dedicated|incomplete|file-mounted/i);
    expect(() => integrationWorkerDatabaseConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://axora_integration_worker:fixture@db/axora",
    })).toThrow(/file-mounted/i);
    expect(() => integrationWorkerDatabaseConfig({
      DATABASE_URL: "postgres://axora_app:fixture@db/axora",
    })).toThrow(/dedicated/i);
  });

  it("does no database work while the independent flag is disabled", async () => {
    const db = { query: vi.fn() };
    await expect(pollIntegrationWorkerOnce({
      db,
      workerId: "integration-fixture01",
      enabled: false,
    })).resolves.toEqual({ projected: false, claimed: 0, disabled: true });
    expect(db.query).not.toHaveBeenCalled();
  });

  it("contains one delivery failure without abandoning other claimed work", async () => {
    let authorizationCalls=0;
    let completionCalls=0;
    const jobs=[1,2].map((value)=>({
      delivery_id:`10000000-0000-4000-8000-00000000000${value}`,
      lease_token:`20000000-0000-4000-8000-00000000000${value}`,
      credential_version:1,
    }));
    const db={query:vi.fn(async(statement)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events"))return {rows:[{result:{}}]};
      if(sql.includes("axora_claim_integration_webhook_deliveries"))return {rows:jobs};
      if(sql.includes("axora_claimed_webhook_delivery_is_authorized")){
        authorizationCalls+=1;
        if(authorizationCalls===2)throw new Error("fixture database interruption");
        return {rows:[{allowed:false}]};
      }
      if(sql.includes("axora_complete_integration_webhook_delivery")){
        completionCalls+=1;
        return {rows:[{status:"FAILED"}]};
      }
      throw new Error("Unexpected fixture query");
    })};
    await expect(pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,
    })).resolves.toEqual({
      projected:true,claimed:2,failedJobs:1,disabled:false,
    });
    expect(completionCalls).toBe(1);
  });

  it("disables Zapier delivery without coupling ordinary customer webhooks", async () => {
    const rootKey=Buffer.alloc(32,0x52);
    const jobs=[
      {
        delivery_id:"10000000-0000-4000-8000-000000000011",
        event_id:payload.event_id,
        subscription_id:"10000000-0000-4000-8000-000000000012",
        company_id:payload.company_id,
        attempt_number:1,cycle_attempt_number:1,credential_version:1,
        event_type:payload.event_type,schema_version:payload.schema_version,
        occurred_at:payload.occurred_at,resource_type:payload.resource_type,
        resource_id:payload.resource_id,resource_url:payload.resource_url,
        summary:payload.data,
        lease_token:"20000000-0000-4000-8000-000000000011",
        endpoint:"https://hooks.zapier.com/hooks/catch/123/fictional/",
      },
      {
        delivery_id:"10000000-0000-4000-8000-000000000021",
        event_id:payload.event_id,
        subscription_id:"10000000-0000-4000-8000-000000000022",
        company_id:payload.company_id,
        attempt_number:1,cycle_attempt_number:1,credential_version:1,
        event_type:payload.event_type,schema_version:payload.schema_version,
        occurred_at:payload.occurred_at,resource_type:payload.resource_type,
        resource_id:payload.resource_id,resource_url:payload.resource_url,
        summary:payload.data,
        lease_token:"20000000-0000-4000-8000-000000000021",
        endpoint,
      },
    ].map((job)=>({
      ...job,
      endpoint_ciphertext:encryptedWorkerValue(
        rootKey,`webhook-endpoint:${job.subscription_id}`,job.endpoint,
      ),
      credential_ciphertext:encryptedWorkerValue(
        rootKey,`webhook-credential:${job.subscription_id}`,credential,
      ),
    }));
    const completions=[];
    const db={query:vi.fn(async(statement,values)=>{
      const sql=String(statement);
      if(sql.includes("axora_project_integration_events"))return {rows:[{result:{}}]};
      if(sql.includes("axora_claim_integration_webhook_deliveries"))return {rows:jobs};
      if(sql.includes("axora_claimed_webhook_delivery_is_authorized")){
        return {rows:[{allowed:true}]};
      }
      if(sql.includes("axora_complete_integration_webhook_delivery")){
        completions.push(values);
        return {rows:[{status:values[3]}]};
      }
      throw new Error("Unexpected fixture query");
    })};
    const outbound=vi.fn(async()=>({
      outcome:"SUCCEEDED",responseStatus:204,durationMs:1,
    }));
    await expect(pollIntegrationWorkerOnce({
      db,workerId:"integration-fixture01",enabled:true,zapierEnabled:false,
      rootKey,deliver:outbound,
    })).resolves.toEqual({
      projected:true,claimed:2,failedJobs:0,disabled:false,
    });
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0]?.[0].endpoint).toBe(endpoint);
    expect(completions).toHaveLength(2);
    expect(completions).toContainEqual(expect.arrayContaining([
      "FAILED",null,"CONFIGURATION_ERROR",0,
    ]));
    expect(completions).toContainEqual(expect.arrayContaining([
      "SUCCEEDED",204,null,1,
    ]));
  });

  it.each([
    ["127.0.0.1", false],
    ["168.63.129.16", false],
    ["169.254.169.254", false],
    ["10.0.0.8", false],
    ["192.168.1.8", false],
    ["::1", false],
    ["fc00::8", false],
    ["fe80::8", false],
    ["2002:a00:1::", false],
    [PUBLIC_IPV4, true],
    ["2001:4860:4860::8888", true],
    ["2606:4700:4700::1111", true],
  ])("classifies worker destination %s as public=%s", (address, expected) => {
    expect(workerAddressIsPublic(address)).toBe(expected);
  });

  it("rejects any mixed private DNS answer", async () => {
    await expect(resolveWorkerWebhookDestination(endpoint, async () => [
      { address: PUBLIC_IPV4, family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])).rejects.toMatchObject({ category: "SSRF_BLOCKED" });
  });

  it("pins the checked DNS answer into the outbound socket lookup", async () => {
    let pinned;
    const result = await deliver({}, {
      request: requestFixture({
        inspect(_url, options) {
          options.lookup("hooks.receiver.dev", {}, (_error, address, family) => {
            pinned = { address, family };
          });
        },
      }),
    });
    expect(pinned).toEqual({ address: PUBLIC_IPV4, family: 4 });
    expect(result).toMatchObject({ outcome: "SUCCEEDED", responseStatus: 204 });
  });

  it("fails closed if the connected peer differs into private space", async () => {
    await expect(deliver({ remoteAddress: "127.0.0.1" })).resolves.toMatchObject({
      outcome: "FAILED",
      errorCategory: "SSRF_BLOCKED",
    });
  });

  it.each([
    [204, "SUCCEEDED", undefined],
    [400, "FAILED", "HTTP_CLIENT_ERROR"],
    [408, "RETRY", "NETWORK_TIMEOUT"],
    [429, "RETRY", "RATE_LIMITED"],
    [500, "RETRY", "HTTP_SERVER_ERROR"],
    [302, "FAILED", "REDIRECT_REJECTED"],
  ])("classifies HTTP %s as %s", async (status, outcome, errorCategory) => {
    const result = await deliver({
      status,
      headers: status === 429 ? { "retry-after": "42" } : {},
    });
    expect(result).toMatchObject({ outcome, responseStatus: status });
    expect(result.errorCategory).toBe(errorCategory);
    if (status === 429) expect(result.retryAfterSeconds).toBe(42);
  });

  it("bounds response bodies without retaining them", async () => {
    const result = await deliver({ chunks: [Buffer.alloc(65_537)] });
    expect(result).toMatchObject({
      outcome: "FAILED",
      errorCategory: "RESPONSE_TOO_LARGE",
    });
    expect(result).not.toHaveProperty("responseBody");
  });

  it("retries network reset and timeout independently", async () => {
    await expect(deliver({ requestError: Object.assign(new Error(), { code: "ECONNRESET" }) }))
      .resolves.toMatchObject({ outcome: "RETRY", errorCategory: "CONNECTION_ERROR" });
    await expect(deliver({ triggerTimeout: true }))
      .resolves.toMatchObject({ outcome: "RETRY", errorCategory: "NETWORK_TIMEOUT" });
  });

  it("enforces an absolute deadline even when a receiver never finishes", async () => {
    const hangingRequest = () => {
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = (error) => {
        queueMicrotask(() => request.emit("error", error));
        return request;
      };
      request.end = () => {
        const socket = new EventEmitter();
        socket.remoteAddress = PUBLIC_IPV4;
        request.emit("socket", socket);
        socket.emit("connect");
      };
      return request;
    };
    await expect(deliver({}, { request:hangingRequest,timeoutMs:5 }))
      .resolves.toMatchObject({ outcome:"RETRY",errorCategory:"NETWORK_TIMEOUT" });
  });

  it("emits exact, deterministic signature headers without credentials", async () => {
    let capturedHeaders;
    await deliver({}, {
      request: requestFixture({ inspect(_url, options) { capturedHeaders = options.headers; } }),
    });
    const raw = canonicalWebhookJson(payload);
    const expected = createHmac("sha256", credential)
      .update("1800000000.", "utf8").update(raw, "utf8").digest("hex");
    expect(capturedHeaders).toMatchObject({
      "axora-event-id": payload.event_id,
      "axora-event-type": payload.event_type,
      "axora-timestamp": "1800000000",
      "axora-signature": `v1=${expected}`,
    });
    expect(JSON.stringify(capturedHeaders)).not.toContain(credential);
    expect(webhookSignature(credential, 1_800_000_000, raw)).toBe(`v1=${expected}`);
  });
});

describe("webhook retry policy", () => {
  it("honors bounded Retry-After seconds and dates", () => {
    expect(parseWebhookRetryAfter("120", 0)).toBe(120);
    expect(parseWebhookRetryAfter("999999", 0)).toBe(3600);
    expect(parseWebhookRetryAfter(new Date(30_000).toUTCString(), 0)).toBe(30);
    expect(parseWebhookRetryAfter("invalid", 0)).toBeUndefined();
  });

  it("uses bounded exponential backoff with jitter", () => {
    expect(webhookRetryDelaySeconds(1, undefined, () => 0)).toBe(3);
    expect(webhookRetryDelaySeconds(8, undefined, () => 0.5)).toBe(640);
    expect(webhookRetryDelaySeconds(20, undefined, () => 1)).toBe(3600);
    expect(webhookRetryDelaySeconds(1, 90, () => 0)).toBe(90);
  });

  it("never follows redirects", () => {
    expect(classifyWebhookStatus(307)).toEqual({
      outcome: "FAILED",
      errorCategory: "REDIRECT_REJECTED",
      responseStatus: 307,
    });
  });
});

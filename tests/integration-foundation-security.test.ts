import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  externalApiEnabled,
  INTEGRATION_FLAGS,
  integrationConfigInternals,
  integrationFlagEnabled,
  integrationOrigin,
  integrationRootKey,
} from "../src/lib/integrations/config";
import {
  canonicalIntegrationJson,
  decryptIntegrationValue,
  encryptIntegrationValue,
  hashIntegrationSecret,
  integrationPayloadHash,
  integrationSecretHashMatches,
  opaqueIntegrationSecret,
} from "../src/lib/integrations/crypto";
import {
  externalErrorResponse,
  externalRequestId,
} from "../src/lib/integrations/http";
import { integrationNetworkHash } from "../src/lib/integrations/network";
import {
  EXTERNAL_API_ROUTE_CONTRACT,
  buildAxoraOpenApiDocument,
} from "../src/lib/integrations/openapi";
import {
  parseOAuthClientCredentials,
  oauthInternals,
} from "../src/lib/integrations/oauth";
import {
  encodeExternalCursor,
  parseExternalPagination,
  paginationInternals,
} from "../src/lib/integrations/pagination";
import {
  parseFormUrlEncoded,
  readLimitedTextBody,
  requestOriginIsSame,
} from "../src/lib/integrations/request";
import { ExternalApiProblem } from "../src/lib/integrations/api-handler";
import { parseExternalDraft } from "../src/lib/integrations/resources";
import {
  INTEGRATION_SCOPES,
  parseIntegrationScopes,
  scopesAreSubset,
} from "../src/lib/integrations/scopes";

const key = Buffer.alloc(32, 0x71).toString("base64url");
const companyA = "f1281000-0000-4000-8000-000000000001";
const companyB = "f1281000-0000-4000-8000-000000000002";
const itemA = "item-aaaaaaaaaaaaaaaaaaaa";

function restoreEnvironment() {
  vi.unstubAllEnvs();
  integrationConfigInternals.clearKeyCache();
}

describe("external integration security primitives", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("APP_BASE_URL", "https://axora.management");
    vi.stubEnv("AXORA_INTEGRATION_ENCRYPTION_KEY", key);
    delete process.env.AXORA_INTEGRATION_ENCRYPTION_KEY_FILE;
    delete process.env.AXORA_EXTERNAL_API_ENABLED;
    delete process.env.AXORA_INTEGRATION_WEBHOOKS_ENABLED;
    delete process.env.AXORA_ZAPIER_ENABLED;
    delete process.env.AXORA_SLACK_ENABLED;
    integrationConfigInternals.clearKeyCache();
  });

  afterEach(restoreEnvironment);

  it("keeps independent feature flags dark unless the value is exactly true", () => {
    expect(externalApiEnabled()).toBe(false);
    for (const flag of Object.values(INTEGRATION_FLAGS)) {
      expect(integrationFlagEnabled(flag, { NODE_ENV: "test", [flag]: "TRUE" })).toBe(false);
      expect(integrationFlagEnabled(flag, { NODE_ENV: "test", [flag]: "1" })).toBe(false);
      expect(integrationFlagEnabled(flag, { NODE_ENV: "test", [flag]: "true" })).toBe(true);
    }
    expect(new Set(Object.values(INTEGRATION_FLAGS)).size).toBe(4);
  });

  it("requires dedicated production file-mounted key material", () => {
    expect(integrationRootKey()).toEqual(Buffer.alloc(32, 0x71));
    expect(() => integrationRootKey({
      NODE_ENV: "production",
      AXORA_INTEGRATION_ENCRYPTION_KEY: key,
    })).toThrow(/file-mounted/i);
    expect(() => integrationRootKey({ NODE_ENV: "test" })).toThrow(/unavailable/i);
    expect(() => integrationOrigin({
      NODE_ENV: "production",
      APP_BASE_URL: "http://axora.management",
    })).toThrow(/HTTPS/i);
    expect(integrationOrigin({
      NODE_ENV: "production",
      APP_BASE_URL: "https://axora.management",
    })).toBe("https://axora.management");
  });

  it("domain-separates hashes, canonicalizes payloads, and detects ciphertext tampering", () => {
    const secret = opaqueIntegrationSecret("axora_at_");
    expect(secret).toMatch(/^axora_at_[A-Za-z0-9_-]{43}$/);
    const accessHash = hashIntegrationSecret("access-token", secret);
    expect(accessHash).toMatch(/^[0-9a-f]{64}$/);
    expect(accessHash).not.toBe(hashIntegrationSecret("refresh-token", secret));
    expect(integrationSecretHashMatches("access-token", secret, accessHash)).toBe(true);
    expect(integrationSecretHashMatches("access-token", `${secret}x`, accessHash)).toBe(false);
    expect(integrationSecretHashMatches("access-token", secret, "not-a-hash")).toBe(false);

    const left = { z: 2, nested: { b: true, a: "value", ignored: undefined } };
    const right = { nested: { a: "value", b: true }, z: 2 };
    expect(canonicalIntegrationJson(left)).toBe(
      '{"nested":{"a":"value","b":true},"z":2}',
    );
    expect(integrationPayloadHash(left)).toBe(integrationPayloadHash(right));
    expect(() => canonicalIntegrationJson({ invalid: Number.NaN })).toThrow(/finite/i);

    const encrypted = encryptIntegrationValue("slack-token", "provider-secret");
    expect(decryptIntegrationValue("slack-token", encrypted)).toBe("provider-secret");
    expect(() => decryptIntegrationValue("webhook-secret", encrypted)).toThrow();
    expect(() => decryptIntegrationValue("slack-token", {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
    })).toThrow();
    expect(() => decryptIntegrationValue("slack-token", {
      ...encrypted,
      tag: encrypted.tag.slice(0, -1),
    })).toThrow(/ciphertext/i);
  });

  it("binds pagination cursors to route and company and rejects query manipulation", () => {
    const cursor = encodeExternalCursor({
      route: "/api/v1/requests",
      companyId: companyA,
      sort: "2026-08-29T00:00:00.000Z",
      id: "f1281000-0000-4000-8000-000000000010",
    });
    expect(paginationInternals.decodeExternalCursor(
      cursor,
      "/api/v1/requests",
      companyA,
    )).toEqual({
      sort: "2026-08-29T00:00:00.000Z",
      id: "f1281000-0000-4000-8000-000000000010",
    });
    expect(paginationInternals.decodeExternalCursor(
      cursor,
      "/api/v1/invoices",
      companyA,
    )).toBeNull();
    expect(paginationInternals.decodeExternalCursor(
      cursor,
      "/api/v1/requests",
      companyB,
    )).toBeNull();
    expect(paginationInternals.decodeExternalCursor(
      `${cursor.slice(0, -1)}0`,
      "/api/v1/requests",
      companyA,
    )).toBeNull();

    expect(parseExternalPagination(
      new Request(`https://axora.management/api/v1/requests?limit=100&cursor=${cursor}`),
      "/api/v1/requests",
      companyA,
    )).toMatchObject({ ok: true, limit: 100 });
    expect(parseExternalPagination(
      new Request("https://axora.management/api/v1/requests?limit=1&limit=2"),
      "/api/v1/requests",
      companyA,
    )).toEqual({ ok: false, field: "query" });
    expect(parseExternalPagination(
      new Request("https://axora.management/api/v1/requests?limit=101"),
      "/api/v1/requests",
      companyA,
    )).toEqual({ ok: false, field: "limit" });
    expect(parseExternalPagination(
      new Request("https://axora.management/api/v1/requests?company_id=foreign"),
      "/api/v1/requests",
      companyA,
    )).toEqual({ ok: false, field: "query" });
  });

  it("enforces exact HTTPS OAuth redirects and RFC 7636 S256 PKCE", () => {
    expect(oauthInternals.exactHttpsRedirect(
      "https://client.example.test/oauth/callback",
    )).toBe("https://client.example.test/oauth/callback");
    for (const invalid of [
      "http://client.example.test/oauth/callback",
      "https://user:password@client.example.test/oauth/callback",
      "https://client.example.test/oauth/callback#fragment",
      "https://client.example.test:443/oauth/callback",
      "https://axora.management/oauth/callback",
    ]) expect(oauthInternals.exactHttpsRedirect(invalid)).toBeNull();

    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    expect(oauthInternals.pkceMatches(verifier, challenge)).toBe(true);
    expect(oauthInternals.pkceMatches(`${verifier.slice(0, -1)}A`, challenge)).toBe(false);
  });

  it("rejects ambiguous OAuth client authentication", () => {
    const clientId = `axora_client_${"a".repeat(24)}`;
    const basic = `Basic ${Buffer.from(`${clientId}:secret`).toString("base64")}`;
    const basicRequest = new Request("https://axora.management/oauth/token", {
      headers: { Authorization: basic },
    });
    expect(parseOAuthClientCredentials(
      basicRequest,
      new URLSearchParams({ client_id: clientId }),
    )).toEqual({
      clientId,
      clientSecret: "secret",
      method: "client_secret_basic",
    });
    expect(parseOAuthClientCredentials(
      basicRequest,
      new URLSearchParams({ client_id: clientId, client_secret: "duplicate" }),
    )).toBeNull();
    expect(parseOAuthClientCredentials(
      basicRequest,
      new URLSearchParams({ client_id: `axora_client_${"b".repeat(24)}` }),
    )).toBeNull();
    expect(parseOAuthClientCredentials(
      new Request("https://axora.management/oauth/token"),
      new URLSearchParams({ client_id: clientId, client_secret: "secret" }),
    )).toEqual({
      clientId,
      clientSecret: "secret",
      method: "client_secret_post",
    });
    expect(parseOAuthClientCredentials(
      new Request("https://axora.management/oauth/token", {
        headers: { Authorization: "Bearer not-client-auth" },
      }),
      new URLSearchParams({ client_id: clientId }),
    )).toBeNull();
  });

  it("requires same-origin consent and strict, bounded form fields", async () => {
    expect(requestOriginIsSame(new Request(
      "https://axora.management/oauth/authorize/decision",
      { headers: { Origin: "https://axora.management", "Sec-Fetch-Site": "same-origin" } },
    ), "https://axora.management")).toBe(true);
    expect(requestOriginIsSame(new Request(
      "https://axora.management/oauth/authorize/decision",
      { headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" } },
    ), "https://axora.management")).toBe(false);
    expect(requestOriginIsSame(new Request(
      "https://axora.management/oauth/authorize/decision",
    ), "https://axora.management")).toBe(false);

    const accepted = await parseFormUrlEncoded(new Request(
      "https://axora.management/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=safe",
      },
    ), ["grant_type", "code"]);
    expect(accepted?.get("code")).toBe("safe");
    await expect(parseFormUrlEncoded(new Request(
      "https://axora.management/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "code=one&code=two",
      },
    ), ["code"])).resolves.toBeNull();
    await expect(parseFormUrlEncoded(new Request(
      "https://axora.management/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    ), ["code"])).resolves.toBeNull();
  });

  it("accepts only conservative, review-required draft payloads", () => {
    const valid = {
      branch_id: companyA,
      needed_by_date: "2026-09-01",
      urgency: "Normal",
      items: [{ product_reference: itemA, quantity: 2 }],
    };
    expect(parseExternalDraft(valid)).toMatchObject({
      request_type: "Standard",
      items: [{ quantity: 2 }],
    });
    for (const invalid of [
      { ...valid, approve: true },
      { ...valid, request_type: "Ad-hoc" },
      { ...valid, items: [{ product_reference: itemA, quantity: 1.5 }] },
      { ...valid, items: [
        { product_reference: itemA, quantity: 1 },
        { product_reference: itemA, quantity: 2 },
      ] },
    ]) {
      expect(() => parseExternalDraft(invalid)).toThrow(ExternalApiProblem);
    }
  });

  it("defines least-privilege scopes and a contract-tested OpenAPI surface", () => {
    expect(INTEGRATION_SCOPES).toEqual([
      "companies:read",
      "requests:read",
      "requests:draft",
      "deliveries:read",
      "invoices:read",
      "webhooks:manage",
    ]);
    expect(parseIntegrationScopes("requests:read companies:read")).toEqual([
      "companies:read",
      "requests:read",
    ]);
    expect(parseIntegrationScopes("requests:read requests:read")).toBeNull();
    expect(parseIntegrationScopes("admin")).toBeNull();
    expect(scopesAreSubset(["companies:read"], ["companies:read"])).toBe(true);
    expect(scopesAreSubset(["requests:draft"], ["requests:read"])).toBe(false);

    const document = buildAxoraOpenApiDocument() as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: { schemas: Record<string, unknown> };
    };
    for (const route of EXTERNAL_API_ROUTE_CONTRACT) {
      expect(document.paths[route.path]?.[route.method]?.operationId)
        .toBe(route.operationId);
    }
    const schemaKeys: string[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [name, child] of Object.entries(value)) {
        schemaKeys.push(name.toLowerCase());
        visit(child);
      }
    };
    visit(document.components.schemas);
    const references = [...contractTextReferences(document)];
    for (const reference of references) {
      expect(document.components.schemas[reference], reference).toBeDefined();
    }
    for (const forbidden of [
      "supplier_cost",
      "buying_cost",
      "gross_margin",
      "raw_gps",
      "proof_path",
      "access_token",
      "password",
    ]) expect(schemaKeys).not.toContain(forbidden);
    const contractText = JSON.stringify(document);
    for (const forbiddenScope of [
      "wallet:write",
      "payments:write",
      "approvals:write",
      "permissions:write",
      "users:write",
      '"admin"',
    ]) expect(contractText).not.toContain(forbiddenScope);
  });

  it("stops reading integration request bodies at the declared bound",async()=>{
    const body=new ReadableStream<Uint8Array>({
      start(controller){
        controller.enqueue(new Uint8Array(65));
        controller.close();
      },
    });
    const request=new Request("https://axora.management/oauth/token",{
      method:"POST",body,duplex:"half",
    } as RequestInit&{duplex:"half"});
    await expect(readLimitedTextBody(request,64)).resolves.toBeNull();
  });

  it("uses safe correlation IDs, error envelopes, and keyed network identifiers", async () => {
    const suppliedId = "f1281000-0000-4000-8000-000000000099";
    expect(externalRequestId(new Request("https://axora.management/api/v1/me", {
      headers: { "Axora-Request-Id": suppliedId },
    }))).toBe(suppliedId);
    expect(externalRequestId(new Request("https://axora.management/api/v1/me", {
      headers: { "Axora-Request-Id": "../../secret" },
    }))).toMatch(/^[0-9a-f-]{36}$/);
    const response = externalErrorResponse("temporarily_unavailable", 503, suppliedId, {
      field: "body",
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "temporarily_unavailable",
        message: "The integration service is temporarily unavailable.",
        request_id: suppliedId,
        field: "body",
      },
    });
    const networkHash = integrationNetworkHash(new Request(
      "https://axora.management/api/v1/me",
      { headers: { "CF-Connecting-IP": "203.0.113.42" } },
    ));
    expect(networkHash).toMatch(/^[0-9a-f]{64}$/);
    expect(networkHash).not.toContain("203.0.113.42");
    expect(networkHash).not.toBe(integrationNetworkHash(new Request(
      "https://axora.management/api/v1/me",
      { headers: { "CF-Connecting-IP": "203.0.113.43" } },
    )));
  });
});

function contractTextReferences(document:unknown){
  const references=new Set<string>();
  const visit=(value:unknown)=>{
    if(!value||typeof value!=="object")return;
    for(const [name,child] of Object.entries(value)){
      if(name==="$ref"&&typeof child==="string"
        &&child.startsWith("#/components/schemas/")){
        references.add(child.slice("#/components/schemas/".length));
      }else visit(child);
    }
  };
  visit(document);
  return references;
}

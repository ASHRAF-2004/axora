import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  externalApiEnabled: vi.fn(() => true),
  integrationNetworkHash: vi.fn(() => "a".repeat(64)),
  authenticateIntegrationRequest: vi.fn(),
  principalHasScope: vi.fn(() => true),
  consumeIntegrationRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 120,
    remaining: 119,
    resetAt: new Date(Date.now() + 60_000),
  })),
  recordIntegrationAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/integrations/config", () => ({
  externalApiEnabled: mocks.externalApiEnabled,
}));

vi.mock("@/lib/integrations/network", () => ({
  integrationNetworkHash: mocks.integrationNetworkHash,
}));

vi.mock("@/lib/integrations/api-auth", () => ({
  authenticateIntegrationRequest: mocks.authenticateIntegrationRequest,
  principalHasScope: mocks.principalHasScope,
}));

vi.mock("@/lib/integrations/rate-limit", () => ({
  consumeIntegrationRateLimit: mocks.consumeIntegrationRateLimit,
  integrationRateHeaders: (result: { limit: number; remaining: number }) => ({
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": "60",
    ...(result.remaining === 0 ? { "Retry-After": "60" } : {}),
  }),
}));

vi.mock("@/lib/integrations/audit", () => ({
  recordIntegrationAudit: mocks.recordIntegrationAudit,
}));

import type { IntegrationPrincipal } from "@/lib/integrations/api-auth";
import { handleExternalApiRequest } from "@/lib/integrations/api-handler";

const requestId = "f1286000-0000-4000-8000-000000000001";
const principal = {
  accessTokenId: "f1286000-0000-4000-8000-000000000002",
  applicationId: "f1286000-0000-4000-8000-000000000003",
  connectionId: "f1286000-0000-4000-8000-000000000004",
  companyId: "f1286000-0000-4000-8000-000000000005",
  grantId: "f1286000-0000-4000-8000-000000000006",
  clientId: "axora_client_fixture",
  scopes: ["requests:read"],
  actor: { id: "f1286000-0000-4000-8000-000000000007" },
} as unknown as IntegrationPrincipal;

function request(token = "axora_at_REDACTED") {
  return new Request("https://axora.management/api/v1/requests", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Axora-Request-Id": requestId,
      "CF-Connecting-IP": "203.0.113.99",
    },
  });
}

const config = {
  scope: "requests:read" as const,
  action: "REQUEST_LIST",
  routeClass: "API_READ" as const,
  resourceType: "request",
};

describe("external API request boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.externalApiEnabled.mockReturnValue(true);
    mocks.integrationNetworkHash.mockReturnValue("a".repeat(64));
    mocks.principalHasScope.mockReturnValue(true);
    mocks.consumeIntegrationRateLimit.mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(Date.now() + 60_000),
    });
    mocks.authenticateIntegrationRequest.mockResolvedValue({ ok: true, principal });
  });

  it("returns no external surface while the independent feature flag is dark", async () => {
    mocks.externalApiEnabled.mockReturnValue(false);
    const response = await handleExternalApiRequest(request(), config, async () => ({ data: {} }));
    expect(response.status).toBe(404);
    expect(mocks.authenticateIntegrationRequest).not.toHaveBeenCalled();
  });

  it.each(["MISSING", "INVALID"] as const)(
    "rejects %s bearer authentication with safe audit evidence",
    async (reason) => {
      const rawToken = `axora_at_${reason}_${"x".repeat(20)}`;
      mocks.authenticateIntegrationRequest.mockResolvedValue({ ok: false, reason });
      const response = await handleExternalApiRequest(
        request(rawToken),
        config,
        async () => ({ data: {} }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("invalid_token");
      expect(await response.json()).toMatchObject({
        error: {
          code: reason === "MISSING" ? "unauthorized" : "invalid_token",
          request_id: requestId,
        },
      });
      expect(JSON.stringify(mocks.recordIntegrationAudit.mock.calls))
        .not.toContain(rawToken);
    },
  );

  it("enforces both rate limits and the requested OAuth scope before the handler", async () => {
    mocks.consumeIntegrationRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 120,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
    });
    const handler = vi.fn(async () => ({ data: {} }));
    const limited = await handleExternalApiRequest(request(), config, handler);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.recordIntegrationAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({ result: "RATE_LIMITED", httpStatus: 429 }),
    );

    mocks.consumeIntegrationRateLimit.mockResolvedValueOnce({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(Date.now() + 60_000),
    });
    mocks.principalHasScope.mockReturnValueOnce(false);
    const scoped = await handleExternalApiRequest(request(), config, handler);
    expect(scoped.status).toBe(403);
    expect(scoped.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns the stable envelope and never leaks an unexpected failure", async () => {
    const success = await handleExternalApiRequest(request(), config, async () => ({
      data: [{ id: "safe-resource" }],
      resourceId: "f1286000-0000-4000-8000-000000000008",
    }));
    expect(success.status).toBe(200);
    expect(success.headers.get("axora-request-id")).toBe(requestId);
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(await success.json()).toEqual({
      data: [{ id: "safe-resource" }],
      meta: { request_id: requestId },
    });
    expect(mocks.recordIntegrationAudit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        applicationId: principal.applicationId,
        companyId: principal.companyId,
        result: "SUCCESS",
      }),
    );

    const failure = await handleExternalApiRequest(request(), config, async () => {
      throw new Error("database secret and stack trace must not escape");
    });
    expect(failure.status).toBe(503);
    const body = JSON.stringify(await failure.json());
    expect(body).toContain("temporarily_unavailable");
    expect(body).not.toContain("database secret");
    expect(body).not.toContain("stack");
  });
});

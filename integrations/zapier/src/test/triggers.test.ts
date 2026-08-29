import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";
import zapier from "zapier-platform-core";

import App from "../index.js";
import { AXORA_ORIGIN } from "../constants.js";

const appTester = zapier.createAppTester(App);
const token = `axora_at_${"a".repeat(43)}`;
const subscriptionId = "00000000-0000-4000-8000-000000000501";
const requestApprovedOperation = (
  App.triggers.request_approved!.operation as unknown
) as Record<string, unknown>;

describe("REST-hook triggers", () => {
  beforeAll(() => nock.disableNetConnect());
  beforeEach(() => nock.cleanAll());
  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("creates a signed Axora subscription without returning its secret to Zapier", async () => {
    let idempotencyKey = "";
    const subscriptionRequest = nock(AXORA_ORIGIN)
      .post("/api/v1/webhook-subscriptions", (body) => body.endpoint_url
        === "https://hooks.zapier.com/hooks/catch/123/fictional/"
        && body.event_types?.[0] === "request.approved"
        && body.credential_delivery === "none")
      .matchHeader("authorization", `Bearer ${token}`)
      .matchHeader("idempotency-key", (value) => {
        idempotencyKey = value;
        return /^zapier-hook-create:[a-f0-9]{64}$/.test(value);
      })
      .reply(201, {
        data: {
          id: subscriptionId,
          status: "active",
          event_types: ["request.approved"],
          signing_secret: "must-not-enter-subscribe-data",
        },
        meta: { request_id: "00000000-0000-4000-8000-000000000599" },
      });

    const result = await appTester(
      requestApprovedOperation.performSubscribe as never,
      {
        authData: { access_token: token },
        targetUrl: "https://hooks.zapier.com/hooks/catch/123/fictional/",
      },
    );
    expect(result).toEqual({
      id: subscriptionId,
      status: "active",
      event_types: ["request.approved"],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(idempotencyKey).not.toContain("hooks.zapier.com");
    expect(subscriptionRequest.isDone()).toBe(true);
  });

  it("rejects a non-Zapier callback before making any network request", async () => {
    await expect(appTester(
      requestApprovedOperation.performSubscribe as never,
      {
        authData: { access_token: token },
        targetUrl: "https://attacker.example/collect",
      },
    )).rejects.toThrow("invalid webhook target");
    expect(nock.pendingMocks()).toEqual([]);
  });

  it("revokes the exact subscription idempotently when a Zap is disabled", async () => {
    const revokeRequest = nock(AXORA_ORIGIN)
      .delete(`/api/v1/webhook-subscriptions/${subscriptionId}`)
      .matchHeader("authorization", `Bearer ${token}`)
      .matchHeader("idempotency-key", /^zapier-hook-revoke:[a-f0-9]{64}$/)
      .reply(200, { data: { id: subscriptionId, status: "revoked" } });

    const result = await appTester(
      requestApprovedOperation.performUnsubscribe as never,
      {
        authData: { access_token: token },
        subscribeData: { id: subscriptionId },
      },
    );
    expect(result).toEqual({ id: subscriptionId, status: "revoked" });
    expect(revokeRequest.isDone()).toBe(true);
  });

  it("allows only the small documented event projection into a Zap", async () => {
    const eventId = "00000000-0000-4000-8000-000000000601";
    const result = await appTester(
      requestApprovedOperation.perform as never,
      {
        cleanedRequest: {
          event_id: eventId,
          event_type: "request.approved",
          schema_version: 1,
          occurred_at: "2026-08-29T00:00:00.000Z",
          company_id: "00000000-0000-4000-8000-000000000001",
          resource_id: "00000000-0000-4000-8000-000000000101",
          resource_type: "request",
          resource_url: "/api/v1/requests/00000000-0000-4000-8000-000000000101",
          data: {
            order_code: "ORD-FICTIONAL-1001",
            branch_name: "Fictional Branch",
            currency: "MYR",
            total: "1250.00",
            supplier_cost: "private",
            margin: "private",
            email: "private@example.test",
            access_token: "private",
          },
        },
      },
    );
    expect(result).toEqual([expect.objectContaining({
      id: eventId,
      event_type: "request.approved",
      order_code: "ORD-FICTIONAL-1001",
      resource_url: `${AXORA_ORIGIN}/api/v1/requests/00000000-0000-4000-8000-000000000101`,
    })]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/supplier|margin|email|access_token|private@example/i);
  });

  it("drops an event routed to the wrong trigger", async () => {
    const result = await appTester(
      requestApprovedOperation.perform as never,
      {
        cleanedRequest: {
          event_id: "00000000-0000-4000-8000-000000000602",
          event_type: "delivery.completed",
          schema_version: 1,
          resource_type: "delivery",
        },
      },
    );
    expect(result).toEqual([]);
  });

  it("drops malformed callback identifiers and resource links", async () => {
    const result = await appTester(
      requestApprovedOperation.perform as never,
      {
        cleanedRequest: {
          event_id: "not-an-event-id",
          event_type: "request.approved",
          schema_version: 1,
          occurred_at: "2026-08-29T00:00:00.000Z",
          company_id: "00000000-0000-4000-8000-000000000001",
          resource_id: "00000000-0000-4000-8000-000000000101",
          resource_type: "request",
          resource_url: "/api/v1/invoices/00000000-0000-4000-8000-000000000101",
        },
      },
    );
    expect(result).toEqual([]);
  });
});

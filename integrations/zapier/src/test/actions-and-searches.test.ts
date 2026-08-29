import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";
import zapier from "zapier-platform-core";

import App from "../index.js";
import { AXORA_ORIGIN } from "../constants.js";

const appTester = zapier.createAppTester(App);
const token = `axora_at_${"a".repeat(43)}`;
const requestId = "00000000-0000-4000-8000-000000000101";

describe("safe searches and draft action", () => {
  beforeAll(() => nock.disableNetConnect());
  beforeEach(() => nock.cleanAll());
  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it("returns the same empty search result for a foreign or absent record", async () => {
    const request = nock(AXORA_ORIGIN)
      .get(`/api/v1/requests/${requestId}`)
      .matchHeader("authorization", `Bearer ${token}`)
      .reply(404, {
        error: {
          code: "not_found",
          message: "The resource was not found.",
          request_id: "00000000-0000-4000-8000-000000000901",
        },
      });
    const result = await appTester(
      App.searches.find_request!.operation.perform as never,
      { authData: { access_token: token }, inputData: { id: requestId } },
    );
    expect(result).toEqual([]);
    expect(request.isDone()).toBe(true);
  });

  it("returns only the company-scoped API record for a successful search", async () => {
    const request = nock(AXORA_ORIGIN)
      .get(`/api/v1/requests/${requestId}`)
      .matchHeader("authorization", `Bearer ${token}`)
      .reply(200, {
        data: {
          id: requestId,
          order_code: "ORD-FICTIONAL-1001",
          company_id: "00000000-0000-4000-8000-000000000001",
          resource_url: `/api/v1/requests/${requestId}`,
        },
      });
    const result = await appTester(
      App.searches.find_request!.operation.perform as never,
      { authData: { access_token: token }, inputData: { id: requestId } },
    );
    expect(result).toEqual([expect.objectContaining({ id: requestId })]);
    expect(request.isDone()).toBe(true);
  });

  it("creates only a review-required draft with a retry-stable hashed key", async () => {
    const observedKeys: string[] = [];
    const draftId = "00000000-0000-4000-8000-000000000401";
    const registerRequest = () => nock(AXORA_ORIGIN)
      .post("/api/v1/request-drafts", (body) => body.branch_id
        === "00000000-0000-4000-8000-000000000011"
        && body.request_type === "Standard"
        && body.items?.[0]?.product_reference === "item-0123456789abcdefabcd"
        && body.items?.[0]?.quantity === 2
        && body.approve === undefined
        && body.submit === undefined
        && body.payment === undefined)
      .matchHeader("authorization", `Bearer ${token}`)
      .matchHeader("idempotency-key", (value) => {
        observedKeys.push(value);
        return /^zapier-draft-create:[a-f0-9]{64}$/.test(value);
      })
      .reply(201, {
        data: {
          id: draftId,
          draft_code: "IDR-FICTIONAL1001",
          status: "pending_review",
          review_url: `/integrations/drafts/${draftId}`,
        },
      });
    const firstRequest = registerRequest();
    const secondRequest = registerRequest();
    const bundle = {
      authData: { access_token: token },
      inputData: {
        idempotency_key: "source-system-record-42",
        branch_id: "00000000-0000-4000-8000-000000000011",
        needed_by_date: "2026-09-30",
        urgency: "Normal",
        department: "Operations",
        notes: "Review before submitting.",
        items: [{
          product_reference: "item-0123456789abcdefabcd",
          quantity: 2,
          specification: "Fictional example",
        }],
      },
    };
    const first = await appTester(
      App.creates.create_request_draft!.operation.perform as never,
      bundle,
    );
    const replay = await appTester(
      App.creates.create_request_draft!.operation.perform as never,
      bundle,
    );
    expect(first).toMatchObject({
      id: draftId,
      status: "pending_review",
      review_url: `${AXORA_ORIGIN}/integrations/drafts/${draftId}`,
    });
    expect(replay).toMatchObject({ id: draftId, status: "pending_review" });
    expect(observedKeys).toHaveLength(2);
    expect(observedKeys[0]).toBe(observedKeys[1]);
    expect(observedKeys[0]).not.toContain("source-system-record-42");
    expect(firstRequest.isDone()).toBe(true);
    expect(secondRequest.isDone()).toBe(true);
  });

  it("rejects malformed draft items before any request", async () => {
    await expect(appTester(
      App.creates.create_request_draft!.operation.perform as never,
      {
        authData: { access_token: token },
        inputData: {
          idempotency_key: "source-record",
          branch_id: "00000000-0000-4000-8000-000000000011",
          needed_by_date: "2026-09-30",
          urgency: "Normal",
          items: [{ product_reference: "unsafe", quantity: 0 }],
        },
      },
    )).rejects.toThrow("valid Axora product reference");
    expect(nock.pendingMocks()).toEqual([]);
  });
});

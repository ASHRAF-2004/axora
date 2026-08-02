import { describe, expect, it } from "vitest";
import {
  buildWorkflowEvent,
  sameIdempotentWorkflowEvent,
  validateWorkflowMetadata,
  workflowIdempotencyKey,
} from "@/lib/workflow-events";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  aggregate: "20000000-0000-4000-8000-000000000001",
  actor: "30000000-0000-4000-8000-000000000001",
  event: "40000000-0000-4000-8000-000000000001",
  correlation: "50000000-0000-4000-8000-000000000001",
};

describe("workflow event drafts", () => {
  it("builds a tenant-scoped event with deterministic idempotency", () => {
    const idempotencyKey = workflowIdempotencyKey("rfq.issue", ids.company, ids.aggregate, 1);
    expect(idempotencyKey).toBe(workflowIdempotencyKey(
      "rfq.issue",
      ids.company,
      ids.aggregate,
      1,
    ));
    const event = buildWorkflowEvent({
      id: ids.event,
      companyId: ids.company,
      aggregateType: "supplier_rfq",
      aggregateId: ids.aggregate,
      eventKey: "supplier.rfq.issued",
      eventVersion: 1,
      actorUserId: ids.actor,
      actorKind: "PLATFORM",
      correlationId: ids.correlation,
      idempotencyKey,
      occurredAt: "2026-08-02T08:00:00.000Z",
      metadata: { round: 1, channel: "portal", flags: ["priority"] },
    });
    expect(event.metadata).toEqual({ round: 1, channel: "portal", flags: ["priority"] });
    expect(sameIdempotentWorkflowEvent(event, { companyId: ids.company, idempotencyKey })).toBe(true);
  });

  it("rejects sensitive, oversized, or non-JSON metadata", () => {
    expect(() => validateWorkflowMetadata({ nested: { authorizationToken: "hidden" } }))
      .toThrow("not allowed");
    expect(() => validateWorkflowMetadata({ note: "x".repeat(2_100) }))
      .toThrow("too large");
    expect(() => validateWorkflowMetadata({ value: Number.NaN }))
      .toThrow("finite");
  });

  it("requires a real actor for non-system events and prevents self-causation", () => {
    const base = {
      id: ids.event,
      companyId: ids.company,
      aggregateType: "receipt",
      aggregateId: ids.aggregate,
      eventKey: "receipt.confirmed",
      eventVersion: 1,
      actorKind: "COMPANY" as const,
      correlationId: ids.correlation,
      idempotencyKey: "receipt:stable-client-event",
    };
    expect(() => buildWorkflowEvent(base)).toThrow("requires an actor");
    expect(() => buildWorkflowEvent({
      ...base,
      actorUserId: ids.actor,
      causationEventId: ids.event,
    })).toThrow("cannot cause itself");
  });
});

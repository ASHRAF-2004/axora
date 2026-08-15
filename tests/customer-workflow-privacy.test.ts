import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";
import { sanitizeCustomerWorkflowEvent } from "@/lib/customer-workflow-privacy";
import type { RequestWorkflowEvent } from "@/lib/workflow-repository";

const event: RequestWorkflowEvent = {
  id: "event-1",
  eventKey: "supplier.selected",
  previousState: "CLAIMED",
  newState: "PURCHASING",
  reason: "Internal supplier and cost note",
  source: "DELIVERY_PORTAL",
  actorName: "Internal operator",
  actorRole: "DELIVERY_GUY",
  occurredAt: "2026-08-14T00:00:00.000Z",
  recordedAt: "2026-08-14T00:00:00.000Z",
};

describe("customer workflow privacy", () => {
  it("maps internal preparation activity without leaking the actor or reason", () => {
    expect(sanitizeCustomerWorkflowEvent(event,"DELIVERY")).toEqual({
      id: "event-1",
      eventKey: "preparation.updated",
      previousState: "PREPARING",
      newState: "PREPARING",
      source: "SYSTEM",
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
    });
  });

  it("preserves safe customer-authored context", () => {
    const safe = sanitizeCustomerWorkflowEvent({ ...event,eventKey: "request.submitted",reason: "Needed for teaching",actorName: "Requester",actorRole: "REQUESTER",source: "WEB" },"COMPANY");
    expect(safe).toMatchObject({ eventKey: "request.submitted",reason: "Needed for teaching",actorName: "Requester",actorRole: "REQUESTER",source: "WEB" });
  });

  it("does not describe internal buying or driver duties in public workflow copy", async () => {
    const source = await readFile("src/lib/immersive-public-experience.ts","utf8");
    expect(source).not.toMatch(/\bid:\s*["']buy["']/i);
    expect(source).not.toContain("buys the approved items");
    expect(source).not.toContain("purchasing items");
  });
});

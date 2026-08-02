import { describe, expect, it } from "vitest";
import { workflowEmailInternals } from "@/lib/workflow-email";

const base = {
  companyId: "00000000-0000-4000-8000-000000000061",
  recipientUserId: "00000000-0000-4000-8000-000000000062",
  workflowEventId: "00000000-0000-4000-8000-000000000063",
  eventKey: "delivery.scheduled",
  dedupeKey: `notification:${"a".repeat(64)}`,
  title: "Delivery scheduled",
  body: "Axora scheduled a delivery for this request.",
  routePath: "/requests/00000000-0000-4000-8000-000000000064",
};

describe("workflow email application boundary", () => {
  it("normalizes a safe tenant-bound draft", () => {
    expect(workflowEmailInternals.validateDraft({
      ...base,
      title: "  Delivery scheduled  ",
    })).toEqual({ ...base, title: "Delivery scheduled" });
  });

  it.each([
    "https://attacker.example/request",
    "//attacker.example/request",
    "/request#fragment",
    "/request\nBcc: attacker@example.test",
  ])("rejects an unsafe workflow route %s", (routePath) => {
    expect(() => workflowEmailInternals.validateDraft({ ...base, routePath }))
      .toThrow(/route/i);
  });

  it("validates a claimed row before returning it to the private sender", () => {
    const job = workflowEmailInternals.claimedJob({
      deliveryId: "00000000-0000-4000-8000-000000000065",
      leaseId: "00000000-0000-4000-8000-000000000066",
      locale: "ar",
      recipientEmail: "PERSON@EXAMPLE.TEST",
      recipientName: "Aisha Rahman",
      title: "Delivery scheduled",
      body: "Axora scheduled a delivery for this request.",
      routePath: "/notifications",
    });
    expect(job).toMatchObject({
      messageKind: "WORKFLOW_UPDATE",
      locale: "ar",
      recipientEmail: "person@example.test",
      workflow: { actionPath: "/notifications" },
    });
    expect(() => workflowEmailInternals.claimedJob({
      ...job,
      deliveryId: job.deliveryId,
      leaseId: job.leaseId,
      locale: "en",
      recipientEmail: "person@example.test\nBcc: attacker@example.test",
      recipientName: "Aisha Rahman",
      title: "Delivery scheduled",
      body: "Axora scheduled a delivery for this request.",
    })).toThrow(/invalid job/i);
  });
});

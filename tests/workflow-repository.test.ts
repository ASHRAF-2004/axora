import { describe, expect, it } from "vitest";
import { workflowRepositoryInternals } from "@/lib/workflow-repository";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "REQUESTER" as const,
  accountKind: "COMPANY" as const,
  isOwner: false,
  companyId: "10000000-0000-4000-8000-000000000001",
  branchId: "20000000-0000-4000-8000-000000000001",
};

describe("workflow repository", () => {
  it("records actor role, states, source, and bounded reasons", () => {
    const metadata = workflowRepositoryInternals.eventMetadata({
      companyId: actor.companyId,
      branchId: actor.branchId,
      requestId: "30000000-0000-4000-8000-000000000001",
      aggregateType: "request",
      aggregateId: "30000000-0000-4000-8000-000000000001",
      eventKey: "request.submitted",
      stableKey: "submission",
      actor,
      previousState: "Draft",
      newState: "Submitted",
      reason: "x".repeat(2_000),
      source: "WEB",
    });
    expect(metadata).toMatchObject({
      actorRole: "REQUESTER",
      previousState: "Draft",
      newState: "Submitted",
      source: "WEB",
    });
    expect(String(metadata.reason)).toHaveLength(1_000);
    expect(workflowRepositoryInternals.actorKind(actor)).toBe("COMPANY");
  });
});

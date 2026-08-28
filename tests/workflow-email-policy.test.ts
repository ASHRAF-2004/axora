import { describe, expect, it } from "vitest";
import {
  workflowEmailPolicyInternals,
  workflowEventAllowsEmail,
} from "@/lib/workflow-email-policy";

describe("workflow email channel policy", () => {
  it("keeps routine delivery and company creation events in-app only", () => {
    for (const eventKey of workflowEmailPolicyInternals.IN_APP_ONLY_WORKFLOW_EVENTS) {
      expect(workflowEventAllowsEmail(eventKey)).toBe(false);
    }
  });

  it("preserves useful security and finalized-document email categories", () => {
    expect(workflowEventAllowsEmail("security.password_changed")).toBe(true);
    expect(workflowEventAllowsEmail("invoice.finalized")).toBe(true);
    expect(workflowEventAllowsEmail("account.invitation.created")).toBe(true);
  });
});

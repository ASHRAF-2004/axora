import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("request submission event sequence", () => {
  it("records submission and a distinct approval-needed event before notifying approvers", async () => {
    const source = await readFile(
      new URL("../src/lib/repository.ts", import.meta.url),
      "utf8",
    );
    const submission = source.indexOf('eventKey: "request.submitted"');
    const approval = source.indexOf('eventKey: "approval.needed"', submission);
    const notification = source.indexOf(
      "await notifyWorkflowAudience(client, approvalEvent",
      approval,
    );
    expect(submission).toBeGreaterThan(-1);
    expect(approval).toBeGreaterThan(submission);
    expect(notification).toBeGreaterThan(approval);
    expect(source.slice(approval, notification)).toContain(
      'stableKey: "initial-company-approval"',
    );
  });
});

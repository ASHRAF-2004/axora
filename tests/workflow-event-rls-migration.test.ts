import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../database/migrations/023_workflow_event_rls_and_baseline.sql", import.meta.url),
  "utf8",
);

describe("workflow event row security baseline", () => {
  it("backfills only truthful system events and scopes tenant reads", () => {
    expect(sql).toContain("ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("membership.company_id=workflow_events.company_id");
    expect(sql).toContain("assignment.branch_id=workflow_events.branch_id");
    expect(sql).toContain("'SYSTEM'");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
  });
});

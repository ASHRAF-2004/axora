import {
  auditRecordMatchesFilters,
  escapeAuditLikeFragment,
  normalizeAuditRecordFilters,
} from "@/lib/audit-filters";
import { describe, expect, it } from "vitest";

describe("audit filters", () => {
  it("normalizes bounded exact filters and rejects malformed input", () => {
    expect(normalizeAuditRecordFilters({
      entityType: " Requests ", action: " update ", actor: "  Ashraf   Omar ",
      recordId: "77C4B8D9-1ED2-4A73-8A42-5DC3202123C4",
      from: "2026-08-01", to: "2026-08-31",
    })).toEqual({
      entityType: "requests", action: "UPDATE", actor: "Ashraf Omar",
      recordId: "77c4b8d9-1ed2-4a73-8a42-5dc3202123c4",
      from: "2026-08-01", to: "2026-08-31",
    });
    expect(normalizeAuditRecordFilters({
      entityType: "requests' OR true --", action: "", actor: "x",
      recordId: "not-an-id", from: "2026-02-30", to: "today",
    })).toEqual({
      entityType: undefined, action: undefined, actor: undefined,
      recordId: undefined, from: undefined, to: undefined,
    });
  });

  it("rejects reversed date ranges instead of silently changing their meaning", () => {
    expect(normalizeAuditRecordFilters({ from: "2026-08-31", to: "2026-08-01" }))
      .toEqual({ entityType: undefined, action: undefined, actor: undefined, recordId: undefined });
  });

  it("escapes LIKE metacharacters and applies the same filters to safe fixtures", () => {
    expect(escapeAuditLikeFragment("A%_\\B")).toBe("A\\%\\_\\\\B");
    const record = {
      entityType: "requests", action: "UPDATE", actorName: "Ashraf Omar",
      recordId: "77c4b8d9-1ed2-4a73-8a42-5dc3202123c4",
      occurredAt: "2026-08-02T12:00:00.000Z",
    };
    expect(auditRecordMatchesFilters(record, { actor: "raf", from: "2026-08-01", to: "2026-08-02" })).toBe(true);
    expect(auditRecordMatchesFilters(record, { action: "DELETE" })).toBe(false);
  });
});

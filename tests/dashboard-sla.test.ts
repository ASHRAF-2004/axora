import fs from "node:fs";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync("src/lib/repository.ts", "utf8");

describe("dashboard delayed-action signals", () => {
  it("derives a delayed delivery from its effective due date without replacing receipt evidence", () => {
    expect(source).toContain("COALESCE(d.revised_date,d.expected_date) < current_date");
    expect(source).toMatch(/WHEN received\.quantity>=l\.quantity THEN 'Delivered'/);
    expect(source).toMatch(/WHEN received\.quantity>0 THEN 'Partially Delivered'/);
    expect(source).toMatch(/WHEN d\.actual_date IS NULL[\s\S]*THEN 'Delayed'/);
  });

  it("puts overdue open requests into the role dashboard attention queue", () => {
    expect(source).toContain("request.neededByDate < today");
    expect(source).toContain('!["Completed", "Cancelled"].includes(request.status)');
  });
});

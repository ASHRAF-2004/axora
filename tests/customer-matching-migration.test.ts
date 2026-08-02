import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../database/migrations/025_customer_three_way_matching.sql", import.meta.url),
  "utf8",
);

describe("customer-safe three-way matching", () => {
  it("separates private supplier evidence from customer finance evidence", () => {
    expect(sql).toContain("customer_three_way_matches");
    expect(sql).toContain("invoice_direction IS DISTINCT FROM 'CUSTOMER'");
    expect(sql).toContain("USING (axora_context_is_platform())");
    expect(sql).toContain("independent scoped finance reviewer");
    expect(sql).not.toContain("docker compose down -v");
  });
});

import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

describe("company deletion visibility", () => {
  it("tombstones archived tenants at the central authorization boundary", async () => {
    const migration = await readFile("database/migrations/085_company_deletion_guardrails.sql","utf8");
    expect(migration).toContain("axora_company_is_operational");
    expect(migration).toContain("NOT public.axora_company_is_operational(p_company_id)");
    expect(migration).toContain("delivery_status='CANCELLED'");
    expect(migration).toContain("Company deletion is temporarily unavailable while work is in flight");
  });

  it("does not offer archived tenants in normal lists or details", async () => {
    const [list,detail] = await Promise.all([
      readFile("src/app/(portal)/companies/page.tsx","utf8"),
      readFile("src/app/(portal)/companies/[companyId]/page.tsx","utf8"),
    ]);
    expect(list).toContain('item !== "ARCHIVED"');
    expect(detail).toContain('company.status === "ARCHIVED"');
  });
});

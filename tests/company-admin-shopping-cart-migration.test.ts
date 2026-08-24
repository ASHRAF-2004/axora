import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

describe.sequential("Company Administrator shopping/cart migration", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "113_company_admin_branch_location_budget_foundation.sql" });
  }, 45_000);
  afterAll(async () => { await db.close(); });

  it("upgrades 113 by granting only the two scoped shopping commands", async () => {
    const codes = async () => (await db.query<{ code: string }>(`
      SELECT permission.permission_code AS code
      FROM roles role JOIN role_permissions role_permission ON role_permission.role_id=role.id
      JOIN permissions permission ON permission.id=role_permission.permission_id
      WHERE role.role_key='COMPANY_ADMIN'
        AND permission.permission_code IN ('cart.manage','request.create') ORDER BY code
    `)).rows.map((row) => row.code);
    expect(await codes()).toEqual([]);
    await db.exec(await readFile(new URL("../database/migrations/114_company_admin_shopping_cart_contract.sql", import.meta.url), "utf8"));
    expect(await codes()).toEqual(["cart.manage", "request.create"]);
  });

  it("retains the authoritative database lower-bound constraint", async () => {
    const constraints = await db.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(constraint_record.oid) AS definition
      FROM pg_constraint constraint_record JOIN pg_class relation ON relation.oid=constraint_record.conrelid
      WHERE relation.relname='procurement_cart_items' AND constraint_record.contype='c'
    `);
    expect(constraints.rows.some((row) => /quantity >= 1/.test(row.definition))).toBe(true);
    expect(constraints.rows.some((row) => /quantity <= 1000000/.test(row.definition))).toBe(true);
  });
});

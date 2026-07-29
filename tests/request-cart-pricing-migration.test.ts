import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrls = [
  "001_initial.sql",
  "002_cod_only_payments.sql",
  "003_protect_owner_account.sql",
  "004_company_tenant_membership.sql",
  "005_persistent_files_and_tenant_audit.sql",
  "006_multiple_platform_owners.sql",
  "007_customer_procurement_workflow.sql",
  "008_attachment_visibility.sql",
  "009_workflow_safety_and_local_budget.sql",
  "010_finance_and_delivery_integrity.sql",
  "011_product_editing_and_gallery.sql",
  "012_request_cart_pricing.sql",
].map(
  (filename) =>
    new URL(`../database/migrations/${filename}`, import.meta.url),
);

const demoSeedUrl = new URL(
  "../database/seeds/demo.sql",
  import.meta.url,
);

describe("request cart pricing migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();

    for (const url of migrationUrls) {
      await db.exec(await readFile(url, "utf8"));
    }

    await db.exec(await readFile(demoSeedUrl, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("adds company and request pricing configuration", async () => {
    const company = await db.query<{
      tax_rate: number;
      estimated_delivery_fee: number;
    }>(`
      SELECT
        tax_rate::float8,
        estimated_delivery_fee::float8
      FROM companies
      ORDER BY company_code
      LIMIT 1
    `);

    const request = await db.query<{
      tax_rate: number;
      tax_amount: number;
      estimated_delivery_fee: number;
    }>(`
      SELECT
        tax_rate::float8,
        tax_amount::float8,
        estimated_delivery_fee::float8
      FROM requests
      ORDER BY order_code
      LIMIT 1
    `);

    expect(company.rows[0]).toEqual({
      tax_rate: 0,
      estimated_delivery_fee: 0,
    });

    expect(request.rows[0]).toEqual({
      tax_rate: 0,
      tax_amount: 0,
      estimated_delivery_fee: 0,
    });
  });

  it("includes delivery and tax in the customer total", async () => {
    await db.exec(`
      UPDATE requests
      SET
        estimated_delivery_fee = 10,
        tax_rate = 6,
        tax_amount = 8.40
      WHERE order_code = 'ORD-2026-001'
    `);

    const result = await db.query<{
      sales_amount: number;
      estimated_delivery_fee: number;
      tax_amount: number;
      customer_total: number;
    }>(`
      SELECT
        sales_amount::float8,
        estimated_delivery_fee::float8,
        tax_amount::float8,
        customer_total::float8
      FROM v_order_financials
      WHERE order_code = 'ORD-2026-001'
    `);

    expect(result.rows[0]).toEqual({
      sales_amount: 140,
      estimated_delivery_fee: 10,
      tax_amount: 8.4,
      customer_total: 158.4,
    });
  });

  it("includes the full approved estimate in branch budget usage", async () => {
    const request = await db.query<{
      id: string;
      branch_id: string;
    }>(`
      SELECT id::text, branch_id::text
      FROM requests
      WHERE order_code = 'ORD-2026-001'
    `);

    await db.query(
      `INSERT INTO approvals (
        request_id,
        approval_type,
        status,
        reason,
        decided_at
      )
      VALUES (
        $1,
        'Company approval',
        'Approved',
        'Pricing migration test',
        now()
      )`,
      [request.rows[0].id],
    );

    const result = await db.query<{
      committed_amount: number;
    }>(
      `SELECT committed_amount::float8
       FROM v_branch_budget_usage
       WHERE branch_id=$1`,
      [request.rows[0].branch_id],
    );

    expect(Number(result.rows[0].committed_amount)).toBe(158.4);
  });
});

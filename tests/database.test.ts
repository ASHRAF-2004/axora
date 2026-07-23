import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migrationUrls = [
  new URL("../database/migrations/001_initial.sql", import.meta.url),
  new URL("../database/migrations/002_cod_only_payments.sql", import.meta.url),
  new URL("../database/migrations/003_protect_owner_account.sql", import.meta.url),
  new URL("../database/migrations/004_company_tenant_membership.sql", import.meta.url),
  new URL("../database/migrations/005_persistent_files_and_tenant_audit.sql", import.meta.url),
];
const demoSeedUrl = new URL("../database/seeds/demo.sql", import.meta.url);

async function count(db: PGlite, table: string) {
  const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return Number(result.rows[0].count);
}

describe("PostgreSQL migration and demonstration seed", () => {
  let db: PGlite;
  let migrationSql: string[];
  let demoSeedSql: string;

  beforeAll(async () => {
    [migrationSql, demoSeedSql] = await Promise.all([
      Promise.all(migrationUrls.map((url) => readFile(url, "utf8"))),
      readFile(demoSeedUrl, "utf8"),
    ]);
    db = new PGlite();
    for (const sql of migrationSql) await db.exec(sql);
    await db.exec(demoSeedSql);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates the normalized core tables and financial views", async () => {
    const result = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);
    const names = result.rows.map((row) => row.table_name);

    expect(names).toEqual(expect.arrayContaining([
      "companies", "branches", "suppliers", "products", "product_suppliers",
      "requests", "request_lines", "quotations", "approvals", "deliveries",
      "invoices", "invoice_allocations", "payments", "attachments", "audit_logs",
      "v_request_line_financials", "v_order_financials", "v_invoice_balances",
    ]));
  });

  it("loads the required sanitized seed counts", async () => {
    await expect(Promise.all([
      count(db, "companies"),
      count(db, "branches"),
      count(db, "suppliers"),
      count(db, "products"),
      count(db, "requests"),
      count(db, "request_lines"),
    ])).resolves.toEqual([3, 3, 10, 25, 15, 17]);
  });

  it("can apply the seed repeatedly without duplicating records", async () => {
    await db.exec(demoSeedSql);

    await expect(Promise.all([
      count(db, "companies"),
      count(db, "branches"),
      count(db, "suppliers"),
      count(db, "products"),
      count(db, "product_suppliers"),
      count(db, "requests"),
      count(db, "request_lines"),
      count(db, "deliveries"),
      count(db, "invoices"),
      count(db, "payments"),
    ])).resolves.toEqual([3, 3, 10, 25, 25, 15, 17, 5, 5, 2]);
  });

  it("keeps every seeded branch and request attached to the correct company", async () => {
    const branchOrphans = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM branches b LEFT JOIN companies c ON c.id = b.company_id
      WHERE c.id IS NULL
    `);
    const requestMismatches = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM requests r JOIN branches b ON b.id = r.branch_id
      WHERE b.company_id <> r.company_id
    `);
    const lineOrphans = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM request_lines l LEFT JOIN requests r ON r.id = l.request_id
      WHERE r.id IS NULL
    `);

    expect(Number(branchOrphans.rows[0].count)).toBe(0);
    expect(Number(requestMismatches.rows[0].count)).toBe(0);
    expect(Number(lineOrphans.rows[0].count)).toBe(0);
  });

  it("provides the expected forward workflow and reason-controlled exceptions", async () => {
    const transitions = await db.query<{ from_status: string; to_status: string; reason_required: boolean }>(`
      SELECT source.label AS from_status, target.label AS to_status, transition.reason_required
      FROM request_status_transitions transition
      JOIN lookup_values source ON source.id = transition.from_status_id
      JOIN lookup_values target ON target.id = transition.to_status_id
    `);
    const find = (from: string, to: string) => transitions.rows.find(
      (transition) => transition.from_status === from && transition.to_status === to,
    );

    expect(find("New Request", "Under Verification")?.reason_required).toBe(false);
    expect(find("New Request", "Cancelled")?.reason_required).toBe(true);
    expect(find("New Request", "On Hold")?.reason_required).toBe(true);
    expect(find("New Request", "Completed")).toBeUndefined();
  });

  it("calculates seeded order and invoice balances in database views", async () => {
    const order = await db.query<{
      buying_cost: number;
      sales_amount: number;
      gross_profit: number;
      gross_margin_percent: number;
      delivery_charges: number;
    }>(`
      SELECT buying_cost::float8, sales_amount::float8, gross_profit::float8,
             gross_margin_percent::float8, delivery_charges::float8
      FROM v_order_financials WHERE order_code = 'ORD-2026-001'
    `);
    const paid = await db.query<{ payment_status: string; outstanding_amount: number }>(`
      SELECT payment_status, outstanding_amount::float8
      FROM v_invoice_balances WHERE invoice_number = 'CINV-DEMO-009'
    `);
    const unpaid = await db.query<{ payment_status: string; outstanding_amount: number }>(`
      SELECT payment_status, outstanding_amount::float8
      FROM v_invoice_balances WHERE invoice_number = 'CINV-DEMO-012'
    `);

    expect(order.rows[0]).toEqual({
      buying_cost: 100,
      sales_amount: 140,
      gross_profit: 40,
      gross_margin_percent: 28.57,
      delivery_charges: 5,
    });
    expect(paid.rows[0]).toEqual({ payment_status: "Paid", outstanding_amount: 0 });
    expect(unpaid.rows[0]).toEqual({ payment_status: "Unpaid", outstanding_amount: 81 });
  });

  it("enforces the canonical COD value for payments and settlement terms", async () => {
    const [methods, companyTerms, supplierTerms] = await Promise.all([
      db.query<{ method: string }>("SELECT DISTINCT method FROM payments"),
      db.query<{ payment_terms: string }>("SELECT DISTINCT payment_terms FROM companies"),
      db.query<{ payment_terms: string }>("SELECT DISTINCT payment_terms FROM suppliers"),
    ]);
    expect(methods.rows).toEqual([{ method: "Cash on delivery (COD)" }]);
    expect(companyTerms.rows).toEqual([{ payment_terms: "Cash on delivery (COD)" }]);
    expect(supplierTerms.rows).toEqual([{ payment_terms: "Cash on delivery (COD)" }]);

    await expect(db.exec(`
      INSERT INTO payments (invoice_id, payment_date, amount, method, reference)
      VALUES (
        '80000000-0000-4000-8000-000000000012', '2026-07-22', 1,
        'Bank transfer', 'INVALID-NON-COD'
      )
    `)).rejects.toThrow();

    await expect(db.exec(`
      UPDATE companies SET payment_terms = '30 days'
      WHERE id = '10000000-0000-4000-8000-000000000001'
    `)).rejects.toThrow();

    await expect(db.exec(`
      UPDATE suppliers SET payment_terms = 'Bank transfer'
      WHERE id = '30000000-0000-4000-8000-000000000001'
    `)).rejects.toThrow();
  });

  it("rejects a branch whose company does not exist", async () => {
    await expect(db.exec(`
      INSERT INTO branches (
        id, branch_code_id, company_id, name, branch_code, delivery_address
      ) VALUES (
        'ffffffff-ffff-4fff-8fff-fffffffffff1', 'B-INVALID',
        'ffffffff-ffff-4fff-8fff-fffffffffff2', 'Invalid branch',
        'INVALID', 'Invalid address'
      )
    `)).rejects.toThrow();
  });

  it("enforces company membership for every non-owner user", async () => {
    await expect(db.exec(`
      INSERT INTO users (email, display_name, password_hash, role_id, is_owner)
      SELECT 'orphan@example.test', 'Orphan user', 'not-a-real-hash', id, false
      FROM roles WHERE role_key='VIEWER'
    `)).rejects.toThrow();

    await expect(db.exec(`
      INSERT INTO users (email, display_name, password_hash, role_id, company_id, is_owner)
      SELECT 'tenant@example.test', 'Tenant user', 'not-a-real-hash', r.id,
             '10000000-0000-4000-8000-000000000001', false
      FROM roles r WHERE r.role_key='VIEWER'
    `)).resolves.not.toThrow();
  });

  it("allows the same supplier name in separate company tenants", async () => {
    await expect(db.exec(`
      INSERT INTO suppliers (supplier_code, name, category, contact_name, phone, email, address,
        coverage_area, payment_terms, lead_time_days, minimum_order_quantity, main_products, company_id)
      VALUES
        ('S-TENANT-A', 'Tenant supplier', 'General', 'A', '1', 'a@tenant.test', 'A', 'A',
         'Cash on delivery (COD)', 1, 1, 'General', '10000000-0000-4000-8000-000000000001'),
        ('S-TENANT-B', 'Tenant supplier', 'General', 'B', '2', 'b@tenant.test', 'B', 'B',
         'Cash on delivery (COD)', 1, 1, 'General', '10000000-0000-4000-8000-000000000002')
    `)).resolves.not.toThrow();
  });

  it("stores uploaded file bytes persistently and scopes their audit record", async () => {
    await db.exec(`
      INSERT INTO attachments (
        id, entity_type, record_id, file_name, content_type, storage_path, company_id, file_content
      ) VALUES (
        'ffffffff-ffff-4fff-8fff-ffffffffffa1', 'request',
        '50000000-0000-4000-8000-000000000001', 'evidence.txt', 'text/plain',
        'request/db-backed-evidence.txt', '10000000-0000-4000-8000-000000000001',
        decode('41786f7261', 'hex')
      )
    `);
    const attachment = await db.query<{ size: number }>(`
      SELECT octet_length(file_content)::int AS size
      FROM attachments WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffa1'
    `);
    const audit = await db.query<{ company_id: string }>(`
      SELECT company_id::text
      FROM audit_logs
      WHERE entity_type='attachments' AND record_id='ffffffff-ffff-4fff-8fff-ffffffffffa1'
      ORDER BY occurred_at DESC LIMIT 1
    `);

    expect(attachment.rows[0].size).toBe(5);
    expect(audit.rows[0].company_id).toBe("10000000-0000-4000-8000-000000000001");
  });
});

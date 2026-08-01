import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

async function count(db: PGlite, table: string) {
  const result = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
  return Number(result.rows[0].count);
}

describe("PostgreSQL migration and demonstration seed", () => {
  let db: PGlite;
  let demoSeedSql: string;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    demoSeedSql = await applyDemoSeed(db);
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
    ])).resolves.toEqual([3, 3, 10, 25, 25, 15, 17, 5, 4, 2]);
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
    expect(find("Under Verification", "Waiting for Approval")).toBeUndefined();
    expect(find("Waiting for Quotation", "Waiting for Approval")).toBeUndefined();
    expect(find("Waiting for Quotation", "Supplier Assigned")?.reason_required).toBe(false);
    expect(find("Waiting for Approval", "Approved")?.reason_required).toBe(false);
    expect(find("New Request", "Cancelled")?.reason_required).toBe(true);
    expect(find("New Request", "On Hold")).toBeUndefined();
    expect(find("Under Verification", "On Hold")?.reason_required).toBe(true);
    expect(find("Waiting for Quotation", "On Hold")).toBeUndefined();
    expect(find("New Request", "Completed")).toBeUndefined();
  });

  it("commits branch budget in the month of approval, not the request month", async () => {
    const request = await db.query<{ id: string; branch_id: string }>(
      "SELECT id::text,branch_id::text FROM requests WHERE order_code='ORD-2026-001'",
    );
    await db.query("UPDATE requests SET request_date=CURRENT_DATE - interval '2 months' WHERE id=$1", [request.rows[0].id]);
    await db.query(`INSERT INTO approvals(request_id,approval_type,status,reason,decided_at)
      VALUES ($1,'Company approval','Approved','Budget test',now())`, [request.rows[0].id]);

    const usage = await db.query<{ committed_amount: number }>(
      "SELECT committed_amount::float8 FROM v_branch_budget_usage WHERE branch_id=$1",
      [request.rows[0].branch_id],
    );
    expect(Number(usage.rows[0].committed_amount)).toBe(140);
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

  it("enforces delivery evidence and final quantity semantics in the database", async () => {
    await expect(db.exec(`
      INSERT INTO deliveries (request_line_id,status_id,quantity_received)
      VALUES (
        '60000000-0000-4000-8000-000000000001',
        lookup_id('delivery_status','Scheduled'),
        1
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO deliveries (request_line_id,status_id,quantity_received,actual_date,received_by)
      VALUES (
        '60000000-0000-4000-8000-000000000001',
        lookup_id('delivery_status','Delivered'),
        5,
        CURRENT_DATE,
        'Test receiver'
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO deliveries (request_line_id,status_id,quantity_received,actual_date,received_by)
      VALUES (
        '60000000-0000-4000-8000-000000000001',
        lookup_id('delivery_status','Partially Delivered'),
        10,
        CURRENT_DATE,
        'Test receiver'
      )
    `)).rejects.toThrow();
  });

  it("enforces delivery, supplier, and approved-total invoice controls in the database", async () => {
    await expect(db.exec(`
      INSERT INTO invoices (
        direction,request_id,company_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'CUSTOMER',
        '50000000-0000-4000-8000-000000000008',
        '10000000-0000-4000-8000-000000000002',
        'CINV-EARLY-TEST',
        CURRENT_DATE,
        1,
        lookup_id('invoice_status','Issued')
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO invoices (
        direction,request_id,company_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'CUSTOMER',
        '50000000-0000-4000-8000-000000000012',
        '10000000-0000-4000-8000-000000000003',
        'CINV-OVER-TEST',
        CURRENT_DATE,
        0.01,
        lookup_id('invoice_status','Issued')
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO invoices (
        direction,request_id,supplier_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'SUPPLIER',
        '50000000-0000-4000-8000-000000000012',
        '30000000-0000-4000-8000-000000000001',
        'SINV-WRONG-SUPPLIER-TEST',
        CURRENT_DATE,
        1,
        lookup_id('invoice_status','Issued')
      )
    `)).rejects.toThrow();
  });

  it("requires a numbered receipt reference and positive catalog prices", async () => {
    await expect(db.exec(`
      INSERT INTO payments (invoice_id,payment_date,amount,method,reference)
      VALUES (
        '80000000-0000-4000-8000-000000000012',
        CURRENT_DATE,
        1,
        'Cash on delivery (COD)',
        NULL
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE products SET default_sell_price=0
      WHERE id='40000000-0000-4000-8000-000000000001'
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

  it("supports multiple protected platform owners", async () => {
    await expect(db.exec(`
      INSERT INTO users (email, display_name, password_hash, role_id, is_owner)
      SELECT 'owner-one@example.test', 'Owner One', 'not-a-real-hash', id, true
      FROM roles WHERE role_key='ADMIN';

      INSERT INTO users (email, display_name, password_hash, role_id, is_owner)
      SELECT 'owner-two@example.test', 'Owner Two', 'not-a-real-hash', id, true
      FROM roles WHERE role_key='ADMIN';
    `)).resolves.not.toThrow();

    const owners = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM users
      WHERE email IN ('owner-one@example.test', 'owner-two@example.test')
        AND is_owner
        AND company_id IS NULL
    `);
    expect(Number(owners.rows[0].count)).toBe(2);
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

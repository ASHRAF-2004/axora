import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const financeOne = "d5100000-0000-4000-8000-000000000001";
const financeTwo = "d5100000-0000-4000-8000-000000000002";
const requestLine = "60000000-0000-4000-8000-000000000010";
const customerInvoice = "80000000-0000-4000-8000-000000000009";
const validMatch = "d5200000-0000-4000-8000-000000000001";
const company = "10000000-0000-4000-8000-000000000002";

describe("customer three-way match database security", () => {
  let db: PGlite;
  let orderedQuantity: number;
  let orderedUnitPrice: number;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status
      )
      SELECT '${financeOne}','match-finance-one@example.test','Match finance one',
        'not-a-real-hash',id,'${company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='FINANCE_REVIEWER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status
      )
      SELECT '${financeTwo}','match-finance-two@example.test','Match finance two',
        'not-a-real-hash',id,'${company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='FINANCE_REVIEWER';

      INSERT INTO company_memberships(user_id,company_id,status,joined_at)
      VALUES
        ('${financeOne}','${company}','ACTIVE',now()),
        ('${financeTwo}','${company}','ACTIVE',now());
      INSERT INTO role_assignments(
        user_id,role_id,scope_type,company_id,active
      )
      SELECT '${financeOne}',id,'COMPANY','${company}',true
      FROM roles WHERE role_key='FINANCE_REVIEWER';
      INSERT INTO role_assignments(
        user_id,role_id,scope_type,company_id,active
      )
      SELECT '${financeTwo}',id,'COMPANY','${company}',true
      FROM roles WHERE role_key='FINANCE_REVIEWER';
    `);
    const line = await db.query<{ quantity: number; unit_price: number }>(`
      SELECT quantity::float8,unit_sell_price::float8 AS unit_price
      FROM request_lines WHERE id=$1
    `, [requestLine]);
    orderedQuantity = Number(line.rows[0].quantity);
    orderedUnitPrice = Number(line.rows[0].unit_price);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("rejects exception labels that disagree with immutable price evidence", async () => {
    await expect(db.query(`
      INSERT INTO customer_three_way_matches(
        company_id,request_line_id,customer_invoice_id,receipt_line_id,status,
        exception_codes,ordered_quantity_snapshot,received_quantity_snapshot,
        invoiced_quantity_snapshot,ordered_unit_price_snapshot,
        invoiced_unit_price_snapshot,quantity_variance,price_variance,
        evaluated_by_user_id,idempotency_key
      ) VALUES (
        $1,$2,$3,NULL,'NOT_READY',ARRAY['MISSING_RECEIPT']::text[],
        $4,NULL,$4,$5,$6,NULL,$7,$8,$9
      )
    `, [
      company,
      requestLine,
      customerInvoice,
      orderedQuantity,
      orderedUnitPrice,
      orderedUnitPrice + 1,
      1,
      financeOne,
      "d5300000-0000-4000-8000-000000000001",
    ])).rejects.toThrow();
  });

  it("requires an Issued invoice and an Approved company approval at write time", async () => {
    const attemptEvaluation = (idempotencyKey: string) => db.query(`
      INSERT INTO customer_three_way_matches(
        company_id,request_line_id,customer_invoice_id,receipt_line_id,status,
        exception_codes,ordered_quantity_snapshot,received_quantity_snapshot,
        invoiced_quantity_snapshot,ordered_unit_price_snapshot,
        invoiced_unit_price_snapshot,quantity_variance,price_variance,
        evaluated_by_user_id,idempotency_key
      ) VALUES (
        $1,$2,$3,NULL,'NOT_READY',ARRAY['MISSING_RECEIPT']::text[],
        $4,NULL,$4,$5,$5,NULL,0,$6,$7
      )
    `, [
      company,
      requestLine,
      customerInvoice,
      orderedQuantity,
      orderedUnitPrice,
      financeOne,
      idempotencyKey,
    ]);

    await db.exec("BEGIN");
    try {
      await db.query(`
        UPDATE invoices SET status_id=lookup_id('invoice_status','Draft')
        WHERE id=$1
      `, [customerInvoice]);
      await expect(attemptEvaluation(
        "d5300000-0000-4000-8000-000000000010",
      )).rejects.toThrow(/issued customer invoice/i);
    } finally {
      await db.exec("ROLLBACK");
    }

    await db.exec("BEGIN");
    try {
      await db.query(`
        DELETE FROM approvals
        WHERE request_id=(SELECT request_id FROM request_lines WHERE id=$1)
          AND approval_type='Company approval' AND status='Approved'
      `, [requestLine]);
      await expect(attemptEvaluation(
        "d5300000-0000-4000-8000-000000000011",
      )).rejects.toThrow(/approved company approval/i);
    } finally {
      await db.exec("ROLLBACK");
    }
  });

  it("allows truthful missing-receipt evidence and a true idempotent no-op", async () => {
    await db.query(`
      INSERT INTO customer_three_way_matches(
        id,company_id,request_line_id,customer_invoice_id,receipt_line_id,status,
        exception_codes,ordered_quantity_snapshot,received_quantity_snapshot,
        invoiced_quantity_snapshot,ordered_unit_price_snapshot,
        invoiced_unit_price_snapshot,quantity_variance,price_variance,
        evaluated_by_user_id,idempotency_key
      ) VALUES (
        $1,$2,$3,$4,NULL,'NOT_READY',ARRAY['MISSING_RECEIPT']::text[],
        $5,NULL,$5,$6,$6,NULL,0,$7,$8
      )
    `, [
      validMatch,
      company,
      requestLine,
      customerInvoice,
      orderedQuantity,
      orderedUnitPrice,
      financeOne,
      "d5300000-0000-4000-8000-000000000002",
    ]);
    const before = await db.query<{ updated_at: string }>(`
      SELECT updated_at::text FROM customer_three_way_matches WHERE id=$1
    `, [validMatch]);
    await db.query(`
      UPDATE customer_three_way_matches SET updated_at=updated_at WHERE id=$1
    `, [validMatch]);
    const after = await db.query<{ updated_at: string }>(`
      SELECT updated_at::text FROM customer_three_way_matches WHERE id=$1
    `, [validMatch]);
    expect(after.rows[0].updated_at).toBe(before.rows[0].updated_at);
  });

  it("forbids reclassification and permits only an independent terminal override", async () => {
    await expect(db.query(`
      UPDATE customer_three_way_matches
      SET status='EXCEPTION' WHERE id=$1
    `, [validMatch])).rejects.toThrow(/only move an exception to an override/i);

    await db.query(`
      UPDATE customer_three_way_matches
      SET status='OVERRIDDEN',overridden_by_user_id=$2,
          overridden_at=now(),override_reason='Independent evidence review'
      WHERE id=$1
    `, [validMatch, financeTwo]);
    const result = await db.query<{
      status: string;
      evaluator: string;
      overrider: string;
    }>(`
      SELECT status,evaluated_by_user_id::text AS evaluator,
        overridden_by_user_id::text AS overrider
      FROM customer_three_way_matches WHERE id=$1
    `, [validMatch]);
    expect(result.rows[0]).toEqual({
      status: "OVERRIDDEN",
      evaluator: financeOne,
      overrider: financeTwo,
    });
    await expect(db.query(`
      UPDATE customer_three_way_matches SET override_reason='Rewritten' WHERE id=$1
    `, [validMatch])).rejects.toThrow(/terminal/i);
  });
});

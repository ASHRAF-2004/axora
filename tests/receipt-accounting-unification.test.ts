import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  company: "10000000-0000-4000-8000-000000000003",
  otherCompanyLine: "60000000-0000-4000-8000-000000000010",
  branch: "20000000-0000-4000-8000-000000000003",
  request: "50000000-0000-4000-8000-000000000013",
  requestLine: "60000000-0000-4000-8000-000000000014",
  supplier: "30000000-0000-4000-8000-000000000007",
  proofOnlyRequest: "50000000-0000-4000-8000-000000000014",
  proofOnlyLine: "60000000-0000-4000-8000-000000000015",
  platform: "d7100000-0000-4000-8000-000000000001",
  receiver: "d7200000-0000-4000-8000-000000000001",
  driver: "d7300000-0000-4000-8000-000000000001",
  job: "d7400000-0000-4000-8000-000000000001",
  jobLine: "d7500000-0000-4000-8000-000000000001",
  jobAssignment: "d7800000-0000-4000-8000-000000000002",
  jobDriverEvent: "d7900000-0000-4000-8000-000000000002",
  baselineReceipt: "d7600000-0000-4000-8000-000000000001",
  baselineReceiptLine: "d7700000-0000-4000-8000-000000000001",
  proofJob: "d7400000-0000-4000-8000-000000000002",
  proofJobLine: "d7500000-0000-4000-8000-000000000002",
  assignment: "d7800000-0000-4000-8000-000000000001",
  driverEvent: "d7900000-0000-4000-8000-000000000001",
  proofOnlyInvoice: "d7a00000-0000-4000-8000-000000000001",
  newReceipt: "da100000-0000-4000-8000-000000000001",
  newReceiptLine: "da200000-0000-4000-8000-000000000001",
  remainingJob: "da600000-0000-4000-8000-000000000001",
};

const migrationUrl = new URL(
  "../database/migrations/027_receipt_accounting_unification.sql",
  import.meta.url,
);

describe("receipt accounting unification", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "026_workflow_email_delivery.sql" });
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,account_setup_completed_at
      ) SELECT
        '${ids.platform}','receipt-platform@example.test','Receipt platform',
        'not-a-real-hash',id,true,'PLATFORM','ACTIVE',now()
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO role_assignments(
        user_id,role_id,scope_type,active
      ) SELECT '${ids.platform}',id,'PLATFORM',true
      FROM roles WHERE role_key='PLATFORM_OWNER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_kind,account_status,account_setup_completed_at
      ) SELECT
        '${ids.receiver}','receipt-receiver@example.test','Receipt receiver',
        'not-a-real-hash',id,'${ids.company}','${ids.branch}',false,'COMPANY',
        'ACTIVE',now()
      FROM roles WHERE role_key='RECEIVING_USER';
      INSERT INTO company_memberships(
        user_id,company_id,status,joined_at
      ) VALUES ('${ids.receiver}','${ids.company}','ACTIVE',now());
      INSERT INTO branch_assignments(
        user_id,company_id,branch_id,status,is_primary
      ) VALUES (
        '${ids.receiver}','${ids.company}','${ids.branch}','ACTIVE',true
      );
      INSERT INTO role_assignments(
        user_id,role_id,scope_type,company_id,branch_id,active
      ) SELECT
        '${ids.receiver}',id,'BRANCH','${ids.company}','${ids.branch}',true
      FROM roles WHERE role_key='RECEIVING_USER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,account_setup_completed_at
      ) SELECT
        '${ids.driver}','receipt-driver@example.test','Receipt driver',
        'not-a-real-hash',id,false,'DELIVERY','ACTIVE',now()
      FROM roles WHERE role_key='DELIVERY_DRIVER';
      INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
      VALUES ('${ids.driver}','DRV-RECEIPT-027',true);

      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,status,
        delivery_address_snapshot,idempotency_key,created_by
      ) VALUES (
        '${ids.job}','${ids.company}','${ids.branch}','${ids.request}',
        'JOB-RECEIPT-027','CREATED','Receipt test address',
        'receipt-unification-job-0001','${ids.platform}'
      );
      INSERT INTO delivery_job_lines(
        id,company_id,delivery_job_id,request_line_id,quantity_to_deliver,
        unit_of_measure_snapshot
      ) VALUES (
        '${ids.jobLine}','${ids.company}','${ids.job}','${ids.requestLine}',8,
        'Bottle'
      );
      INSERT INTO delivery_job_assignments(
        id,company_id,delivery_job_id,driver_user_id,status,assigned_by,
        assigned_at,accepted_at
      ) VALUES (
        '${ids.jobAssignment}','${ids.company}','${ids.job}','${ids.driver}',
        'ACCEPTED','${ids.platform}',now()-interval '1 hour',
        now()-interval '50 minutes'
      );
      UPDATE delivery_jobs SET status='ASSIGNED' WHERE id='${ids.job}';
      INSERT INTO delivery_job_events(
        id,company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at
      ) VALUES (
        '${ids.jobDriverEvent}','${ids.company}','${ids.job}',
        '${ids.jobAssignment}','${ids.driver}',
        'da400000-0000-4000-8000-000000000002',
        'da500000-0000-4000-8000-000000000002',1,'DELIVERED',now()
      );
      INSERT INTO receipts(
        id,company_id,branch_id,delivery_job_id,receipt_reference,status,
        confirmed_by_user_id,client_event_id,received_at
      ) VALUES (
        '${ids.baselineReceipt}','${ids.company}','${ids.branch}','${ids.job}',
        'REC-BASELINE-027','ACCEPTED_WITH_EXCEPTIONS','${ids.receiver}',
        'da300000-0000-4000-8000-000000000001',now()
      );
      INSERT INTO receipt_lines(
        id,company_id,receipt_id,delivery_job_id,delivery_job_line_id,
        request_line_id,planned_quantity_snapshot,delivered_quantity,
        accepted_quantity,rejected_quantity,damaged_quantity,short_quantity,
        discrepancy_code
      ) VALUES (
        '${ids.baselineReceiptLine}','${ids.company}','${ids.baselineReceipt}',
        '${ids.job}','${ids.jobLine}','${ids.requestLine}',8,3,3,0,0,5,'SHORT'
      );
      UPDATE requests SET status_id=lookup_id('request_status','Delivered')
      WHERE id='${ids.request}';

      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,status,
        delivery_address_snapshot,idempotency_key,created_by
      ) VALUES (
        '${ids.proofJob}','${ids.company}','${ids.branch}',
        '${ids.proofOnlyRequest}','JOB-PROOF-ONLY-027','CREATED',
        'Proof-only test address','receipt-unification-job-0002',
        '${ids.platform}'
      );
      INSERT INTO delivery_job_lines(
        id,company_id,delivery_job_id,request_line_id,quantity_to_deliver,
        unit_of_measure_snapshot
      ) VALUES (
        '${ids.proofJobLine}','${ids.company}','${ids.proofJob}',
        '${ids.proofOnlyLine}',10,'Pack'
      );
      INSERT INTO delivery_job_assignments(
        id,company_id,delivery_job_id,driver_user_id,status,assigned_by,
        assigned_at,accepted_at
      ) VALUES (
        '${ids.assignment}','${ids.company}','${ids.proofJob}','${ids.driver}',
        'ACCEPTED','${ids.platform}',now()-interval '1 hour',
        now()-interval '50 minutes'
      );
      INSERT INTO delivery_job_events(
        id,company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at
      ) VALUES (
        '${ids.driverEvent}','${ids.company}','${ids.proofJob}',
        '${ids.assignment}','${ids.driver}',
        'da400000-0000-4000-8000-000000000001',
        'da500000-0000-4000-8000-000000000001',1,'DELIVERED',now()
      );

      -- Build a pre-027 invoice that passed the old mutable-delivery gate,
      -- then remove that mutable row. Migration 027 must not let the driver's
      -- proof above stand in for missing customer acceptance at COD time.
      INSERT INTO deliveries(
        id,request_line_id,actual_date,status_id,quantity_received,received_by
      ) VALUES (
        'd7b00000-0000-4000-8000-000000000001','${ids.proofOnlyLine}',
        CURRENT_DATE,lookup_id('delivery_status','Delivered'),10,
        'Pre-migration receiver'
      );
      UPDATE requests SET status_id=lookup_id('request_status','Delivered')
      WHERE id='${ids.proofOnlyRequest}';
      INSERT INTO invoices(
        id,direction,request_id,company_id,invoice_number,invoice_date,
        amount,status_id
      ) VALUES (
        '${ids.proofOnlyInvoice}','CUSTOMER','${ids.proofOnlyRequest}',
        '${ids.company}','CINV-PROOF-ONLY-027',CURRENT_DATE,1,
        lookup_id('invoice_status','Issued')
      );
      DELETE FROM deliveries
      WHERE id='d7b00000-0000-4000-8000-000000000001';
    `);
    await db.exec(await readFile(migrationUrl, "utf8"));
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function setApplicationActor(userId?: string) {
    await db.exec("RESET ROLE");
    await db.exec("SET ROLE axora_app");
    await db.query(
      "SELECT set_config('axora.user_id',$1,false)",
      [userId ?? ""],
    );
  }

  async function resetApplicationActor() {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('axora.user_id','',false)");
  }

  it("takes the greater pre-migration source once and ignores driver proof", async () => {
    const baseline = await db.query<{
      legacy: number;
      independent: number;
      accepted: number;
      source_count: number;
    }>(`
      SELECT legacy_accepted_quantity_snapshot::float8 AS legacy,
        independent_accepted_quantity_snapshot::float8 AS independent,
        baseline_accepted_quantity::float8 AS accepted,
        (SELECT count(*)::int
          FROM request_line_receipt_baseline_sources source
          WHERE source.request_line_id=baseline.request_line_id) AS source_count
      FROM request_line_receipt_baselines baseline
      WHERE request_line_id='${ids.requestLine}'
    `);
    expect(baseline.rows[0]).toEqual({
      legacy: 4,
      independent: 3,
      accepted: 4,
      source_count: 1,
    });

    await setApplicationActor(ids.platform);
    try {
      const proofOnly = await db.query<{ received: number }>(`
        SELECT axora_received_quantity('${ids.proofOnlyLine}')::float8
          AS received
      `);
      expect(proofOnly.rows[0].received).toBe(0);
    } finally {
      await resetApplicationActor();
    }
  });

  it("does not accept COD when only driver proof remains", async () => {
    await expect(db.exec(`
      INSERT INTO payments(
        invoice_id,payment_date,amount,method,reference
      ) VALUES (
        '${ids.proofOnlyInvoice}',CURRENT_DATE,1,
        'Cash on delivery (COD)','COD-PROOF-ONLY-027'
      )
    `)).rejects.toThrow("full receipt");
  });

  it("fails closed outside active tenant scope and hides the raw calculator", async () => {
    await setApplicationActor(ids.receiver);
    try {
      const own = await db.query<{ received: number }>(`
        SELECT axora_received_quantity('${ids.requestLine}')::float8
          AS received
      `);
      expect(own.rows[0].received).toBe(4);
      await expect(db.query(`
        SELECT axora_received_quantity('${ids.otherCompanyLine}')
      `)).rejects.toThrow("unavailable");
      await expect(db.query(`
        SELECT axora_effective_received_quantity_internal('${ids.requestLine}')
      `)).rejects.toThrow();
    } finally {
      await resetApplicationActor();
    }

    await setApplicationActor();
    try {
      await expect(db.query(`
        SELECT axora_received_quantity('${ids.requestLine}')
      `)).rejects.toThrow("unavailable");
    } finally {
      await resetApplicationActor();
    }

    await db.exec(`
      UPDATE company_memberships SET status='SUSPENDED'
      WHERE user_id='${ids.receiver}' AND company_id='${ids.company}'
    `);
    await setApplicationActor(ids.receiver);
    try {
      await expect(db.query(`
        SELECT axora_received_quantity('${ids.requestLine}')
      `)).rejects.toThrow("unavailable");
    } finally {
      await resetApplicationActor();
      await db.exec(`
        UPDATE company_memberships SET status='ACTIVE'
        WHERE user_id='${ids.receiver}' AND company_id='${ids.company}'
      `);
    }
  });

  it("blocks invoice gates while receipt is partial, then counts a later receipt", async () => {
    const normalDriverPath = await db.query<{
      status: string;
      delivered_events: number;
      receipt_lines: number;
    }>(`
      SELECT job.status,
        (SELECT count(*)::int FROM delivery_job_events event
          WHERE event.delivery_job_id=job.id
            AND event.event_type='DELIVERED') AS delivered_events,
        (SELECT count(*)::int FROM receipt_lines line
          WHERE line.delivery_job_id=job.id) AS receipt_lines
      FROM delivery_jobs job WHERE job.id='${ids.job}'
    `);
    expect(normalDriverPath.rows[0]).toEqual({
      status: "ASSIGNED",
      delivered_events: 1,
      receipt_lines: 1,
    });

    await db.exec(`
      UPDATE requests SET status_id=lookup_id('request_status','Preparing for Delivery')
      WHERE id='${ids.request}';
    `);
    await expect(db.exec(`
      UPDATE requests SET status_id=lookup_id('request_status','Delivered')
      WHERE id='${ids.request}'
    `)).rejects.toThrow("full customer receipt");
    await expect(db.exec(`
      INSERT INTO invoices(
        direction,request_id,company_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'CUSTOMER','${ids.request}','${ids.company}','CINV-PARTIAL-027',
        CURRENT_DATE,1,lookup_id('invoice_status','Issued')
      )
    `)).rejects.toThrow("fully received");
    await expect(db.exec(`
      INSERT INTO invoices(
        direction,request_id,supplier_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'SUPPLIER','${ids.request}','${ids.supplier}','SINV-PARTIAL-027',
        CURRENT_DATE,1,lookup_id('invoice_status','Issued')
      )
    `)).rejects.toThrow("fully received");

    await db.exec(`
      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,status,
        delivery_address_snapshot,idempotency_key,created_by
      ) VALUES (
        '${ids.remainingJob}','${ids.company}','${ids.branch}','${ids.request}',
        'JOB-REMAINING-027','CREATED','Remaining quantity address',
        'receipt-unification-job-remaining','${ids.platform}'
      )
    `);
    await expect(db.exec(`
      INSERT INTO delivery_job_lines(
        company_id,delivery_job_id,request_line_id,quantity_to_deliver,
        unit_of_measure_snapshot
      ) VALUES (
        '${ids.company}','${ids.remainingJob}','${ids.requestLine}',5,'Bottle'
      )
    `)).rejects.toThrow("unreceived ordered quantity");
    await expect(db.exec(`
      INSERT INTO delivery_job_lines(
        company_id,delivery_job_id,request_line_id,quantity_to_deliver,
        unit_of_measure_snapshot
      ) VALUES (
        '${ids.company}','${ids.remainingJob}','${ids.requestLine}',4,'Bottle'
      )
    `)).resolves.not.toThrow();
    await db.exec(`
      UPDATE delivery_jobs SET status='CANCELLED'
      WHERE id='${ids.remainingJob}'
    `);

    await db.exec(`
      INSERT INTO receipts(
        id,company_id,branch_id,delivery_job_id,receipt_reference,status,
        confirmed_by_user_id,client_event_id,received_at
      ) VALUES (
        '${ids.newReceipt}','${ids.company}','${ids.branch}','${ids.job}',
        'REC-LATER-027','ACCEPTED_WITH_EXCEPTIONS','${ids.receiver}',
        'da300000-0000-4000-8000-000000000002',now()
      );
      INSERT INTO receipt_lines(
        id,company_id,receipt_id,delivery_job_id,delivery_job_line_id,
        request_line_id,planned_quantity_snapshot,delivered_quantity,
        accepted_quantity,rejected_quantity,damaged_quantity,short_quantity,
        discrepancy_code
      ) VALUES (
        '${ids.newReceiptLine}','${ids.company}','${ids.newReceipt}','${ids.job}',
        '${ids.jobLine}','${ids.requestLine}',8,4,4,0,0,4,'SHORT'
      );
    `);

    await setApplicationActor(ids.receiver);
    try {
      const received = await db.query<{ received: number }>(`
        SELECT axora_received_quantity('${ids.requestLine}')::float8
          AS received
      `);
      expect(received.rows[0].received).toBe(8);
    } finally {
      await resetApplicationActor();
    }

    await expect(db.exec(`
      INSERT INTO receipt_lines(
        company_id,receipt_id,delivery_job_id,delivery_job_line_id,
        request_line_id,planned_quantity_snapshot,delivered_quantity,
        accepted_quantity,rejected_quantity,damaged_quantity,short_quantity,
        discrepancy_code
      ) VALUES (
        '${ids.company}','${ids.newReceipt}','${ids.job}','${ids.jobLine}',
        '${ids.requestLine}',8,1,1,0,0,7,'SHORT'
      )
    `)).rejects.toThrow();

    await expect(db.exec(`
      UPDATE requests SET status_id=lookup_id('request_status','Delivered')
      WHERE id='${ids.request}'
    `)).resolves.not.toThrow();

    await expect(db.exec(`
      INSERT INTO invoices(
        direction,request_id,company_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'CUSTOMER','${ids.request}','${ids.company}','CINV-FULL-027',
        CURRENT_DATE,1,lookup_id('invoice_status','Issued')
      )
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      INSERT INTO invoices(
        direction,request_id,supplier_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        'SUPPLIER','${ids.request}','${ids.supplier}','SINV-FULL-027',
        CURRENT_DATE,1,lookup_id('invoice_status','Issued')
      )
    `)).resolves.not.toThrow();
  });

  it("freezes legacy acceptance rows while preserving ordinary logistics status", async () => {
    await expect(db.exec(`
      INSERT INTO deliveries(
        request_line_id,status_id,quantity_received,actual_date,received_by
      ) VALUES (
        '${ids.proofOnlyLine}',lookup_id('delivery_status','Delivered'),10,
        CURRENT_DATE,'Legacy receiver'
      )
    `)).rejects.toThrow("receiving");
    await expect(db.exec(`
      UPDATE deliveries SET received_by='Rewritten'
      WHERE id='70000000-0000-4000-8000-000000000013'
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO deliveries(
        request_line_id,status_id,quantity_received,issue_reason
      ) VALUES (
        '${ids.proofOnlyLine}',lookup_id('delivery_status','Delayed'),0,
        'Customer location temporarily unavailable'
      )
    `)).resolves.not.toThrow();
  });
});

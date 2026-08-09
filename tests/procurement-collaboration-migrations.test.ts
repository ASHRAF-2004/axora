import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  branch: "20000000-0000-4000-8000-000000000001",
  supplier: "30000000-0000-4000-8000-000000000001",
  competitorSupplier: "30000000-0000-4000-8000-000000000002",
  request: "50000000-0000-4000-8000-000000000001",
  requestLine: "60000000-0000-4000-8000-000000000001",
  platform: "e1000000-0000-4000-8000-000000000001",
  supplierUser: "e2000000-0000-4000-8000-000000000001",
  competitorUser: "e2000000-0000-4000-8000-000000000002",
  driver: "e3000000-0000-4000-8000-000000000001",
  otherDriver: "e3000000-0000-4000-8000-000000000002",
  receiver: "e4000000-0000-4000-8000-000000000001",
  financeOne: "e5000000-0000-4000-8000-000000000001",
  financeTwo: "e5000000-0000-4000-8000-000000000002",
  supplierMembership: "d1000000-0000-4000-8000-000000000001",
  competitorMembership: "d1000000-0000-4000-8000-000000000002",
  workflowEvent: "c1000000-0000-4000-8000-000000000001",
  notification: "c2000000-0000-4000-8000-000000000001",
  rfq: "c3000000-0000-4000-8000-000000000001",
  competitorRfq: "c3000000-0000-4000-8000-000000000002",
  acknowledgement: "c4000000-0000-4000-8000-000000000001",
  quotationResponse: "c5000000-0000-4000-8000-000000000001",
  document: "c6000000-0000-4000-8000-000000000001",
  job: "b1000000-0000-4000-8000-000000000001",
  jobLine: "b2000000-0000-4000-8000-000000000001",
  assignment: "b3000000-0000-4000-8000-000000000001",
  deliveryEvent: "b4000000-0000-4000-8000-000000000001",
  deliveryClientEvent: "b5000000-0000-4000-8000-000000000001",
  evidence: "b6000000-0000-4000-8000-000000000001",
  receipt: "a1000000-0000-4000-8000-000000000001",
  receiptLine: "a2000000-0000-4000-8000-000000000001",
  supplierInvoice: "a3000000-0000-4000-8000-000000000001",
  match: "a4000000-0000-4000-8000-000000000001",
  exceptionMatch: "a4000000-0000-4000-8000-000000000002",
  matchException: "a5000000-0000-4000-8000-000000000001",
};

describe("procurement collaboration data foundation", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await applyDemoSeed(db);

    await db.exec(`
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ids.platform}','foundation-platform@example.test','Foundation platform','not-a-real-hash',id,true,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OWNER';

      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ids.supplierUser}','foundation-supplier@example.test','Foundation supplier','not-a-real-hash',id,false,'SUPPLIER','ACTIVE'
      FROM roles WHERE role_key='SUPPLIER_USER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ids.competitorUser}','foundation-competitor@example.test','Foundation competitor','not-a-real-hash',id,false,'SUPPLIER','ACTIVE'
      FROM roles WHERE role_key='SUPPLIER_USER';

      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ids.driver}','foundation-driver@example.test','Foundation driver','not-a-real-hash',id,false,'DELIVERY','ACTIVE'
      FROM roles WHERE role_key='DELIVERY_DRIVER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ids.otherDriver}','foundation-driver-two@example.test','Foundation driver two','not-a-real-hash',id,false,'DELIVERY','ACTIVE'
      FROM roles WHERE role_key='DELIVERY_DRIVER';

      INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,is_owner,account_kind,account_status)
      SELECT '${ids.receiver}','foundation-receiver@example.test','Foundation receiver','not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='RECEIVING_USER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,is_owner,account_kind,account_status)
      SELECT '${ids.financeOne}','foundation-finance-one@example.test','Foundation finance one','not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='FINANCE_REVIEWER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,is_owner,account_kind,account_status)
      SELECT '${ids.financeTwo}','foundation-finance-two@example.test','Foundation finance two','not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='FINANCE_REVIEWER';

      INSERT INTO supplier_memberships(id,user_id,supplier_id,status)
      VALUES
        ('${ids.supplierMembership}','${ids.supplierUser}','${ids.supplier}','ACTIVE'),
        ('${ids.competitorMembership}','${ids.competitorUser}','${ids.competitorSupplier}','ACTIVE');

      INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
      VALUES
        ('${ids.driver}','DRV-FOUNDATION-1',true),
        ('${ids.otherDriver}','DRV-FOUNDATION-2',true);

      INSERT INTO company_memberships(user_id,company_id,status,joined_at)
      VALUES
        ('${ids.receiver}','${ids.company}','ACTIVE',now()),
        ('${ids.financeOne}','${ids.company}','ACTIVE',now()),
        ('${ids.financeTwo}','${ids.company}','ACTIVE',now());
      INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
      VALUES ('${ids.receiver}','${ids.company}','${ids.branch}','ACTIVE',true);

      INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,branch_id,active)
      SELECT '${ids.receiver}',id,'BRANCH','${ids.company}','${ids.branch}',true
      FROM roles WHERE role_key='RECEIVING_USER';
      INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,active)
      SELECT '${ids.financeOne}',id,'COMPANY','${ids.company}',true
      FROM roles WHERE role_key='FINANCE_REVIEWER';
      INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,active)
      SELECT '${ids.financeTwo}',id,'COMPANY','${ids.company}',true
      FROM roles WHERE role_key='FINANCE_REVIEWER';

      INSERT INTO workflow_events(
        id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES (
        '${ids.workflowEvent}','${ids.company}','${ids.branch}','${ids.request}',
        'supplier_rfq','${ids.rfq}','supplier.rfq.issued',1,
        '${ids.platform}','PLATFORM','f1000000-0000-4000-8000-000000000001',
        'rfq-issued:foundation-0001',now(),'{"round":1}'::jsonb
      );

      INSERT INTO in_app_notifications(
        id,company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
        title,body,route_path
      ) VALUES (
        '${ids.notification}','${ids.company}','${ids.supplierUser}',
        '${ids.workflowEvent}','supplier.rfq.issued','rfq-notification:foundation-0001',
        'New RFQ','A quotation response is requested.','/supplier/rfqs/${ids.rfq}'
      );

      INSERT INTO supplier_rfqs(
        id,company_id,request_line_id,supplier_id,rfq_reference,issued_by,
        idempotency_key,respond_by
      ) VALUES
        ('${ids.rfq}','${ids.company}','${ids.requestLine}','${ids.supplier}',
          'RFQ-FOUNDATION-1','${ids.platform}','rfq:foundation-supplier-one',now()+interval '2 days'),
        ('${ids.competitorRfq}','${ids.company}','${ids.requestLine}','${ids.competitorSupplier}',
          'RFQ-FOUNDATION-2','${ids.platform}','rfq:foundation-supplier-two',now()+interval '2 days');

      INSERT INTO supplier_rfq_acknowledgements(
        id,company_id,rfq_id,supplier_id,supplier_membership_id,acknowledged_by,
        acknowledgement,client_event_id,acknowledged_at
      ) VALUES (
        '${ids.acknowledgement}','${ids.company}','${ids.rfq}','${ids.supplier}',
        '${ids.supplierMembership}','${ids.supplierUser}','ACKNOWLEDGED',
        'f2000000-0000-4000-8000-000000000001',now()
      );

      INSERT INTO supplier_quotation_responses(
        id,company_id,rfq_id,supplier_id,supplier_membership_id,submitted_by,
        response_version,response_status,quotation_reference,unit_price,
        delivery_charge,client_event_id,submitted_at
      ) VALUES (
        '${ids.quotationResponse}','${ids.company}','${ids.rfq}','${ids.supplier}',
        '${ids.supplierMembership}','${ids.supplierUser}',1,'SUBMITTED',
        'Q-FOUNDATION-1',10,0,'f3000000-0000-4000-8000-000000000001',now()
      );

      INSERT INTO supplier_rfq_documents(
        id,company_id,rfq_id,supplier_id,document_version,document_kind,
        file_name,content_type,storage_path,sha256,uploaded_by,supplier_membership_id
      ) VALUES (
        '${ids.document}','${ids.company}','${ids.rfq}','${ids.supplier}',1,
        'QUOTATION','quote.pdf','application/pdf',
        'supplier-portal/foundation/quote.pdf',repeat('a',64),
        '${ids.supplierUser}','${ids.supplierMembership}'
      );

      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,status,
        delivery_address_snapshot,idempotency_key,created_by
      ) VALUES (
        '${ids.job}','${ids.company}','${ids.branch}','${ids.request}',
        'JOB-FOUNDATION-1','ASSIGNED','Foundation branch address',
        'delivery-job:foundation-0001','${ids.platform}'
      );
      INSERT INTO delivery_job_lines(
        id,company_id,delivery_job_id,request_line_id,quantity_to_deliver,
        unit_of_measure_snapshot
      ) VALUES (
        '${ids.jobLine}','${ids.company}','${ids.job}','${ids.requestLine}',10,'Ream'
      );
      INSERT INTO delivery_job_assignments(
        id,company_id,delivery_job_id,driver_user_id,status,assigned_by,assigned_at,accepted_at
      ) VALUES (
        '${ids.assignment}','${ids.company}','${ids.job}','${ids.driver}',
        'ACCEPTED','${ids.platform}',now()-interval '1 hour',now()-interval '55 minutes'
      );
      INSERT INTO delivery_job_events(
        id,company_id,delivery_job_id,assignment_id,driver_user_id,
        device_id,client_event_id,device_sequence,event_type,client_recorded_at
      ) VALUES (
        '${ids.deliveryEvent}','${ids.company}','${ids.job}','${ids.assignment}',
        '${ids.driver}','b7000000-0000-4000-8000-000000000001',
        '${ids.deliveryClientEvent}',1,'DELIVERED',now()-interval '5 minutes'
      );
      INSERT INTO delivery_evidence(
        id,company_id,delivery_job_id,delivery_job_event_id,driver_user_id,
        client_evidence_id,evidence_type,file_name,content_type,storage_path,sha256,captured_at
      ) VALUES (
        '${ids.evidence}','${ids.company}','${ids.job}','${ids.deliveryEvent}',
        '${ids.driver}','b8000000-0000-4000-8000-000000000001',
        'PHOTO','doorstep.jpg','image/jpeg',
        'delivery-evidence/foundation/doorstep.jpg',repeat('b',64),now()-interval '5 minutes'
      );

      INSERT INTO receipts(
        id,company_id,branch_id,delivery_job_id,receipt_reference,status,
        confirmed_by_user_id,client_event_id,received_at
      ) VALUES (
        '${ids.receipt}','${ids.company}','${ids.branch}','${ids.job}',
        'REC-FOUNDATION-1','ACCEPTED','${ids.receiver}',
        'f4000000-0000-4000-8000-000000000001',now()
      );
      INSERT INTO receipt_lines(
        id,company_id,receipt_id,delivery_job_id,delivery_job_line_id,
        request_line_id,planned_quantity_snapshot,delivered_quantity,
        accepted_quantity,rejected_quantity,damaged_quantity,short_quantity,
        discrepancy_code
      ) VALUES (
        '${ids.receiptLine}','${ids.company}','${ids.receipt}','${ids.job}',
        '${ids.jobLine}','${ids.requestLine}',10,10,10,0,0,0,'NONE'
      );

      INSERT INTO approvals(id,request_id,approval_type,status,reason,decided_at)
      VALUES (
        'a6000000-0000-4000-8000-000000000001','${ids.request}',
        'Company approval','Approved','Foundation test approval',now()
      );
      UPDATE requests
      SET status_id=lookup_id('request_status','Delivered')
      WHERE id='${ids.request}';

      INSERT INTO invoices(
        id,direction,request_id,supplier_id,invoice_number,invoice_date,amount,status_id
      ) VALUES (
        '${ids.supplierInvoice}','SUPPLIER','${ids.request}','${ids.supplier}',
        'SINV-FOUNDATION-1',CURRENT_DATE,100,lookup_id('invoice_status','Issued')
      );

      INSERT INTO three_way_matches(
        id,company_id,request_line_id,supplier_invoice_id,receipt_line_id,
        supplier_quotation_response_id,status,ordered_quantity_snapshot,
        received_quantity_snapshot,invoiced_quantity_snapshot,
        ordered_unit_price_snapshot,invoiced_unit_price_snapshot,
        quantity_variance,price_variance,evaluated_by_user_id
      ) VALUES (
        '${ids.match}','${ids.company}','${ids.requestLine}','${ids.supplierInvoice}',
        '${ids.receiptLine}','${ids.quotationResponse}','MATCHED',10,10,10,10,10,0,0,
        '${ids.financeOne}'
      );
      INSERT INTO three_way_matches(
        id,company_id,request_line_id,supplier_quotation_response_id,status,
        ordered_quantity_snapshot,ordered_unit_price_snapshot,evaluated_by_user_id
      ) VALUES (
        '${ids.exceptionMatch}','${ids.company}','${ids.requestLine}',
        '${ids.quotationResponse}','NOT_READY',10,10,'${ids.financeOne}'
      );
      INSERT INTO three_way_match_exceptions(
        id,company_id,three_way_match_id,exception_code,status,detail,raised_by_user_id
      ) VALUES (
        '${ids.matchException}','${ids.company}','${ids.exceptionMatch}',
        'MISSING_INVOICE','OPEN','Supplier invoice has not been received.','${ids.financeOne}'
      );
    `);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("creates the append-only event, portal, receiving, matching, and central transactional email tables", async () => {
    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables WHERE table_schema='public'
    `);
    const names = tables.rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining([
      "workflow_events",
      "in_app_notifications",
      "supplier_rfqs",
      "supplier_rfq_acknowledgements",
      "supplier_quotation_responses",
      "supplier_rfq_documents",
      "delivery_jobs",
      "delivery_job_assignments",
      "delivery_job_events",
      "delivery_evidence",
      "receipts",
      "receipt_lines",
      "three_way_matches",
      "three_way_match_exceptions",
    ]));
    // Contact/security delivery remains separate from the workflow email
    // capability boundary introduced by migration 026.
    expect(names.filter((name) => name.includes("email_outbox")).sort()).toEqual([
      "transactional_email_outbox",
      "workflow_email_outbox",
    ]);
  });

  it("enforces workflow event append-only, tenant, metadata, and idempotency rules", async () => {
    await expect(db.exec(`
      UPDATE workflow_events SET event_key='supplier.rfq.changed'
      WHERE id='${ids.workflowEvent}'
    `)).rejects.toThrow("append-only");
    await expect(db.exec(`
      INSERT INTO workflow_events(
        company_id,aggregate_type,aggregate_id,event_key,event_version,
        actor_user_id,actor_kind,correlation_id,idempotency_key,occurred_at
      ) VALUES (
        '${ids.company}','supplier_rfq','f9000000-0000-4000-8000-000000000001',
        'supplier.rfq.issued',1,'${ids.platform}','PLATFORM',
        'f9000000-0000-4000-8000-000000000002','rfq-issued:foundation-0001',now()
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO workflow_events(
        company_id,aggregate_type,aggregate_id,event_key,event_version,
        actor_user_id,actor_kind,correlation_id,idempotency_key,occurred_at,metadata
      ) VALUES (
        '${ids.company}','supplier_rfq','f9000000-0000-4000-8000-000000000003',
        'supplier.rfq.issued',1,'${ids.platform}','PLATFORM',
        'f9000000-0000-4000-8000-000000000004','rfq-issued:foundation-secret',now(),
        '{"api_token":"must-not-be-stored"}'::jsonb
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO workflow_events(
        company_id,request_id,aggregate_type,aggregate_id,event_key,event_version,
        actor_user_id,actor_kind,correlation_id,idempotency_key,occurred_at
      ) VALUES (
        '10000000-0000-4000-8000-000000000002','${ids.request}',
        'request','${ids.request}','request.changed',1,'${ids.platform}','PLATFORM',
        'f9000000-0000-4000-8000-000000000005','cross-tenant:foundation-0001',now()
      )
    `)).rejects.toThrow();
  });

  it("deduplicates notifications while allowing only monotonic read/archive state", async () => {
    await expect(db.exec(`
      INSERT INTO in_app_notifications(
        company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,title,body
      ) VALUES (
        '${ids.company}','${ids.supplierUser}','${ids.workflowEvent}',
        'supplier.rfq.issued','rfq-notification:foundation-0001','Retry','Retry'
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE in_app_notifications SET title='Changed' WHERE id='${ids.notification}'
    `)).rejects.toThrow("immutable");
    await expect(db.exec(`
      UPDATE in_app_notifications SET read_at=now() WHERE id='${ids.notification}'
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      UPDATE in_app_notifications SET read_at=NULL WHERE id='${ids.notification}'
    `)).rejects.toThrow("monotonic");
  });

  it("keeps supplier competitors invisible and submissions membership-bound", async () => {
    await db.exec(`SET ROLE axora_app`);
    try {
      await db.query("SELECT set_config('axora.user_id',$1,false)", [ids.supplierUser]);
      const visible = await db.query<{ supplier_id: string }>(`
        SELECT supplier_id::text FROM supplier_rfqs ORDER BY supplier_id
      `);
      expect(visible.rows).toEqual([{ supplier_id: ids.supplier }]);
      await expect(db.query(`
        SELECT count(*)::int AS count FROM in_app_notifications
      `)).rejects.toThrow();
      await expect(db.query(`
        INSERT INTO notification_preferences(user_id,event_key,in_app_enabled,email_enabled)
        VALUES ($1,'supplier.rfq.issued',true,false)
      `, [ids.supplierUser])).rejects.toThrow();
      await expect(db.query(`
        INSERT INTO notification_preferences(user_id,event_key)
        VALUES ($1,'supplier.rfq.issued')
      `, [ids.competitorUser])).rejects.toThrow();
      await db.query("SELECT set_config('axora.user_id',$1,false)", [ids.competitorUser]);
      await expect(db.query(`
        SELECT count(*)::int AS count FROM in_app_notifications
      `)).rejects.toThrow();
    } finally {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('axora.user_id','',false)");
    }

    await expect(db.exec(`
      INSERT INTO supplier_rfq_acknowledgements(
        company_id,rfq_id,supplier_id,supplier_membership_id,acknowledged_by,
        acknowledgement,client_event_id,acknowledged_at
      ) VALUES (
        '${ids.company}','${ids.rfq}','${ids.supplier}',
        '${ids.competitorMembership}','${ids.competitorUser}','ACKNOWLEDGED',
        'f8000000-0000-4000-8000-000000000001',now()
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE supplier_quotation_responses SET unit_price=1
      WHERE id='${ids.quotationResponse}'
    `)).rejects.toThrow("append-only");
  });

  it("accepts offline retries once, assigns only drivers, and preserves driver evidence", async () => {
    await expect(db.exec(`
      INSERT INTO delivery_job_events(
        company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at
      ) VALUES (
        '${ids.company}','${ids.job}','${ids.assignment}','${ids.driver}',
        'b7000000-0000-4000-8000-000000000001',
        '${ids.deliveryClientEvent}',2,'DELIVERED',now()
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO delivery_job_events(
        company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at,metadata
      ) VALUES (
        '${ids.company}','${ids.job}','${ids.assignment}','${ids.driver}',
        'b7000000-0000-4000-8000-000000000002',
        'b5000000-0000-4000-8000-000000000002',1,'NOTE_ADDED',now(),
        '{"note":"Customer contact updated"}'::jsonb
      )
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      INSERT INTO delivery_job_events(
        company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at
      ) VALUES (
        '${ids.company}','${ids.job}','${ids.assignment}','${ids.driver}',
        'b7000000-0000-4000-8000-000000000002',
        'b5000000-0000-4000-8000-000000000003',2,'ISSUE_REPORTED',now()
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      INSERT INTO delivery_job_events(
        company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at,metadata
      ) VALUES (
        '${ids.company}','${ids.job}','${ids.assignment}','${ids.driver}',
        'b7000000-0000-4000-8000-000000000002',
        'b5000000-0000-4000-8000-000000000004',3,'PARTIALLY_DELIVERED',now(),
        jsonb_build_object(
          'receiverName','Branch security desk',
          'lineOutcomes',jsonb_build_array(jsonb_build_object(
            'deliveryJobLineId','${ids.jobLine}',
            'deliveredQuantity',8,'damagedQuantity',1,'missingQuantity',2
          ))
        )
      )
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      INSERT INTO delivery_job_assignments(
        company_id,delivery_job_id,driver_user_id,status,assigned_by
      ) VALUES (
        '${ids.company}','${ids.job}','${ids.receiver}','ASSIGNED','${ids.platform}'
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE delivery_evidence SET evidence_type='SIGNATURE'
      WHERE id='${ids.evidence}'
    `)).rejects.toThrow("append-only");

    await db.exec("SET ROLE axora_app");
    try {
      await db.query("SELECT set_config('axora.user_id',$1,false)", [ids.otherDriver]);
      const hidden = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM delivery_jobs
      `);
      expect(hidden.rows[0].count).toBe(0);
    } finally {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('axora.user_id','',false)");
    }
  });

  it("keeps driver proof separate from customer quantities and receipt authority", async () => {
    await expect(db.exec(`
      INSERT INTO receipts(
        company_id,branch_id,delivery_job_id,receipt_reference,status,
        confirmed_by_user_id,client_event_id,received_at
      ) VALUES (
        '${ids.company}','${ids.branch}','${ids.job}','REC-INVALID-DRIVER',
        'ACCEPTED','${ids.driver}','f7000000-0000-4000-8000-000000000001',now()
      )
    `)).rejects.toThrow("customer receiving user");
    await expect(db.exec(`
      INSERT INTO receipt_lines(
        company_id,receipt_id,delivery_job_id,delivery_job_line_id,request_line_id,
        planned_quantity_snapshot,delivered_quantity,accepted_quantity,
        rejected_quantity,damaged_quantity,short_quantity,discrepancy_code
      ) VALUES (
        '${ids.company}','${ids.receipt}','${ids.job}','${ids.jobLine}',
        '${ids.requestLine}',10,10,9,0,0,0,'NONE'
      )
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE receipts SET notes='Changed after confirmation' WHERE id='${ids.receipt}'
    `)).rejects.toThrow("append-only");
    const evidence = await db.query<{ evidence: number; receipts: number }>(`
      SELECT
        (SELECT count(*)::int FROM delivery_evidence WHERE delivery_job_id='${ids.job}') AS evidence,
        (SELECT count(*)::int FROM receipts WHERE delivery_job_id='${ids.job}') AS receipts
    `);
    expect(evidence.rows[0]).toEqual({ evidence: 1, receipts: 1 });
  });

  it("enforces match states, exception lifecycle, and independent finance override", async () => {
    await expect(db.exec(`
      UPDATE three_way_matches SET status='OVERRIDDEN',
        overridden_by_user_id='${ids.financeOne}',overridden_at=now(),
        override_reason='Self approved variance'
      WHERE id='${ids.match}'
    `)).rejects.toThrow();
    await expect(db.exec(`
      UPDATE three_way_matches SET status='OVERRIDDEN',
        overridden_by_user_id='${ids.financeTwo}',overridden_at=now(),
        override_reason='Independent review confirmed an agreed exception'
      WHERE id='${ids.match}'
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      UPDATE three_way_matches SET status='MATCHED' WHERE id='${ids.match}'
    `)).rejects.toThrow("terminal");

    await expect(db.exec(`
      UPDATE three_way_match_exceptions SET status='RESOLVED',
        resolved_by_user_id='${ids.financeTwo}',resolved_at=now(),
        resolution_note='Invoice arrived and was validated.'
      WHERE id='${ids.matchException}'
    `)).resolves.not.toThrow();
    await expect(db.exec(`
      UPDATE three_way_match_exceptions SET detail='Rewritten evidence'
      WHERE id='${ids.matchException}'
    `)).rejects.toThrow("immutable");
  });

  it("grants no update right on append-only portal and evidence tables", async () => {
    const grants = await db.query<{ table_name: string; privilege_type: string }>(`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee='axora_app'
        AND table_name IN (
          'workflow_events','supplier_quotation_responses','delivery_job_events',
          'delivery_evidence','receipts','receipt_lines'
        )
      ORDER BY table_name, privilege_type
    `);
    for (const tableName of [
      "workflow_events",
      "supplier_quotation_responses",
      "delivery_job_events",
      "delivery_evidence",
      "receipts",
      "receipt_lines",
    ]) {
      expect(grants.rows.filter((grant) => grant.table_name === tableName)
        .map((grant) => grant.privilege_type)).not.toContain("UPDATE");
    }
  });
});

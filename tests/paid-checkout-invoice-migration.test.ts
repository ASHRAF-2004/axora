import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("paid checkout and finalized invoice", () => {
  let db: PGlite;
  let requestId: string;
  let actorId: string;
  let assignmentId: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await applyDemoSeed(db);
    const candidate = await db.query<{
      request_id: string; company_id: string; branch_id: string;
    }>(`
      SELECT request.id::text AS request_id,request.company_id::text AS company_id,
        request.branch_id::text AS branch_id
      FROM requests request
      WHERE EXISTS (SELECT 1 FROM request_lines line WHERE line.request_id=request.id)
        AND NOT EXISTS (
          SELECT 1 FROM invoices invoice WHERE invoice.request_id=request.id
            AND invoice.direction='CUSTOMER'
        )
      ORDER BY request.created_at LIMIT 1
    `);
    if (!candidate.rows[0]) throw new Error("A scoped checkout fixture is required");
    requestId = candidate.rows[0].request_id;
    actorId = "76000000-0000-4000-8000-000000000001";
    assignmentId = "76000000-0000-4000-8000-000000000002";
    const otherActorId = "76000000-0000-4000-8000-000000000003";
    const otherAssignmentId = "76000000-0000-4000-8000-000000000004";
    const platformServiceId = "76000000-0000-4000-8000-000000000005";
    const platformAssignmentId = "76000000-0000-4000-8000-000000000006";
    const otherScope = await db.query<{ company_id: string; branch_id: string }>(`
      SELECT company.id::text AS company_id,branch.id::text AS branch_id
      FROM companies company JOIN branches branch ON branch.company_id=company.id
      WHERE company.id<>$1 ORDER BY company.id,branch.id LIMIT 1
    `, [candidate.rows[0].company_id]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) VALUES
        ($1,'checkout-owner@example.test','Checkout owner','not-a-real-hash',
          (SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),$3,$4,false,
          now(),now(),'COMPANY','ACTIVE',true,1),
        ($2,'checkout-other@example.test','Other tenant owner','not-a-real-hash',
          (SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),$5,$6,false,
          now(),now(),'COMPANY','ACTIVE',true,1)
    `, [actorId, otherActorId, candidate.rows[0].company_id,
      candidate.rows[0].branch_id, otherScope.rows[0].company_id,
      otherScope.rows[0].branch_id]);
    await db.query(`
      INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
      VALUES ($1,$3,'ACTIVE',true,now()),($2,$4,'ACTIVE',true,now())
    `, [actorId, otherActorId, candidate.rows[0].company_id,
      otherScope.rows[0].company_id]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      )
      SELECT $1,'checkout-service@example.test','Checkout service',
        'not-a-real-hash',id,false,now(),now(),'PLATFORM','ACTIVE',true,1
      FROM roles WHERE role_key='PLATFORM_OPERATIONS'
    `, [platformServiceId]);
    await db.query(`
      INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
      VALUES ($1,$3,$4,'ACTIVE',true),($2,$5,$6,'ACTIVE',true)
    `, [actorId, otherActorId, candidate.rows[0].company_id,
      candidate.rows[0].branch_id, otherScope.rows[0].company_id,
      otherScope.rows[0].branch_id]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_at
      ) VALUES
        ($1,$3,(SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),
          'BRANCH',$5,$6,true,now()),
        ($2,$4,(SELECT id FROM roles WHERE role_key='BRANCH_ADMIN'),
          'BRANCH',$7,$8,true,now())
    `, [assignmentId, otherAssignmentId, actorId, otherActorId,
      candidate.rows[0].company_id, candidate.rows[0].branch_id,
      otherScope.rows[0].company_id, otherScope.rows[0].branch_id]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,active,assigned_at
      )
      SELECT $1,$2,id,'PLATFORM',true,now()
      FROM roles WHERE role_key='PLATFORM_OPERATIONS'
    `, [platformAssignmentId, platformServiceId]);
    await db.query(`
      UPDATE requests SET approval_state='APPROVED',created_by=$2,
        approval_decided_at=now()
      WHERE id=$1
    `, [requestId, actorId]);
    await db.query(`
      INSERT INTO request_approval_snapshots(
        request_id,request_version,company_id,policy_id,policy_version,
        amount,currency,snapshot,snapshot_hash,created_by
      )
      SELECT request.id,request.request_version,request.company_id,policy.id,
        policy.policy_version,axora_request_total_internal(request.id),request.currency,
        jsonb_build_object('fixture','paid-checkout'),repeat('a',64),$2
      FROM requests request
      JOIN request_approval_policies policy ON policy.id=request.approval_policy_id
      WHERE request.id=$1
    `, [requestId, actorId]);
  }, 30_000);

  afterAll(async () => { await db.close(); });

  it("records paid state and one immutable invoice/job", async () => {
    const checkoutAt = new Date(Date.now() + 1_000);
    const access = await db.query<{ value: Record<string, unknown> | null }>(
      "SELECT axora_request_resource_access($1,$2,'request.submit',$3,now()) AS value",
      [actorId, assignmentId, requestId],
    );
    expect(access.rows[0].value).not.toBeNull();
    const lockedAccess = await db.query<{ value: Record<string, unknown> | null }>(
      "SELECT axora_lock_request_resource_access($1,$2,'request.submit',$3,now()) AS value",
      [actorId, assignmentId, requestId],
    );
    expect(lockedAccess.rows[0].value).not.toBeNull();
    await db.exec("SET ROLE axora_app");
    const first = await db.query<{ value: Record<string, unknown> }>(
      "SELECT axora_complete_payment($1,$2,$3,'OFFLINE',$4,$5) AS value",
      [actorId, assignmentId, requestId, "checkout-test-0001",
        checkoutAt],
    );
    const second = await db.query<{ value: Record<string, unknown> }>(
      "SELECT axora_complete_payment($1,$2,$3,'OFFLINE',$4,$5) AS value",
      [actorId, assignmentId, requestId, "checkout-test-0002",
        new Date(checkoutAt.getTime() + 1_000)],
    );
    expect(first.rows[0].value.paymentStatus).toBe("PAID");
    expect(second.rows[0].value.invoiceId).toBe(first.rows[0].value.invoiceId);
    await db.exec("RESET ROLE");
    const job = await db.query<{
      job_id: string; company_id: string; lease_id: string;
    }>(`
      UPDATE document_generation_jobs SET status='PROCESSING',
        lease_id=gen_random_uuid(),lease_expires_at=$2::timestamptz+interval '180 seconds'
      WHERE request_id=$1 AND document_type='FINAL_INVOICE'
      RETURNING id::text AS job_id,company_id::text,lease_id::text
    `, [requestId, new Date(checkoutAt.getTime() + 10_000)]);
    const completed = job.rows[0];
    await db.exec("SET ROLE axora_app");
    await db.query(`
      SELECT axora_complete_final_invoice_document_job(
        $1,$2,$3,$4,$5,1,2048,$6
      )
    `, [completed.job_id, completed.lease_id, "Axora-Invoice-test.pdf",
      `generated-documents/${completed.company_id}/${requestId}/${completed.job_id}.pdf`,
      "b".repeat(64), new Date(checkoutAt.getTime() + 20_000)]);
    await expect(db.query(`
      SELECT axora_complete_final_invoice_document_job(
        $1,$2,$3,$4,$5,1,2048,$6
      )
    `, [completed.job_id, completed.lease_id, "Axora-Invoice-test.pdf",
      `generated-documents/${completed.company_id}/${requestId}/${completed.job_id}.pdf`,
      "b".repeat(64), new Date(checkoutAt.getTime() + 21_000)])).rejects.toThrow();
    await db.exec("RESET ROLE");
    const state = await db.query<{
      invoices: number; payments: number; jobs: number; documents: number;
      emails: number; events: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM invoices
          WHERE request_id=$1 AND checkout_idempotency_key IS NOT NULL) AS invoices,
        (SELECT count(*)::int FROM payments payment
          JOIN invoices invoice ON invoice.id=payment.invoice_id
          WHERE invoice.request_id=$1) AS payments,
        (SELECT count(*)::int FROM document_generation_jobs
          WHERE request_id=$1 AND document_type='FINAL_INVOICE') AS jobs,
        (SELECT count(*)::int FROM generated_documents
          WHERE request_id=$1 AND document_type='FINAL_INVOICE') AS documents,
        (SELECT count(*)::int FROM transactional_email_outbox outbox
          JOIN invoices invoice ON invoice.id=outbox.invoice_id
          WHERE invoice.request_id=$1 AND outbox.message_kind='INVOICE_FINALIZED') AS emails,
        (SELECT count(*)::int FROM payment_accountability_events
          WHERE request_id=$1) AS events
    `, [requestId]);
    expect(state.rows[0]).toEqual({
      invoices: 1, payments: 1, jobs: 1, documents: 1, emails: 1, events: 5,
    });
    const privileges = await db.query<{
      checkout: boolean; summary: boolean; completeDocument: boolean;
      payload: boolean; evidenceTable: boolean;
    }>(`
      SELECT
        has_function_privilege('axora_app',
          'axora_complete_payment(uuid,uuid,uuid,text,text,timestamptz)','EXECUTE') AS checkout,
        has_function_privilege('axora_app',
          'axora_final_invoice_summary(uuid,uuid,uuid,timestamptz)','EXECUTE') AS summary,
        has_function_privilege('axora_app',
          'axora_complete_final_invoice_document_job(uuid,uuid,text,text,text,integer,bigint,timestamptz)',
          'EXECUTE') AS "completeDocument",
        has_function_privilege('axora_app','axora_invoice_email_payload(uuid)','EXECUTE') AS payload,
        has_table_privilege('axora_app','payment_accountability_events','SELECT') AS "evidenceTable"
    `);
    expect(privileges.rows[0]).toEqual({
      checkout: true, summary: true, completeDocument: true,
      payload: false, evidenceTable: false,
    });
    const billingTerms = await db.query<{ definitions: string }>(`
      SELECT string_agg(pg_get_functiondef(procedure.oid),E'\n') AS definitions
      FROM pg_proc procedure JOIN pg_namespace namespace
        ON namespace.oid=procedure.pronamespace
      WHERE namespace.nspname='public'
        AND procedure.proname IN ('axora_create_company_lead','axora_convert_company_lead')
    `);
    expect(billingTerms.rows[0].definitions).toContain("Standard billing terms");
    expect(billingTerms.rows[0].definitions).not.toContain("Cash on delivery");
  });

  it("keeps delivery independent and denies another tenant", async () => {
    const state = await db.query<{ status: string }>(`
      SELECT lookup.label AS status FROM requests request
      JOIN lookup_values lookup ON lookup.id=request.status_id
      WHERE request.id=$1
    `, [requestId]);
    expect(state.rows[0].status).not.toBe("Delivered");
    const other = await db.query<{ actor_id: string; assignment_id: string }>(`
      SELECT account.id::text AS actor_id,assignment.id::text AS assignment_id
      FROM users account JOIN role_assignments assignment
        ON assignment.user_id=account.id
      WHERE account.account_kind='COMPANY'
        AND assignment.company_id<>(SELECT company_id FROM requests WHERE id=$1)
        AND assignment.active AND assignment.revoked_at IS NULL LIMIT 1
    `, [requestId]);
    await db.exec("SET ROLE axora_app");
    await expect(db.query(
      "SELECT axora_complete_payment($1,$2,$3,'OFFLINE',$4,$5)",
      [other.rows[0].actor_id, other.rows[0].assignment_id, requestId,
        "cross-tenant-0001", new Date()],
    )).rejects.toThrow();
    await db.exec("RESET ROLE");
  });
});

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  worker: "64000000-0000-4000-8000-000000000001",
  operations: "64000000-0000-4000-8000-000000000002",
  operationsAssignment: "64000000-0000-4000-8000-000000000003",
  supplierOneUser: "64000000-0000-4000-8000-000000000004",
  supplierOneAssignment: "64000000-0000-4000-8000-000000000005",
  supplierTwoUser: "64000000-0000-4000-8000-000000000006",
  supplierTwoAssignment: "64000000-0000-4000-8000-000000000007",
  companyAdmin: "64000000-0000-4000-8000-000000000008",
  companyAdminAssignment: "64000000-0000-4000-8000-000000000009",
  otherCompany: "64000000-0000-4000-8000-000000000010",
  otherAdmin: "64000000-0000-4000-8000-000000000011",
  otherAdminAssignment: "64000000-0000-4000-8000-000000000012",
  markReadyCommand: "64000000-0000-4000-8000-000000000013",
  approveCommand: "64000000-0000-4000-8000-000000000014",
  dispatchCommand: "64000000-0000-4000-8000-000000000015",
  resendCommand: "64000000-0000-4000-8000-000000000016",
  acknowledgeCommand: "64000000-0000-4000-8000-000000000017",
  amendCommand: "64000000-0000-4000-8000-000000000018",
  cancelCommand: "64000000-0000-4000-8000-000000000019",
  regenerateCommand: "64000000-0000-4000-8000-000000000020",
};

describe("versioned document and supplier PO behavior", () => {
  it("owns enqueue, access, immutable versions and the complete supplier lifecycle", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);
      const scope = await db.query<{
        request_id: string; company_id: string; request_version: number;
        approval_revision: number; line_one_id: string; supplier_one_id: string;
        line_two_id: string; supplier_two_id: string;
      }>(`
        SELECT request.id AS request_id,request.company_id,
          request.request_version,request.approval_revision,
          selection.line_one_id,selection.supplier_one_id,
          selection.line_two_id,selection.supplier_two_id
        FROM requests request
        JOIN LATERAL (
          SELECT line_one.id AS line_one_id,
            rule_one.supplier_id AS supplier_one_id,
            line_two.id AS line_two_id,
            rule_two.supplier_id AS supplier_two_id
          FROM request_lines line_one
          JOIN product_suppliers rule_one
            ON rule_one.product_id=line_one.product_id AND rule_one.active
          JOIN suppliers supplier_one
            ON supplier_one.id=rule_one.supplier_id
            AND supplier_one.active AND supplier_one.company_id IS NULL
          JOIN request_lines line_two
            ON line_two.request_id=line_one.request_id AND line_two.id<>line_one.id
          JOIN product_suppliers rule_two
            ON rule_two.product_id=line_two.product_id AND rule_two.active
            AND rule_two.supplier_id<>rule_one.supplier_id
          JOIN suppliers supplier_two
            ON supplier_two.id=rule_two.supplier_id
            AND supplier_two.active AND supplier_two.company_id IS NULL
          WHERE line_one.request_id=request.id
            AND rule_one.quantity_rule_effective_from<=now()
            AND (rule_one.quantity_rule_effective_to IS NULL
              OR rule_one.quantity_rule_effective_to>now())
            AND rule_two.quantity_rule_effective_from<=now()
            AND (rule_two.quantity_rule_effective_to IS NULL
              OR rule_two.quantity_rule_effective_to>now())
          ORDER BY line_one.id,line_two.id,rule_one.supplier_id,rule_two.supplier_id
          LIMIT 1
        ) selection ON true
        WHERE NOT EXISTS (SELECT 1 FROM document_generation_jobs job
            WHERE job.request_id=request.id)
        ORDER BY request.created_at,request.id LIMIT 1
      `);
      expect(scope.rows).toHaveLength(1);
      const request = scope.rows[0];
      const supplierOne = { id: request.supplier_one_id };
      const supplierTwo = { id: request.supplier_two_id };

      await db.query(`
        INSERT INTO companies(id,company_code,name,active)
        VALUES ($1,'DOC-OTHER-064','Document isolation company',true)
      `, [ids.otherCompany]);
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,
          is_owner,account_setup_completed_at,account_kind,account_status,
          active,email_verified_at
        )
        SELECT fixture.id,fixture.email,fixture.display_name,'not-a-real-hash',
          role.id,fixture.company_id,false,now(),
          fixture.account_kind,'ACTIVE',true,now()
        FROM (VALUES
          ($1::uuid,'document.operations@example.test','Document operations',
            'PLATFORM_OPERATIONS',NULL::uuid,'PLATFORM'),
          ($2::uuid,'supplier.one.document@example.test','Supplier one contact',
            'SUPPLIER_USER',NULL::uuid,'SUPPLIER'),
          ($3::uuid,'supplier.two.document@example.test','Supplier two contact',
            'SUPPLIER_USER',NULL::uuid,'SUPPLIER'),
          ($4::uuid,'company.document@example.test','Company document administrator',
            'COMPANY_ADMIN',$6::uuid,'COMPANY'),
          ($5::uuid,'other.company.document@example.test','Other company administrator',
            'COMPANY_ADMIN',$7::uuid,'COMPANY')
        ) AS fixture(
          id,email,display_name,role_key,company_id,account_kind
        ) JOIN roles role ON role.role_key=fixture.role_key
      `, [ids.operations, ids.supplierOneUser, ids.supplierTwoUser,
        ids.companyAdmin, ids.otherAdmin, request.company_id, ids.otherCompany]);
      await db.query(`
        INSERT INTO supplier_memberships(user_id,supplier_id,status)
        VALUES ($1,$2,'ACTIVE'),($3,$4,'ACTIVE')
      `, [ids.supplierOneUser, supplierOne.id, ids.supplierTwoUser, supplierTwo.id]);
      await db.query(`
        INSERT INTO company_memberships(user_id,company_id,status,joined_at)
        VALUES ($1,$2,'ACTIVE',now()),($3,$4,'ACTIVE',now())
      `, [ids.companyAdmin, request.company_id, ids.otherAdmin, ids.otherCompany]);
      await db.query(`
        INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
        SELECT $1,$2,id,'PLATFORM',true FROM roles
        WHERE role_key='PLATFORM_OPERATIONS'
      `, [ids.operationsAssignment, ids.operations]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,supplier_id,active
        )
        SELECT fixture.id,fixture.user_id,role.id,fixture.scope_type,
          fixture.company_id,fixture.supplier_id,true
        FROM (VALUES
          ($1::uuid,$2::uuid,'SUPPLIER',NULL::uuid,$7::uuid,'SUPPLIER_USER'),
          ($3::uuid,$4::uuid,'SUPPLIER',NULL::uuid,$8::uuid,'SUPPLIER_USER'),
          ($5::uuid,$6::uuid,'COMPANY',$9::uuid,NULL::uuid,'COMPANY_ADMIN'),
          ($10::uuid,$11::uuid,'COMPANY',$12::uuid,NULL::uuid,'COMPANY_ADMIN')
        ) AS fixture(id,user_id,scope_type,company_id,supplier_id,role_key)
        JOIN roles role ON role.role_key=fixture.role_key
      `, [ids.supplierOneAssignment, ids.supplierOneUser,
        ids.supplierTwoAssignment, ids.supplierTwoUser,
        ids.companyAdminAssignment, ids.companyAdmin,
        supplierOne.id, supplierTwo.id, request.company_id,
        ids.otherAdminAssignment, ids.otherAdmin, ids.otherCompany]);
      await db.query(`
        INSERT INTO quotations(
          request_line_id,supplier_id,quotation_reference,quotation_date,
          unit_price,delivery_charge,minimum_order_quantity,status_id,
          selected,selection_reason
        ) VALUES
          ($1,$2,'DOC-064-ONE',current_date,10,0,1,
            lookup_id('quotation_status','Selected'),true,'Verified supplier split'),
          ($3,$4,'DOC-064-TWO',current_date,12,0,1,
            lookup_id('quotation_status','Selected'),true,'Verified supplier split')
      `, [request.line_one_id, supplierOne.id, request.line_two_id, supplierTwo.id]);
      await db.query(`
        UPDATE request_lines
        SET selected_supplier_id=CASE id
          WHEN $1::uuid THEN $2::uuid ELSE $4::uuid END
        WHERE id IN ($1::uuid,$3::uuid)
      `, [request.line_one_id, supplierOne.id, request.line_two_id, supplierTwo.id]);
      await db.query(`
        UPDATE requests SET approval_state='APPROVED',
          approval_revision=greatest(approval_revision,1)
        WHERE id=$1
      `, [request.request_id]);
      const approved = await db.query<{ request_version: number; approval_revision: number }>(`
        SELECT request_version,approval_revision FROM requests WHERE id=$1
      `, [request.request_id]);
      const version = approved.rows[0];

      for (const suffix of ["one", "duplicate"]) {
        await db.query(`
          INSERT INTO request_approval_outbox(
            request_id,request_version,approval_revision,company_id,job_type,
            payload,idempotency_key,available_at
          ) VALUES ($1,$2,$3,$4,'REQUEST_PDF','{}'::jsonb,$5,now())
        `, [request.request_id, version.request_version, version.approval_revision,
          request.company_id, `document-behavior-${suffix}`]);
      }

      const queued = await db.query<{
        document_type: string; supplier_id: string | null; input_snapshot: Record<string, unknown>;
      }>(`
        SELECT document_type,supplier_id,input_snapshot
        FROM document_generation_jobs WHERE request_id=$1
        ORDER BY document_type,supplier_id NULLS FIRST
      `, [request.request_id]);
      const enqueueFailures = await db.query<{
        error_code: string; error_summary: string;
      }>(`
        SELECT error_code,error_summary FROM document_enqueue_failures
        WHERE request_id=$1 ORDER BY created_at,id
      `, [request.request_id]);
      expect(enqueueFailures.rows).toEqual([]);
      expect(queued.rows).toHaveLength(3);
      expect(queued.rows.filter((row) => row.document_type === "APPROVED_REQUEST")).toHaveLength(1);
      const supplierJobs = queued.rows.filter((row) => row.document_type === "SUPPLIER_PURCHASE_ORDER");
      expect(supplierJobs.map((row) => row.supplier_id).sort()).toEqual(
        [supplierOne.id, supplierTwo.id].sort(),
      );
      expect(supplierJobs.map((row) => ({
        supplierId: row.supplier_id,
        warnings: row.input_snapshot.warnings,
        lineCount: (row.input_snapshot.lines as unknown[]).length,
      })).sort((left, right) => String(left.supplierId).localeCompare(String(right.supplierId))))
        .toEqual([supplierOne.id, supplierTwo.id].sort().map((supplierId) => ({
          supplierId, warnings: [], lineCount: 1,
        })));

      await db.query("SELECT set_config('axora.system_identity','document-worker',false)");
      const completeNextJob = async () => {
        const claimed = await db.query<{
          job_id: string; lease_id: string; company_id: string;
          request_id: string; document_type: string;
        }>(`
          SELECT job_id,lease_id,company_id,request_id,document_type
          FROM axora_claim_document_generation_job($1,180,now())
        `, [ids.worker]);
        expect(claimed.rows).toHaveLength(1);
        const job = claimed.rows[0];
        await db.query(`
          SELECT axora_complete_document_generation_job(
            $1,$2,$3,$4,$5,2,2048,now()
          )
        `, [job.job_id, job.lease_id, `${job.document_type.toLowerCase()}.pdf`,
          `generated-documents/${job.company_id}/${job.request_id}/${job.job_id}.pdf`,
          "a".repeat(64)]);
        return job;
      };
      await completeNextJob();
      await completeNextJob();
      await completeNextJob();

      const documents = await db.query<{
        id: string; document_type: string; supplier_id: string | null;
        document_version: number; lifecycle_status: string;
      }>(`
        SELECT id,document_type,supplier_id,document_version,lifecycle_status
        FROM generated_documents WHERE request_id=$1
        ORDER BY document_type,supplier_id NULLS FIRST,document_version
      `, [request.request_id]);
      expect(documents.rows).toHaveLength(3);
      const approvedDocument = documents.rows.find((row) => row.document_type === "APPROVED_REQUEST")!;
      const supplierOneDocument = documents.rows.find((row) => row.supplier_id === supplierOne.id)!;

      const access = async (userId: string, assignmentId: string, documentId: string) => {
        const result = await db.query<{ allowed: boolean }>(`
          SELECT EXISTS(
            SELECT 1 FROM axora_generated_document_download($1,$2,$3,now())
          ) AS allowed
        `, [userId, assignmentId, documentId]);
        return result.rows[0].allowed;
      };
      expect(await access(ids.companyAdmin, ids.companyAdminAssignment, approvedDocument.id)).toBe(true);
      expect(await access(ids.otherAdmin, ids.otherAdminAssignment, approvedDocument.id)).toBe(false);
      expect(await access(ids.supplierOneUser, ids.supplierOneAssignment, supplierOneDocument.id)).toBe(false);

      const regenerate = async () => db.query<{ value: { jobId: string; status: string } }>(`
        SELECT axora_request_document_regeneration(
          $1,$2,$3,1,'REGENERATE','Verified regeneration',$4,now()
        ) AS value
      `, [ids.companyAdmin, ids.companyAdminAssignment, approvedDocument.id, ids.regenerateCommand]);
      const regeneration = await regenerate();
      expect((await regenerate()).rows[0].value.jobId).toBe(regeneration.rows[0].value.jobId);
      await completeNextJob();
      expect((await regenerate()).rows[0].value).toMatchObject({
        jobId: regeneration.rows[0].value.jobId,
        status: "COMPLETED",
      });

      const manage = async (
        userId: string, assignmentId: string, documentId: string,
        expectedVersion: number, operation: string, recipientUserId: string | null,
        reason: string, commandId: string,
      ) => {
        const result = await db.query<{ value: { state: string; version: number; jobId?: string } }>(`
          SELECT axora_manage_supplier_purchase_order(
            $1,$2,$3,$4,$5,$6,$7,$8,now()
          ) AS value
        `, [userId, assignmentId, documentId, expectedVersion, operation,
          recipientUserId, reason, commandId]);
        return result.rows[0].value;
      };

      expect(await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 1,
        "MARK_READY", null, "Sales review", ids.markReadyCommand,
      )).toMatchObject({ state: "READY_FOR_SALES_REVIEW", version: 2 });
      expect(await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 1,
        "MARK_READY", null, "Sales review", ids.markReadyCommand,
      )).toMatchObject({ state: "READY_FOR_SALES_REVIEW", version: 2 });
      expect(await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 2,
        "APPROVE", ids.supplierOneUser, "Verified contact", ids.approveCommand,
      )).toMatchObject({ state: "APPROVED_FOR_DISPATCH", version: 3 });
      expect(await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 3,
        "DISPATCH", null, "Secure dispatch", ids.dispatchCommand,
      )).toMatchObject({ state: "DISPATCHED_TO_SUPPLIER", version: 4 });
      expect(await access(ids.supplierOneUser, ids.supplierOneAssignment, supplierOneDocument.id)).toBe(true);
      expect(await access(ids.supplierTwoUser, ids.supplierTwoAssignment, supplierOneDocument.id)).toBe(false);

      await db.query("UPDATE users SET active=false WHERE id=$1", [ids.supplierOneUser]);
      await expect(manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 4,
        "RESEND", null, "Retry dispatch", ids.resendCommand,
      )).rejects.toThrow(/verified supplier contact/i);
      await db.query("UPDATE users SET active=true WHERE id=$1", [ids.supplierOneUser]);
      expect(await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 4,
        "RESEND", null, "Retry dispatch", ids.resendCommand,
      )).toMatchObject({ state: "DISPATCHED_TO_SUPPLIER", version: 5 });
      expect(await manage(
        ids.supplierOneUser, ids.supplierOneAssignment, supplierOneDocument.id, 5,
        "ACKNOWLEDGE", null, "Supplier received", ids.acknowledgeCommand,
      )).toMatchObject({ state: "ACKNOWLEDGED", version: 6 });
      const amended = await manage(
        ids.operations, ids.operationsAssignment, supplierOneDocument.id, 6,
        "AMEND", null, "Quantity correction", ids.amendCommand,
      );
      expect(amended).toMatchObject({ state: "AMENDED", version: 7 });
      expect(amended.jobId).toBeTruthy();
      await completeNextJob();

      const replacement = await db.query<{ id: string; document_version: number }>(`
        SELECT id,document_version FROM generated_documents
        WHERE request_id=$1 AND supplier_id=$2
        ORDER BY document_version DESC LIMIT 1
      `, [request.request_id, supplierOne.id]);
      expect(replacement.rows[0].document_version).toBe(2);
      expect(await manage(
        ids.operations, ids.operationsAssignment, replacement.rows[0].id, 1,
        "CANCEL", null, "Supplier order cancelled", ids.cancelCommand,
      )).toMatchObject({ state: "CANCELLED", version: 2 });

      const history = await db.query<{
        generated_versions: number; current_versions: number;
        po_events: number; duplicate_commands: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM generated_documents
            WHERE request_id=$1) AS generated_versions,
          (SELECT count(*)::int FROM generated_documents
            WHERE request_id=$1 AND lifecycle_status='CURRENT') AS current_versions,
          (SELECT count(*)::int FROM supplier_purchase_order_events event
            JOIN supplier_purchase_order_workflows workflow ON workflow.id=event.workflow_id
            WHERE workflow.request_id=$1) AS po_events,
          (SELECT count(*)::int FROM supplier_purchase_order_events
            WHERE command_id=$2) AS duplicate_commands
      `, [request.request_id, ids.markReadyCommand]);
      expect(history.rows[0]).toMatchObject({
        generated_versions: 5,
        current_versions: 2,
        po_events: 10,
        duplicate_commands: 1,
      });
      await expect(db.query(`
        UPDATE generated_documents SET checksum_sha256=$1 WHERE id=$2
      `, ["b".repeat(64), approvedDocument.id])).rejects.toThrow(/immutable/i);
    } finally {
      await db.close();
    }
  }, 45_000);
});

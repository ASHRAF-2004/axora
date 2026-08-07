import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const migrationUrl = new URL(
  "../database/migrations/046_document_resource_isolation.sql",
  import.meta.url,
);
const grantsUrl = new URL(
  "../database/admin/apply-app-grants.sql",
  import.meta.url,
);

const ids = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  branchA: "20000000-0000-4000-8000-000000000001",
  branchB: "20000000-0000-4000-8000-000000000002",
  requestA: "50000000-0000-4000-8000-000000000001",
  requestB: "50000000-0000-4000-8000-000000000006",
  requestLineA: "60000000-0000-4000-8000-000000000001",
  supplierA: "30000000-0000-4000-8000-000000000001",
  customerInvoice: "a0460000-0000-4000-8000-000000000001",
  supplierInvoice: "a0460000-0000-4000-8000-000000000002",
  deliveryA: "a0460000-0000-4000-8000-000000000003",
  platformOperations: "b0460000-0000-4000-8000-000000000001",
  companyAdmin: "b0460000-0000-4000-8000-000000000002",
  branchAdmin: "b0460000-0000-4000-8000-000000000003",
  platformAssignment: "c0460000-0000-4000-8000-000000000001",
  companyAssignment: "c0460000-0000-4000-8000-000000000002",
  branchAssignment: "c0460000-0000-4000-8000-000000000003",
  requestCustomer: "d0460000-0000-4000-8000-000000000001",
  requestInternal: "d0460000-0000-4000-8000-000000000002",
  customerInvoiceDocument: "d0460000-0000-4000-8000-000000000003",
  supplierInvoiceDocument: "d0460000-0000-4000-8000-000000000004",
  deliveryDocument: "d0460000-0000-4000-8000-000000000005",
  otherTenantDocument: "d0460000-0000-4000-8000-000000000006",
  unresolvedDocument: "d0460000-0000-4000-8000-000000000007",
} as const;

interface RoleIds {
  platformOperations: string;
  companyAdmin: string;
  branchAdmin: string;
}

async function applyApplicationGrantScript(db: PGlite) {
  const source = await readFile(grantsUrl, "utf8");
  const executable = source
    .split("\n")
    .filter((line) => (
      !line.trimStart().startsWith("\\")
      && !line.startsWith("SELECT format('GRANT CONNECT ON DATABASE")
    ))
    .join("\n");
  await db.exec(executable);
  return source;
}

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db, {
    through: "045_request_resource_isolation.sql",
  });
  await applyDemoSeed(db);

  const roleResult = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER')
        AS "platformOperations",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdmin",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_ADMIN')
        AS "branchAdmin"
  `);
  const roles = roleResult.rows[0];
  if (!roles?.platformOperations || !roles.companyAdmin || !roles.branchAdmin) {
    throw new Error("Document isolation fixture roles are unavailable");
  }

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'platform-documents-046@example.test','Platform documents 046',
        'not-a-real-hash',$4,NULL,NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'company-documents-046@example.test','Company documents 046',
        'not-a-real-hash',$5,$7,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'branch-documents-046@example.test','Branch documents 046',
        'not-a-real-hash',$6,$7,$8,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.platformOperations,
    ids.companyAdmin,
    ids.branchAdmin,
    roles.platformOperations,
    roles.companyAdmin,
    roles.branchAdmin,
    ids.companyA,
    ids.branchA,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$3,'ACTIVE',true,now()),
      ($2,$3,'ACTIVE',true,now())
  `, [ids.companyAdmin, ids.branchAdmin, ids.companyA]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary,created_by
    ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
  `, [ids.branchAdmin, ids.companyA, ids.branchA, ids.platformOperations]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,
      active,assigned_by,assigned_at
    ) VALUES
      ($1,$4,$7,'PLATFORM',NULL,NULL,true,$4,now()),
      ($2,$5,$8,'COMPANY',$10,NULL,true,$4,now()),
      ($3,$6,$9,'BRANCH',$10,$11,true,$4,now())
  `, [
    ids.platformAssignment,
    ids.companyAssignment,
    ids.branchAssignment,
    ids.platformOperations,
    ids.companyAdmin,
    ids.branchAdmin,
    roles.platformOperations,
    roles.companyAdmin,
    roles.branchAdmin,
    ids.companyA,
    ids.branchA,
  ]);

  await db.exec("ALTER TABLE invoices DISABLE TRIGGER USER");
  await db.query(`
    INSERT INTO invoices(
      id,direction,request_id,company_id,supplier_id,invoice_number,
      invoice_date,due_date,amount,status_id
    ) VALUES
      ($1,'CUSTOMER',$3,$4,NULL,'CUST-046','2026-08-07',
        '2026-08-14',120,lookup_id('invoice_status','Issued')),
      ($2,'SUPPLIER',$3,NULL,$5,'SUP-046','2026-08-07',
        '2026-08-14',80,lookup_id('invoice_status','Issued'))
  `, [
    ids.customerInvoice,
    ids.supplierInvoice,
    ids.requestA,
    ids.companyA,
    ids.supplierA,
  ]);
  await db.exec("ALTER TABLE invoices ENABLE TRIGGER USER");

  await db.exec("ALTER TABLE deliveries DISABLE TRIGGER USER");
  await db.query(`
    INSERT INTO deliveries(
      id,request_line_id,expected_date,status_id,quantity_received
    ) VALUES (
      $1,$2,'2026-08-12',lookup_id('delivery_status','Scheduled'),0
    )
  `, [ids.deliveryA, ids.requestLineA]);
  await db.exec("ALTER TABLE deliveries ENABLE TRIGGER USER");

  const pdf = Buffer.from("%PDF-1.4\n%%EOF", "utf8");
  await db.query(`
    INSERT INTO attachments(
      id,entity_type,record_id,file_name,content_type,storage_path,
      uploaded_by,company_id,file_content,visibility
    ) VALUES
      ($1,'request',$8,'request.pdf','application/pdf','legacy/request.pdf',
        $15,$10,$16,'CUSTOMER'),
      ($2,'request',$8,'internal.pdf','application/pdf','legacy/internal.pdf',
        $15,$9,$16,'INTERNAL'),
      ($3,'invoice',$11,'customer-invoice.pdf','application/pdf',
        'legacy/customer-invoice.pdf',$15,$9,$16,'CUSTOMER'),
      ($4,'invoice',$12,'supplier-invoice.pdf','application/pdf',
        'legacy/supplier-invoice.pdf',$15,$9,$16,'CUSTOMER'),
      ($5,'delivery',$13,'delivery.pdf','application/pdf',
        'legacy/delivery.pdf',$15,$9,$16,'CUSTOMER'),
      ($6,'request',$14,'other-tenant.pdf','application/pdf',
        'legacy/other-tenant.pdf',$15,$10,$16,'CUSTOMER'),
      ($7,'supplier',$17,'unresolved.pdf','application/pdf',
        'legacy/unresolved.pdf',$15,$9,$16,'CUSTOMER')
  `, [
    ids.requestCustomer,
    ids.requestInternal,
    ids.customerInvoiceDocument,
    ids.supplierInvoiceDocument,
    ids.deliveryDocument,
    ids.otherTenantDocument,
    ids.unresolvedDocument,
    ids.requestA,
    ids.companyA,
    ids.companyB,
    ids.customerInvoice,
    ids.supplierInvoice,
    ids.deliveryA,
    ids.requestB,
    ids.platformOperations,
    pdf,
    ids.supplierA,
  ]);

  await db.exec(await readFile(migrationUrl, "utf8"));
  return db;
}

async function attachmentIds(
  db: PGlite,
  actorId: string,
  assignmentId: string,
) {
  const result = await db.query<{ id: string }>(`
    SELECT attachment_id::text AS id
    FROM axora_attachment_access_rows($1,$2,now())
    ORDER BY attachment_id
  `, [actorId, assignmentId]);
  return result.rows.map((row) => row.id);
}

describe("document resource isolation migration", () => {
  it("backfills trusted parents, repairs tenant ownership, and preserves unresolved history", async () => {
    const db = await fixture();
    try {
      const result = await db.query<{
        id: string;
        requestId: string | null;
        companyId: string;
        visibility: string;
      }>(`
        SELECT id::text,request_id::text AS "requestId",
          company_id::text AS "companyId",visibility
        FROM attachments ORDER BY id
      `);
      expect(result.rows).toEqual([
        {
          id: ids.requestCustomer,
          requestId: ids.requestA,
          companyId: ids.companyA,
          visibility: "CUSTOMER",
        },
        {
          id: ids.requestInternal,
          requestId: ids.requestA,
          companyId: ids.companyA,
          visibility: "INTERNAL",
        },
        {
          id: ids.customerInvoiceDocument,
          requestId: ids.requestA,
          companyId: ids.companyA,
          visibility: "CUSTOMER",
        },
        {
          id: ids.supplierInvoiceDocument,
          requestId: ids.requestA,
          companyId: ids.companyA,
          visibility: "INTERNAL",
        },
        {
          id: ids.deliveryDocument,
          requestId: ids.requestA,
          companyId: ids.companyA,
          visibility: "CUSTOMER",
        },
        {
          id: ids.otherTenantDocument,
          requestId: ids.requestB,
          companyId: ids.companyB,
          visibility: "CUSTOMER",
        },
        {
          id: ids.unresolvedDocument,
          requestId: null,
          companyId: ids.companyA,
          visibility: "CUSTOMER",
        },
      ]);

      await expect(db.query(`
        INSERT INTO attachments(
          entity_type,record_id,file_name,content_type,storage_path,
          uploaded_by,company_id,file_content,visibility
        ) VALUES (
          'supplier',$1,'bad.pdf','application/pdf','bad.pdf',$2,$3,
          convert_to('%PDF-1.4\n%%EOF','UTF8'),'CUSTOMER'
        )
      `, [ids.supplierA, ids.platformOperations, ids.companyA]))
        .rejects.toThrow("linked document record is unavailable");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("filters metadata by live assignment, tenant, branch, entity permission, and visibility", async () => {
    const db = await fixture();
    try {
      expect(await attachmentIds(
        db,
        ids.platformOperations,
        ids.platformAssignment,
      )).toEqual([
        ids.requestCustomer,
        ids.requestInternal,
        ids.customerInvoiceDocument,
        ids.supplierInvoiceDocument,
        ids.deliveryDocument,
        ids.otherTenantDocument,
      ].sort());

      expect(await attachmentIds(
        db,
        ids.companyAdmin,
        ids.companyAssignment,
      )).toEqual([
        ids.requestCustomer,
        ids.customerInvoiceDocument,
        ids.deliveryDocument,
      ].sort());

      expect(await attachmentIds(
        db,
        ids.branchAdmin,
        ids.branchAssignment,
      )).toEqual([
        ids.requestCustomer,
        ids.customerInvoiceDocument,
        ids.deliveryDocument,
      ].sort());

      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$1,
          revoke_reason='Document access test revocation'
        WHERE id=$2
      `, [ids.platformOperations, ids.branchAssignment]);
      expect(await attachmentIds(
        db,
        ids.branchAdmin,
        ids.branchAssignment,
      )).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("downloads bytes without revealing missing, internal, sibling-tenant, or malformed identifiers", async () => {
    const db = await fixture();
    try {
      const allowed = await db.query<{ id: string; byteLength: number }>(`
        SELECT attachment_id::text AS id,
          octet_length(file_content)::int AS "byteLength"
        FROM axora_attachment_download($1,$2,$3,now())
      `, [ids.companyAdmin, ids.companyAssignment, ids.requestCustomer]);
      expect(allowed.rows).toEqual([{
        id: ids.requestCustomer,
        byteLength: Buffer.byteLength("%PDF-1.4\n%%EOF"),
      }]);

      for (const attachmentId of [
        ids.requestInternal,
        ids.otherTenantDocument,
        "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ]) {
        const denied = await db.query(`
          SELECT * FROM axora_attachment_download($1,$2,$3,now())
        `, [ids.companyAdmin, ids.companyAssignment, attachmentId]);
        expect(denied.rows).toEqual([]);
      }

      const platform = await db.query<{ id: string }>(`
        SELECT attachment_id::text AS id
        FROM axora_attachment_download($1,$2,$3,now())
      `, [
        ids.platformOperations,
        ids.platformAssignment,
        ids.supplierInvoiceDocument,
      ]);
      expect(platform.rows).toEqual([{ id: ids.supplierInvoiceDocument }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("creates only canonical documents, downgrades company internal requests, and audits without file bytes", async () => {
    const db = await fixture();
    try {
      await db.exec("SET ROLE axora_app");
      await db.query("SELECT set_config('axora.user_id',$1,false)", [ids.companyAdmin]);
      const companyCreated = await db.query<{
        id: string;
        visibility: string;
      }>(`
        SELECT attachment_id::text AS id,visibility
        FROM axora_create_attachment(
          $1,$2,'request',$3,'company.txt','text/plain',
          convert_to('company document','UTF8'),'INTERNAL',now()
        )
      `, [ids.companyAdmin, ids.companyAssignment, ids.requestA]);
      expect(companyCreated.rows).toHaveLength(1);
      expect(companyCreated.rows[0].visibility).toBe("CUSTOMER");
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('axora.user_id','',false)");

      await db.exec("SET ROLE axora_app");
      await db.query("SELECT set_config('axora.user_id',$1,false)", [ids.platformOperations]);
      const supplierCreated = await db.query<{
        id: string;
        visibility: string;
      }>(`
        SELECT attachment_id::text AS id,visibility
        FROM axora_create_attachment(
          $1,$2,'invoice',$3,'supplier.txt','text/plain',
          convert_to('supplier document','UTF8'),'CUSTOMER',now()
        )
      `, [
        ids.platformOperations,
        ids.platformAssignment,
        ids.supplierInvoice,
      ]);
      expect(supplierCreated.rows).toHaveLength(1);
      expect(supplierCreated.rows[0].visibility).toBe("INTERNAL");
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('axora.user_id','',false)");

      await db.exec("SET ROLE axora_app");
      const denied = await db.query(`
        SELECT * FROM axora_create_attachment(
          $1,$2,'request',$3,'other.txt','text/plain',
          convert_to('other tenant','UTF8'),'CUSTOMER',now()
        )
      `, [ids.branchAdmin, ids.branchAssignment, ids.requestB]);
      expect(denied.rows).toEqual([]);
      await expect(db.query(`
        INSERT INTO attachments(
          entity_type,record_id,file_name,content_type,storage_path,
          uploaded_by,company_id,file_content,visibility
        ) VALUES (
          'request',$1,'forged.txt','text/plain','forged.txt',$2,$3,
          convert_to('forged','UTF8'),'CUSTOMER'
        )
      `, [ids.requestA, ids.branchAdmin, ids.companyA])).rejects.toThrow();
      await db.exec("RESET ROLE");

      const audit = await db.query<{ leaked: number; created: number }>(`
        SELECT
          count(*) FILTER (
            WHERE COALESCE(new_values,'{}'::jsonb) ? 'file_content'
          )::int AS leaked,
          count(*) FILTER (
            WHERE record_id IN ($1,$2)
          )::int AS created
        FROM audit_logs
        WHERE entity_type='attachments'
      `, [companyCreated.rows[0].id, supplierCreated.rows[0].id]);
      expect(audit.rows[0]).toEqual({ leaked: 0, created: 2 });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps raw attachment state private after real grant reapplication", async () => {
    const db = await fixture();
    try {
      const source = await applyApplicationGrantScript(db);
      expect(source).toContain("public.axora_attachment_access_rows(");
      expect(source).toContain("REVOKE ALL ON TABLE public.attachments");

      const privileges = await db.query<{
        tableSelect: boolean;
        tableInsert: boolean;
        tableUpdate: boolean;
        accessRows: boolean;
        download: boolean;
        createAttachment: boolean;
        resolver: boolean;
        validator: boolean;
        permissionHelper: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','attachments','SELECT')
            AS "tableSelect",
          has_table_privilege('axora_app','attachments','INSERT')
            AS "tableInsert",
          has_table_privilege('axora_app','attachments','UPDATE')
            AS "tableUpdate",
          has_function_privilege(
            'axora_app',
            'axora_attachment_access_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "accessRows",
          has_function_privilege(
            'axora_app',
            'axora_attachment_download(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS download,
          has_function_privilege(
            'axora_app',
            'axora_create_attachment(uuid,uuid,text,uuid,text,text,bytea,text,timestamptz)',
            'EXECUTE'
          ) AS "createAttachment",
          has_function_privilege(
            'axora_app','axora_resolve_attachment_parent(text,uuid)','EXECUTE'
          ) AS resolver,
          has_function_privilege(
            'axora_app','axora_validate_attachment_parent()','EXECUTE'
          ) AS validator,
          has_function_privilege(
            'axora_app',
            'axora_attachment_permission_is_effective(jsonb,uuid,text,text,text,uuid,uuid,uuid,uuid,text)',
            'EXECUTE'
          ) AS "permissionHelper"
      `);
      expect(privileges.rows[0]).toEqual({
        tableSelect: false,
        tableInsert: false,
        tableUpdate: false,
        accessRows: true,
        download: true,
        createAttachment: true,
        resolver: false,
        validator: false,
        permissionHelper: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});
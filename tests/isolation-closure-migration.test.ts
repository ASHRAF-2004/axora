import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  branchA: "20000000-0000-4000-8000-000000000001",
  branchB: "20000000-0000-4000-8000-000000000002",
  requestA: "50000000-0000-4000-8000-000000000001",
  requestB: "50000000-0000-4000-8000-000000000006",
  departmentA: "a0470000-0000-4000-8000-000000000001",
  owner: "b0470000-0000-4000-8000-000000000001",
  companyAdminA: "b0470000-0000-4000-8000-000000000002",
  branchAdminA: "b0470000-0000-4000-8000-000000000003",
  departmentAdminA: "b0470000-0000-4000-8000-000000000004",
  requesterA: "b0470000-0000-4000-8000-000000000005",
  companyAdminB: "b0470000-0000-4000-8000-000000000006",
  ownerAssignment: "c0470000-0000-4000-8000-000000000001",
  companyAssignmentA: "c0470000-0000-4000-8000-000000000002",
  branchAssignmentA: "c0470000-0000-4000-8000-000000000003",
  departmentAssignmentA: "c0470000-0000-4000-8000-000000000004",
  requesterAssignmentA: "c0470000-0000-4000-8000-000000000005",
  companyAssignmentB: "c0470000-0000-4000-8000-000000000006",
  quotation: "d0470000-0000-4000-8000-000000000001",
  invoice: "d0470000-0000-4000-8000-000000000002",
} as const;

interface RoleIds {
  owner: string;
  companyAdmin: string;
  branchAdmin: string;
  departmentAdmin: string;
  requester: string;
}

interface FixtureIds {
  lineA: string;
  lineB: string;
  supplier: string;
}

interface SnapshotRow {
  snapshot: Record<string, unknown> | null;
}

async function fixture(createAppRole = false) {
  const db = new PGlite();
  if (createAppRole) await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await applyDemoSeed(db);

  const rolesResult = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdmin",
      (SELECT id::text FROM roles WHERE role_key='BRANCH_ADMIN')
        AS "branchAdmin",
      (SELECT id::text FROM roles WHERE role_key='DEPARTMENT_ADMIN')
        AS "departmentAdmin",
      (SELECT id::text FROM roles WHERE role_key='REQUESTER') AS requester
  `);
  const roles = rolesResult.rows[0];
  if (!roles?.owner || !roles.companyAdmin || !roles.branchAdmin
    || !roles.departmentAdmin || !roles.requester) {
    throw new Error("Isolation closure roles are unavailable");
  }

  const resources = await db.query<FixtureIds>(`
    SELECT
      (SELECT id::text FROM request_lines WHERE request_id=$1
       ORDER BY request_line_code LIMIT 1) AS "lineA",
      (SELECT id::text FROM request_lines WHERE request_id=$2
       ORDER BY request_line_code LIMIT 1) AS "lineB",
      (SELECT id::text FROM suppliers WHERE company_id IS NULL AND active
       ORDER BY supplier_code LIMIT 1) AS supplier
  `, [ids.requestA, ids.requestB]);
  const resource = resources.rows[0];
  if (!resource?.lineA || !resource.lineB || !resource.supplier) {
    throw new Error("Isolation closure resources are unavailable");
  }

  await db.query(`
    INSERT INTO departments(
      id,company_id,branch_id,department_code,name,active
    ) VALUES ($1,$2,$3,'OPS-047','Operations 047',true)
  `, [ids.departmentA, ids.companyA, ids.branchA]);
  await db.query(`
    UPDATE requests SET department_id=$2,department='Operations 047'
    WHERE id=$1
  `, [ids.requestA, ids.departmentA]);

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'owner-047@example.test','Owner 047','not-a-real-hash',$7,
        NULL,NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'company-a-047@example.test','Company A admin 047',
        'not-a-real-hash',$8,$12,NULL,false,now(),'COMPANY','ACTIVE',true,1),
      ($3,'branch-a-047@example.test','Branch A admin 047',
        'not-a-real-hash',$9,$12,$13,false,now(),'COMPANY','ACTIVE',true,1),
      ($4,'department-a-047@example.test','Department A admin 047',
        'not-a-real-hash',$10,$12,$13,false,now(),'COMPANY','ACTIVE',true,1),
      ($5,'requester-a-047@example.test','Requester A 047',
        'not-a-real-hash',$11,$12,$13,false,now(),'COMPANY','ACTIVE',true,1),
      ($6,'company-b-047@example.test','Company B admin 047',
        'not-a-real-hash',$8,$14,NULL,false,now(),'COMPANY','ACTIVE',true,1)
  `, [
    ids.owner,
    ids.companyAdminA,
    ids.branchAdminA,
    ids.departmentAdminA,
    ids.requesterA,
    ids.companyAdminB,
    roles.owner,
    roles.companyAdmin,
    roles.branchAdmin,
    roles.departmentAdmin,
    roles.requester,
    ids.companyA,
    ids.branchA,
    ids.companyB,
  ]);

  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES
      ($1,$6,'ACTIVE',true,now()),
      ($2,$6,'ACTIVE',true,now()),
      ($3,$6,'ACTIVE',true,now()),
      ($4,$6,'ACTIVE',true,now()),
      ($5,$7,'ACTIVE',true,now())
  `, [
    ids.companyAdminA,
    ids.branchAdminA,
    ids.departmentAdminA,
    ids.requesterA,
    ids.companyAdminB,
    ids.companyA,
    ids.companyB,
  ]);
  await db.query(`
    INSERT INTO branch_assignments(
      user_id,company_id,branch_id,status,is_primary,created_by
    ) VALUES ($1,$3,$4,'ACTIVE',true,$5)
  `, [ids.branchAdminA, ids.requesterA, ids.companyA, ids.branchA, ids.owner]);
  await db.query(`
    INSERT INTO department_assignments(
      user_id,company_id,department_id,status,is_primary,assigned_by
    ) VALUES
      ($1,$3,$4,'ACTIVE',true,$5),
      ($2,$3,$4,'ACTIVE',true,$5)
  `, [
    ids.departmentAdminA,
    ids.requesterA,
    ids.companyA,
    ids.departmentA,
    ids.owner,
  ]);

  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,department_id,
      supplier_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$7,$13,'PLATFORM',NULL,NULL,NULL,NULL,true,$7,now()),
      ($2,$8,$14,'COMPANY',$18,NULL,NULL,NULL,true,$7,now()),
      ($3,$9,$15,'BRANCH',$18,$19,NULL,NULL,true,$7,now()),
      ($4,$10,$16,'DEPARTMENT',$18,$19,$20,NULL,true,$7,now()),
      ($5,$11,$17,'DEPARTMENT',$18,$19,$20,NULL,true,$7,now()),
      ($6,$12,$14,'COMPANY',$21,NULL,NULL,NULL,true,$7,now())
  `, [
    ids.ownerAssignment,
    ids.companyAssignmentA,
    ids.branchAssignmentA,
    ids.departmentAssignmentA,
    ids.requesterAssignmentA,
    ids.companyAssignmentB,
    ids.owner,
    ids.companyAdminA,
    ids.branchAdminA,
    ids.departmentAdminA,
    ids.requesterA,
    ids.companyAdminB,
    roles.owner,
    roles.companyAdmin,
    roles.branchAdmin,
    roles.departmentAdmin,
    roles.requester,
    ids.companyA,
    ids.branchA,
    ids.departmentA,
    ids.companyB,
  ]);

  await db.query(`
    UPDATE requests SET created_by=$2 WHERE id=$1
  `, [ids.requestA, ids.requesterA]);

  await db.exec("ALTER TABLE quotations DISABLE TRIGGER USER");
  await db.query(`
    INSERT INTO quotations(
      id,request_line_id,supplier_id,quotation_reference,quotation_date,
      unit_price,delivery_charge,status_id
    ) VALUES (
      $1,$2,$3,'QT-047','2026-08-07',10,2,
      lookup_id('quotation_status','Received')
    )
  `, [ids.quotation, resource.lineA, resource.supplier]);
  await db.exec("ALTER TABLE quotations ENABLE TRIGGER USER");

  await db.exec("ALTER TABLE invoices DISABLE TRIGGER USER");
  await db.query(`
    INSERT INTO invoices(
      id,direction,request_id,company_id,invoice_number,invoice_date,
      due_date,amount,status_id
    ) VALUES (
      $1,'CUSTOMER',$2,$3,'INV-047','2026-08-07','2026-08-14',100,
      lookup_id('invoice_status','Issued')
    )
  `, [ids.invoice, ids.requestA, ids.companyA]);
  await db.exec("ALTER TABLE invoices ENABLE TRIGGER USER");

  return { db, resource };
}

async function operationRows(
  db: PGlite,
  actorId: string,
  assignmentId: string,
  permission: string,
) {
  const result = await db.query<{ requestId: string }>(`
    SELECT request_id::text AS "requestId"
    FROM axora_operation_request_access_rows($1,$2,$3,now())
    ORDER BY request_id
  `, [actorId, assignmentId, permission]);
  return result.rows.map((row) => row.requestId);
}

async function userIds(
  db: PGlite,
  actorId: string,
  assignmentId: string,
) {
  const result = await db.query<{ id: string }>(`
    SELECT user_id::text AS id
    FROM axora_user_directory_rows($1,$2,now())
    ORDER BY user_id
  `, [actorId, assignmentId]);
  return result.rows.map((row) => row.id);
}

describe("P0-02 isolation closure migration", () => {
  it("filters operational request identities before source-table joins", async () => {
    const { db } = await fixture();
    try {
      const owner = await operationRows(
        db,
        ids.owner,
        ids.ownerAssignment,
        "sourcing.manage",
      );
      expect(owner).toContain(ids.requestA);
      expect(owner).toContain(ids.requestB);

      const company = await operationRows(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
        "request.approval_queue.view",
      );
      expect(company).toContain(ids.requestA);
      expect(company).not.toContain(ids.requestB);

      const department = await operationRows(
        db,
        ids.departmentAdminA,
        ids.departmentAssignmentA,
        "request.approval_queue.view",
      );
      expect(department).toEqual([ids.requestA]);

      expect(await operationRows(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
        "sourcing.manage",
      )).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("locks line, quotation, invoice, and request parents only inside scope", async () => {
    const { db, resource } = await fixture();
    try {
      const line = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_line_access(
          $1,$2,'sourcing.manage',$3,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, resource.lineA]);
      expect(line.rows[0]?.snapshot).toMatchObject({
        requestId: ids.requestA,
        requestLineId: resource.lineA,
      });

      const deniedLine = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_line_access(
          $1,$2,'sourcing.manage',$3,now()
        ) AS snapshot
      `, [ids.companyAdminA, ids.companyAssignmentA, resource.lineA]);
      expect(deniedLine.rows[0]?.snapshot).toBeNull();

      const quotation = await db.query<SnapshotRow>(`
        SELECT axora_lock_quotation_access(
          $1,$2,'sourcing.manage',$3,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, ids.quotation]);
      expect(quotation.rows[0]?.snapshot).toMatchObject({
        requestId: ids.requestA,
        quotationId: ids.quotation,
      });

      const invoice = await db.query<SnapshotRow>(`
        SELECT axora_lock_invoice_access(
          $1,$2,'finance.manage',$3,now()
        ) AS snapshot
      `, [ids.companyAdminA, ids.companyAssignmentA, ids.invoice]);
      expect(invoice.rows[0]?.snapshot).toMatchObject({
        requestId: ids.requestA,
        invoiceId: ids.invoice,
        invoiceDirection: "CUSTOMER",
      });

      const otherTenant = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_line_access(
          $1,$2,'request.approve.other',$3,now()
        ) AS snapshot
      `, [ids.companyAdminB, ids.companyAssignmentB, resource.lineA]);
      expect(otherTenant.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("scopes user directories and target locks by company, branch, and department", async () => {
    const { db } = await fixture();
    try {
      const owner = await userIds(db, ids.owner, ids.ownerAssignment);
      expect(owner).toEqual(expect.arrayContaining([
        ids.companyAdminA,
        ids.branchAdminA,
        ids.departmentAdminA,
        ids.requesterA,
        ids.companyAdminB,
      ]));

      const company = await userIds(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
      );
      expect(company).toEqual(expect.arrayContaining([
        ids.companyAdminA,
        ids.branchAdminA,
        ids.departmentAdminA,
        ids.requesterA,
      ]));
      expect(company).not.toContain(ids.companyAdminB);

      const branch = await userIds(
        db,
        ids.branchAdminA,
        ids.branchAssignmentA,
      );
      expect(branch).toContain(ids.branchAdminA);
      expect(branch).toContain(ids.departmentAdminA);
      expect(branch).toContain(ids.requesterA);
      expect(branch).not.toContain(ids.companyAdminA);
      expect(branch).not.toContain(ids.companyAdminB);

      const department = await userIds(
        db,
        ids.departmentAdminA,
        ids.departmentAssignmentA,
      );
      expect(department).toContain(ids.departmentAdminA);
      expect(department).toContain(ids.requesterA);
      expect(department).not.toContain(ids.branchAdminA);
      expect(department).not.toContain(ids.companyAdminB);

      const allowed = await db.query<SnapshotRow>(`
        SELECT axora_lock_user_target_access(
          $1,$2,'user.deactivate',$3,now()
        ) AS snapshot
      `, [ids.companyAdminA, ids.companyAssignmentA, ids.requesterA]);
      const denied = await db.query<SnapshotRow>(`
        SELECT axora_lock_user_target_access(
          $1,$2,'user.deactivate',$3,now()
        ) AS snapshot
      `, [ids.companyAdminA, ids.companyAssignmentA, ids.companyAdminB]);
      expect(allowed.rows[0]?.snapshot).toMatchObject({
        userId: ids.requesterA,
        permission: "user.deactivate",
      });
      expect(denied.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("stops all capability output immediately after assignment revocation", async () => {
    const { db } = await fixture();
    try {
      await db.query(`
        UPDATE role_assignments
        SET active=false,revoked_at=now(),revoked_by=$2,
            revoke_reason='Isolation closure revocation test'
        WHERE id=$1
      `, [ids.companyAssignmentA, ids.owner]);
      expect(await operationRows(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
        "request.approval_queue.view",
      )).toEqual([]);
      expect(await userIds(
        db,
        ids.companyAdminA,
        ids.companyAssignmentA,
      )).toEqual([]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("exposes only minimized closure capabilities to the application role", async () => {
    const { db } = await fixture(true);
    try {
      const privileges = await db.query<{
        operationRows: boolean;
        lineLock: boolean;
        quotationLock: boolean;
        invoiceLock: boolean;
        userRows: boolean;
        userLock: boolean;
        publicOperationRows: boolean;
        publicUserRows: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_operation_request_access_rows(uuid,uuid,text,timestamptz)',
            'EXECUTE'
          ) AS "operationRows",
          has_function_privilege(
            'axora_app',
            'axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "lineLock",
          has_function_privilege(
            'axora_app',
            'axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "quotationLock",
          has_function_privilege(
            'axora_app',
            'axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "invoiceLock",
          has_function_privilege(
            'axora_app',
            'axora_user_directory_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "userRows",
          has_function_privilege(
            'axora_app',
            'axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS "userLock",
          has_function_privilege(
            'public',
            'axora_operation_request_access_rows(uuid,uuid,text,timestamptz)',
            'EXECUTE'
          ) AS "publicOperationRows",
          has_function_privilege(
            'public',
            'axora_user_directory_rows(uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicUserRows"
      `);
      expect(privileges.rows[0]).toEqual({
        operationRows: true,
        lineLock: true,
        quotationLock: true,
        invoiceLock: true,
        userRows: true,
        userLock: true,
        publicOperationRows: false,
        publicUserRows: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});

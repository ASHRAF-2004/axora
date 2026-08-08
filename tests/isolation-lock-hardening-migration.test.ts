import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  companyA: "10000000-0000-4000-8000-000000000001",
  companyB: "10000000-0000-4000-8000-000000000002",
  branchA: "20000000-0000-4000-8000-000000000001",
  requestA: "50000000-0000-4000-8000-000000000001",
  owner: "a0480000-0000-4000-8000-000000000001",
  companyAdmin: "a0480000-0000-4000-8000-000000000002",
  ownerAssignment: "b0480000-0000-4000-8000-000000000001",
  companyAssignment: "b0480000-0000-4000-8000-000000000002",
} as const;

interface RoleIds {
  owner: string;
  companyAdmin: string;
}

interface SnapshotRow {
  snapshot: Record<string, unknown> | null;
}

async function fixture(createAppRole = false) {
  const db = new PGlite();
  if (createAppRole) await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await applyDemoSeed(db);

  const roles = await db.query<RoleIds>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='PLATFORM_OWNER') AS owner,
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
        AS "companyAdmin"
  `);
  const role = roles.rows[0];
  if (!role?.owner || !role.companyAdmin) {
    throw new Error("Lock-hardening roles are unavailable");
  }

  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version
    ) VALUES
      ($1,'owner-048@example.test','Owner 048','not-a-real-hash',$3,
        NULL,true,now(),'PLATFORM','ACTIVE',true,1),
      ($2,'company-048@example.test','Company admin 048','not-a-real-hash',$4,
        $5,false,now(),'COMPANY','ACTIVE',true,1)
  `, [ids.owner, ids.companyAdmin, role.owner, role.companyAdmin, ids.companyA]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at
    ) VALUES ($1,$2,'ACTIVE',true,now())
  `, [ids.companyAdmin, ids.companyA]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) VALUES
      ($1,$3,$5,'PLATFORM',NULL,true,$3,now()),
      ($2,$4,$6,'COMPANY',$7,true,$3,now())
  `, [
    ids.ownerAssignment,
    ids.companyAssignment,
    ids.owner,
    ids.companyAdmin,
    role.owner,
    role.companyAdmin,
    ids.companyA,
  ]);
  return db;
}

function position(definition: string, value: string) {
  const result = definition.indexOf(value);
  expect(result).toBeGreaterThanOrEqual(0);
  return result;
}

describe("P0-02 transaction lock hardening", () => {
  it("authorizes trusted parents before taking child row locks", async () => {
    const db = await fixture();
    try {
      const definitions = await db.query<{
        line: string;
        quotation: string;
        invoice: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz)'::regprocedure
          ) AS line,
          pg_get_functiondef(
            'axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz)'::regprocedure
          ) AS quotation,
          pg_get_functiondef(
            'axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz)'::regprocedure
          ) AS invoice
      `);
      const row = definitions.rows[0];
      expect(position(row.line, "axora_lock_request_resource_access"))
        .toBeLessThan(position(row.line, "FOR UPDATE OF line"));
      expect(position(row.quotation, "axora_lock_request_line_access"))
        .toBeLessThan(position(row.quotation, "FOR UPDATE OF quotation"));
      expect(position(row.invoice, "axora_lock_request_resource_access"))
        .toBeLessThan(position(row.invoice, "FOR UPDATE OF invoice"));
    } finally {
      await db.close();
    }
  }, 30_000);

  it("locks an authorized creation scope and denies another tenant", async () => {
    const db = await fixture();
    try {
      const allowed = await db.query<SnapshotRow>(`
        SELECT axora_lock_user_creation_scope(
          $1,$2,'REQUESTER','BRANCH',$3,$4,NULL,NULL,now()
        ) AS snapshot
      `, [ids.companyAdmin, ids.companyAssignment, ids.companyA, ids.branchA]);
      expect(allowed.rows[0]?.snapshot).toMatchObject({
        role: "REQUESTER",
        accountKind: "COMPANY",
        organizationName: expect.any(String),
        scope: {
          type: "BRANCH",
          companyId: ids.companyA,
          branchId: ids.branchA,
        },
      });

      const denied = await db.query<SnapshotRow>(`
        SELECT axora_lock_user_creation_scope(
          $1,$2,'COMPANY_ADMIN','COMPANY',$3,NULL,NULL,NULL,now()
        ) AS snapshot
      `, [ids.companyAdmin, ids.companyAssignment, ids.companyB]);
      expect(denied.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("returns no write capability after the trusted resource becomes inactive", async () => {
    const db = await fixture();
    try {
      const active = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_resource_access(
          $1,$2,'request.view',$3,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, ids.requestA]);
      expect(active.rows[0]?.snapshot).toMatchObject({ active: true });

      await db.query(`
        UPDATE branches
        SET active=false,
            deactivated_at=now(),
            deactivated_by=$2,
            deactivation_reason='Inactive resource security test'
        WHERE id=$1
      `, [ids.branchA, ids.owner]);
      const inactive = await db.query<SnapshotRow>(`
        SELECT axora_lock_request_resource_access(
          $1,$2,'request.view',$3,now()
        ) AS snapshot
      `, [ids.owner, ids.ownerAssignment, ids.requestA]);
      expect(inactive.rows[0]?.snapshot).toBeNull();
    } finally {
      await db.close();
    }
  }, 30_000);

  it("locks the exact selected user assignment and exposes only intended commands", async () => {
    const db = await fixture(true);
    try {
      const definition = await db.query<{ value: string }>(`
        SELECT pg_get_functiondef(
          'axora_lock_user_target_access(uuid,uuid,text,uuid,timestamptz)'::regprocedure
        ) AS value
      `);
      expect(definition.rows[0].value).toContain("FOR KEY SHARE OF assignment");
      expect(definition.rows[0].value).toContain("locked_assignment.revoked_at");

      const privileges = await db.query<{
        creation: boolean;
        line: boolean;
        quotation: boolean;
        invoice: boolean;
        publicCreation: boolean;
      }>(`
        SELECT
          has_function_privilege(
            'axora_app',
            'axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS creation,
          has_function_privilege(
            'axora_app',
            'axora_lock_request_line_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS line,
          has_function_privilege(
            'axora_app',
            'axora_lock_quotation_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS quotation,
          has_function_privilege(
            'axora_app',
            'axora_lock_invoice_access(uuid,uuid,text,uuid,timestamptz)',
            'EXECUTE'
          ) AS invoice,
          has_function_privilege(
            'public',
            'axora_lock_user_creation_scope(uuid,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS "publicCreation"
      `);
      expect(privileges.rows[0]).toEqual({
        creation: true,
        line: true,
        quotation: true,
        invoice: true,
        publicCreation: false,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});

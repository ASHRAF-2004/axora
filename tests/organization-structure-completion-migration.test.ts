import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  owner: "55000000-0000-4000-8000-000000000001",
  assignment: "55000000-0000-4000-8000-000000000002",
} as const;

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db, { through: "055_organization_structure_completion.sql" });
  await applyDemoSeed(db);
  const context = await db.query<{ companyId: string; branchId: string }>(`
    SELECT company.id::text AS "companyId",branch.id::text AS "branchId"
    FROM companies company JOIN branches branch ON branch.company_id=company.id
    WHERE company.active AND branch.active ORDER BY company.id,branch.id LIMIT 1
  `);
  const row = context.rows[0];
  if (!row) throw new Error("Organization structure fixture is incomplete");
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,active,
      account_kind,account_status,account_setup_completed_at
    ) VALUES (
      $1,'owner-055@example.test','Organization Owner','not-a-real-hash',
      (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
      'PLATFORM','ACTIVE',now()
    )
  `, [ids.owner]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by
    ) SELECT $1,$2,id,'PLATFORM',true,$2 FROM roles WHERE role_key='PLATFORM_OWNER'
  `, [ids.assignment, ids.owner]);
  return { db, ...row };
}

async function saveNode(
  db: PGlite,
  input: {
    type: string;
    id?: string;
    companyId: string;
    code: string;
    name: string;
    branchId?: string;
    departmentId?: string;
    parentId?: string;
    businessUnitId?: string;
    details?: Record<string, unknown>;
  },
) {
  return db.query<{ snapshot: { nodeId: string } }>(`
    SELECT axora_save_organization_node(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()
    ) AS snapshot
  `, [
    ids.owner, ids.assignment, input.type, input.id ?? null, input.companyId,
    input.code, input.name, input.branchId ?? null, input.departmentId ?? null,
    input.parentId ?? null, input.businessUnitId ?? null,
    JSON.stringify(input.details ?? {}), "Focused organization structure change",
  ]);
}

describe("organization structure completion migration", () => {
  it("creates a tenant-consistent hierarchy and exposes only capability-filtered rows", async () => {
    const { db, companyId, branchId } = await fixture();
    try {
      const department = await saveNode(db, {
        type: "DEPARTMENT", companyId, branchId, code: "OPS-055", name: "Operations 055",
        details: { description: "Operations department", timezone: "Asia/Kuala_Lumpur" },
      });
      const departmentId = department.rows[0]?.snapshot.nodeId;
      const unit = await saveNode(db, {
        type: "BUSINESS_UNIT", companyId, code: "BU-055", name: "Core business 055",
        details: { description: "Core business unit" },
      });
      const businessUnitId = unit.rows[0]?.snapshot.nodeId;
      await saveNode(db, {
        type: "COST_CENTRE", companyId, branchId, departmentId, businessUnitId,
        code: "CC-055", name: "Operations cost centre",
        details: { currency: "MYR", description: "Operational spend" },
      });
      await saveNode(db, {
        type: "DELIVERY_LOCATION", companyId, branchId, departmentId,
        code: "DL-055", name: "Operations receiving bay",
        details: {
          address: "55 Test Avenue", city: "Kuala Lumpur", countryCode: "MY",
          timezone: "Asia/Kuala_Lumpur", isPrimary: true,
        },
      });

      const workspace = await db.query<{ snapshot: Record<string, unknown> }>(`
        SELECT axora_organization_structure_workspace($1,$2,now()) AS snapshot
      `, [ids.owner, ids.assignment]);
      expect(workspace.rows[0]?.snapshot).toMatchObject({
        canManageBranches: true,
        canManageDepartments: true,
        canManageCostCentres: true,
        canManageDeliveryLocations: true,
      });
      expect(JSON.stringify(workspace.rows[0]?.snapshot)).toContain(departmentId);
      expect(JSON.stringify(workspace.rows[0]?.snapshot)).toContain(businessUnitId);
      const history = await db.query<{ count: number }>(`
        SELECT count(*)::integer AS count FROM organization_structure_history
        WHERE company_id=$1
      `, [companyId]);
      expect(history.rows[0]?.count).toBe(4);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects hierarchy cycles, cross-tenant links, hard deletes, and unsafe deactivation", async () => {
    const { db, companyId, branchId } = await fixture();
    try {
      const parent = await saveNode(db, {
        type: "DEPARTMENT", companyId, branchId, code: "PAR-055", name: "Parent 055",
        details: { timezone: "Asia/Kuala_Lumpur" },
      });
      const parentId = parent.rows[0]?.snapshot.nodeId;
      const child = await saveNode(db, {
        type: "DEPARTMENT", companyId, branchId, parentId,
        code: "CHD-055", name: "Child 055",
        details: { timezone: "Asia/Kuala_Lumpur" },
      });
      const childId = child.rows[0]?.snapshot.nodeId;
      await expect(saveNode(db, {
        type: "DEPARTMENT", id: parentId, companyId, branchId, parentId: childId,
        code: "PAR-055", name: "Parent 055",
        details: { timezone: "Asia/Kuala_Lumpur" },
      })).rejects.toThrow(/unavailable|hierarchy/i);
      await expect(db.query("DELETE FROM departments WHERE id=$1", [childId]))
        .rejects.toThrow(/deactivated, not deleted/i);
      await expect(db.query(`
        SELECT axora_set_organization_node_active(
          $1,$2,'DEPARTMENT',$3,false,'Deactivate parent with active child',now()
        )
      `, [ids.owner, ids.assignment, parentId])).rejects.toThrow(/unavailable/i);

      const otherCompany = await db.query<{ id: string }>(`
        SELECT id::text FROM companies WHERE id<>$1 AND active ORDER BY id LIMIT 1
      `, [companyId]);
      await expect(db.query(`
        INSERT INTO cost_centres(
          company_id,branch_id,department_id,cost_centre_code,name
        ) VALUES ($1,$2,$3,'BAD-055','Cross tenant centre')
      `, [otherCompany.rows[0]?.id, branchId, childId]))
        .rejects.toThrow(/foreign key|unavailable/i);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("keeps department invitation identity immutable and exposes only public capabilities", async () => {
    const { db } = await fixture();
    try {
      const catalog = await db.query<{ column: string; constraint: string }>(`
        SELECT column_name AS column,
          (SELECT conname FROM pg_constraint
            WHERE conname='account_setup_invitation_department_scope_check') AS constraint
        FROM information_schema.columns
        WHERE table_name='account_setup_invitations'
          AND column_name='intended_department_id'
      `);
      expect(catalog.rows[0]).toEqual({
        column: "intended_department_id",
        constraint: "account_setup_invitation_department_scope_check",
      });
      const privileges = await db.query<{ workspace: boolean; internal: boolean; public: boolean }>(`
        SELECT
          has_function_privilege('axora_app','axora_organization_structure_workspace(uuid,uuid,timestamptz)','EXECUTE') AS workspace,
          has_function_privilege('axora_app','axora_organization_permission_at(jsonb,text,uuid,uuid,uuid)','EXECUTE') AS internal,
          has_function_privilege('public','axora_save_organization_node(uuid,uuid,text,uuid,uuid,text,text,uuid,uuid,uuid,uuid,jsonb,text,timestamptz)','EXECUTE') AS public
      `);
      expect(privileges.rows[0]).toEqual({ workspace: true, internal: false, public: false });
    } finally {
      await db.close();
    }
  }, 30_000);
});

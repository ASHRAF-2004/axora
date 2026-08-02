import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PENDING_ACCOUNT_PASSWORD_HASH } from "@/lib/password-policy";
import { applyMigrations } from "./helpers/pglite";

const ownerId = "81000000-0000-4000-8000-000000000001";
const companyAdminId = "81000000-0000-4000-8000-000000000002";
const branchAdminId = "81000000-0000-4000-8000-000000000003";
const companyId = "82000000-0000-4000-8000-000000000001";
const branchId = "83000000-0000-4000-8000-000000000001";
const supplierId = "84000000-0000-4000-8000-000000000001";

describe("canonical account invitation database boundary", () => {
  let db: PGlite;
  let sequence = 0;

  beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db, { through: "024_canonical_account_invitations.sql" });
    await db.query(
      `INSERT INTO companies(id,company_code,name)
       VALUES ($1,'CANONICAL-COMPANY','Canonical Company')`,
      [companyId],
    );
    await db.query(
      `INSERT INTO branches(
         id,branch_code_id,company_id,branch_code,name,delivery_address
       ) VALUES ($1,'CANONICAL-BRANCH-ID',$2,'CANONICAL-BRANCH',
         'Canonical Branch','Test address')`,
      [branchId, companyId],
    );
    await db.query(
      `INSERT INTO suppliers(id,supplier_code,name)
       VALUES ($1,'CANONICAL-SUPPLIER','Canonical Supplier')`,
      [supplierId],
    );
    await insertActiveActor(ownerId, "owner@example.test", "PLATFORM_OWNER", {
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: true,
    });
    await insertActiveActor(companyAdminId, "company.admin@example.test", "COMPANY_ADMIN", {
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId,
    });
    await insertActiveActor(branchAdminId, "branch.admin@example.test", "BRANCH_ADMIN", {
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId,
      branchId,
    });
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  async function insertActiveActor(
    id: string,
    email: string,
    role: string,
    scope: {
      accountKind: "PLATFORM" | "COMPANY";
      scopeType: "PLATFORM" | "COMPANY" | "BRANCH";
      companyId?: string;
      branchId?: string;
      isOwner?: boolean;
    },
  ) {
    await db.query(
      `INSERT INTO users(
         id,email,display_name,password_hash,role_id,company_id,branch_id,
         is_owner,active,account_setup_completed_at,account_kind,account_status
       ) VALUES (
         $1,$2,$3,'active-test-password',
         (SELECT id FROM roles WHERE role_key=$4),$5,$6,$7,true,now(),$8,'ACTIVE'
       )`,
      [id, email, email, role, scope.companyId ?? null, scope.branchId ?? null,
        scope.isOwner ?? false, scope.accountKind],
    );
    if (scope.companyId) {
      await db.query(
        `INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
         VALUES ($1,$2,'ACTIVE',true,now())`,
        [id, scope.companyId],
      );
    }
    if (scope.branchId) {
      await db.query(
        `INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
         VALUES ($1,$2,$3,'ACTIVE',true)`,
        [id, scope.companyId, scope.branchId],
      );
    }
    await db.query(
      `INSERT INTO role_assignments(
         user_id,role_id,scope_type,company_id,branch_id,active
       ) SELECT $1,id,$3,$4,$5,true FROM roles WHERE role_key=$2`,
      [id, role, scope.scopeType, scope.companyId ?? null, scope.branchId ?? null],
    );
  }

  async function insertInvitedTarget(input: {
    role: string;
    accountKind: "COMPANY" | "SUPPLIER" | "DELIVERY" | "PLATFORM";
    scopeType: "COMPANY" | "BRANCH" | "SUPPLIER" | "DELIVERY" | "PLATFORM";
    companyId?: string;
    branchId?: string;
    supplierId?: string;
    isOwner?: boolean;
  }) {
    sequence += 1;
    const suffix = String(sequence).padStart(12, "0");
    const userId = `85000000-0000-4000-8000-${suffix}`;
    await db.query(
      `INSERT INTO users(
         id,email,display_name,password_hash,role_id,company_id,branch_id,
         is_owner,active,account_setup_completed_at,account_kind,account_status
       ) VALUES (
         $1,$2,$3,$4,(SELECT id FROM roles WHERE role_key=$5),$6,$7,$8,true,NULL,$9,'INVITED'
       )`,
      [userId, `target-${sequence}@example.test`, `Target ${sequence}`,
        PENDING_ACCOUNT_PASSWORD_HASH, input.role, input.companyId ?? null,
        input.branchId ?? null, input.isOwner ?? false, input.accountKind],
    );
    await db.query(
      "INSERT INTO account_credentials(user_id,password_hash,password_algorithm) VALUES ($1,NULL,NULL)",
      [userId],
    );
    if (input.companyId) {
      await db.query(
        `INSERT INTO company_memberships(user_id,company_id,status,is_primary)
         VALUES ($1,$2,'INVITED',true)`,
        [userId, input.companyId],
      );
    }
    if (input.branchId) {
      await db.query(
        `INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
         VALUES ($1,$2,$3,'ACTIVE',true)`,
        [userId, input.companyId, input.branchId],
      );
    }
    if (input.supplierId) {
      await db.query(
        `INSERT INTO supplier_memberships(user_id,supplier_id,status)
         VALUES ($1,$2,'INVITED')`,
        [userId, input.supplierId],
      );
    }
    if (input.accountKind === "DELIVERY") {
      await db.query(
        `INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
         VALUES ($1,$2,true)`,
        [userId, `DRIVER-${sequence}`],
      );
    }
    await db.query(
      `INSERT INTO role_assignments(
         user_id,role_id,scope_type,company_id,branch_id,supplier_id,active
       ) SELECT $1,id,$3,$4,$5,$6,true FROM roles WHERE role_key=$2`,
      [userId, input.role, input.scopeType, input.companyId ?? null,
        input.branchId ?? null, input.supplierId ?? null],
    );
    return userId;
  }

  async function insertInvitation(
    userId: string,
    creatorId: string,
    role: string,
    scope: {
      scopeType: string;
      companyId?: string;
      branchId?: string;
      supplierId?: string;
    },
  ) {
    sequence += 1;
    return db.query<{ id: string }>(
      `INSERT INTO account_setup_invitations(
         user_id,company_id,token_hash,expires_at,created_by,
         intended_role_id,intended_branch_id,intended_scope_type,intended_supplier_id
       ) VALUES (
         $1,$2,$3,now()+interval '1 day',$4,
         (SELECT id FROM roles WHERE role_key=$5),$6,$7,$8
       ) RETURNING id::text`,
      [userId, scope.companyId ?? null, sequence.toString(16).padStart(64, "0"),
        creatorId, role,
        scope.branchId ?? null, scope.scopeType, scope.supplierId ?? null],
    );
  }

  it("allows an active company administrator only within its company", async () => {
    const userId = await insertInvitedTarget({
      role: "COMPANY_APPROVER",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId,
    });
    await expect(insertInvitation(userId, companyAdminId, "COMPANY_APPROVER", {
      scopeType: "COMPANY",
      companyId,
    })).resolves.toMatchObject({ affectedRows: 1 });

    const supplierUserId = await insertInvitedTarget({
      role: "SUPPLIER_USER",
      accountKind: "SUPPLIER",
      scopeType: "SUPPLIER",
      supplierId,
    });
    await expect(insertInvitation(supplierUserId, companyAdminId, "SUPPLIER_USER", {
      scopeType: "SUPPLIER",
      supplierId,
    })).rejects.toThrow(/platform owner/i);
  });

  it("allows a branch administrator only the three approved roles in its branch", async () => {
    const requesterId = await insertInvitedTarget({
      role: "REQUESTER",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId,
      branchId,
    });
    await expect(insertInvitation(requesterId, branchAdminId, "REQUESTER", {
      scopeType: "BRANCH",
      companyId,
      branchId,
    })).resolves.toMatchObject({ affectedRows: 1 });

    const newBranchAdminId = await insertInvitedTarget({
      role: "BRANCH_ADMIN",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId,
      branchId,
    });
    await expect(insertInvitation(newBranchAdminId, branchAdminId, "BRANCH_ADMIN", {
      scopeType: "BRANCH",
      companyId,
      branchId,
    })).rejects.toThrow(/outside the permitted account scope/i);
  });

  it("binds supplier scope immutably to the owner-approved role assignment", async () => {
    const userId = await insertInvitedTarget({
      role: "SUPPLIER_USER",
      accountKind: "SUPPLIER",
      scopeType: "SUPPLIER",
      supplierId,
    });
    const inserted = await insertInvitation(userId, ownerId, "SUPPLIER_USER", {
      scopeType: "SUPPLIER",
      supplierId,
    });
    await expect(db.query(
      "UPDATE account_setup_invitations SET intended_supplier_id=NULL WHERE id=$1",
      [inserted.rows[0].id],
    )).rejects.toThrow(/immutable|scope is invalid/i);

    const driverId = await insertInvitedTarget({
      role: "DELIVERY_DRIVER",
      accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    });
    await expect(insertInvitation(driverId, ownerId, "DELIVERY_DRIVER", {
      scopeType: "SUPPLIER",
      supplierId,
    })).rejects.toThrow(/role assignment|scope/i);
  });
});

describe("legacy invitation normalization", () => {
  it("rebinds a pre-024 legacy role to its exact canonical assignment", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db, { through: "023_workflow_event_rls_and_baseline.sql" });
      const legacyCompanyId = "86000000-0000-4000-8000-000000000001";
      const legacyUserId = "87000000-0000-4000-8000-000000000001";
      await db.query(
        `INSERT INTO companies(id,company_code,name)
         VALUES ($1,'LEGACY-INVITE','Legacy Invite Company')`,
        [legacyCompanyId],
      );
      await db.query(
        `INSERT INTO users(
           id,email,display_name,password_hash,role_id,company_id,is_owner,
           active,account_setup_completed_at,account_kind,account_status
         ) VALUES (
           $1,'legacy.invite@example.test','Legacy Invite',$2,
           (SELECT id FROM roles WHERE role_key='VIEWER'),$3,false,true,NULL,
           'COMPANY','INVITED'
         )`,
        [legacyUserId, PENDING_ACCOUNT_PASSWORD_HASH, legacyCompanyId],
      );
      await db.query(
        "INSERT INTO account_credentials(user_id,password_hash,password_algorithm) VALUES ($1,NULL,NULL)",
        [legacyUserId],
      );
      await db.query(
        `INSERT INTO company_memberships(user_id,company_id,status,is_primary)
         VALUES ($1,$2,'INVITED',true)`,
        [legacyUserId, legacyCompanyId],
      );
      await db.query(
        `INSERT INTO role_assignments(
           user_id,role_id,scope_type,company_id,active
         ) SELECT $1,id,'COMPANY',$2,true FROM roles WHERE role_key='AUDITOR'`,
        [legacyUserId, legacyCompanyId],
      );
      await db.query(
        `INSERT INTO account_setup_invitations(
           user_id,company_id,token_hash,expires_at,
           intended_role_id,intended_branch_id
         ) VALUES (
           $1,$2,$3,now()+interval '1 day',
           (SELECT id FROM roles WHERE role_key='VIEWER'),NULL
         )`,
        [legacyUserId, legacyCompanyId, "d".repeat(64)],
      );

      await db.exec(await readFile(
        new URL("../database/migrations/024_canonical_account_invitations.sql", import.meta.url),
        "utf8",
      ));
      const normalized = await db.query<{
        role_key: string;
        intended_scope_type: string;
        company_id: string;
        intended_branch_id: string | null;
      }>(`
        SELECT role.role_key,invitation.intended_scope_type,
          invitation.company_id::text,invitation.intended_branch_id::text
        FROM account_setup_invitations invitation
        JOIN roles role ON role.id=invitation.intended_role_id
        WHERE invitation.user_id=$1
      `, [legacyUserId]);
      expect(normalized.rows[0]).toEqual({
        role_key: "AUDITOR",
        intended_scope_type: "COMPANY",
        company_id: legacyCompanyId,
        intended_branch_id: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);
});

import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { SessionUser } from "./auth";
import type { UserRecord, UserRole } from "./types";

declare global {
  var __axoraDemoUsers: UserRecord[] | undefined;
}

function demoUsers() {
  if (!global.__axoraDemoUsers) global.__axoraDemoUsers = [{ id: "demo-admin", email: process.env.DEMO_EMAIL || "demo@axora.local",
    displayName: "Axora demo administrator", role: "ADMIN", active: true, isOwner: true, createdAt: new Date().toISOString() }];
  return global.__axoraDemoUsers;
}

export async function listUsers(actor: SessionUser): Promise<UserRecord[]> {
  if (isDemoMode()) return demoUsers();
  const result = await query<UserRecord>(`SELECT u.id::text,u.email,u.display_name AS "displayName",r.role_key AS role,u.active,
    u.is_owner AS "isOwner",u.company_id::text AS "companyId",c.name AS "companyName",
    u.branch_id::text AS "branchId",b.name AS "branchName",
    u.last_login_at::text AS "lastLoginAt",u.created_at::text AS "createdAt"
    FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN companies c ON c.id=u.company_id
    LEFT JOIN branches b ON b.id=u.branch_id
    WHERE ($1::boolean OR (u.company_id=$2::uuid AND ($3::uuid IS NULL OR u.branch_id=$3 OR u.id=$4::uuid)))
    ORDER BY u.display_name`, [actor.isOwner, actor.companyId ?? null, actor.branchId ?? null, actor.id]);
  return result.rows;
}

export async function createUser(
  input: { email: string; displayName: string; role: UserRole; password: string; companyId?: string; branchId?: string },
  actor: SessionUser,
) {
  const ownerCreatableRoles: UserRole[] = ["ADMIN", "BRANCH_ADMIN", "APPROVER", "REQUESTER", "FINANCE", "VIEWER", "IT_SUPPORT"];
  const companyAdminCreatableRoles: UserRole[] = ["ADMIN", "BRANCH_ADMIN", "APPROVER", "REQUESTER", "FINANCE", "VIEWER"];
  const branchAdminCreatableRoles: UserRole[] = ["REQUESTER", "APPROVER"];
  const creatableRoles = actor.isOwner
    ? ownerCreatableRoles
    : actor.role === "BRANCH_ADMIN"
      ? branchAdminCreatableRoles
      : companyAdminCreatableRoles;
  if (!creatableRoles.includes(input.role)) {
    throw new Error("Your account cannot create this role.");
  }
  const companyId = actor.isOwner ? input.companyId : actor.companyId;
  if (!companyId) throw new Error("Every company user must belong to an approved company.");
  const branchScopedRoles: UserRole[] = ["REQUESTER", "APPROVER", "BRANCH_ADMIN"];
  const optionalBranchRoles: UserRole[] = ["FINANCE", "VIEWER"];
  const requestedBranchId = actor.branchId ?? input.branchId;
  const branchId = branchScopedRoles.includes(input.role) || optionalBranchRoles.includes(input.role)
    ? requestedBranchId
    : undefined;
  if (branchScopedRoles.includes(input.role) && !branchId) {
    throw new Error("Select the branch this person will work with.");
  }
  const passwordHash = await hash(input.password, 12);
  if (isDemoMode()) {
    if (demoUsers().some((user) => user.email.toLowerCase() === input.email.toLowerCase())) throw new Error("A user with this email already exists.");
    demoUsers().push({ id: randomUUID(), email: input.email.toLowerCase(), displayName: input.displayName, role: input.role,
      active: true, isOwner: false, companyId, branchId, createdAt: new Date().toISOString() });
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const company = await client.query("SELECT 1 FROM companies WHERE id=$1 AND active=true", [companyId]);
    if (!company.rowCount) throw new Error("The selected company is not active.");
    if (branchId) {
      const branch = await client.query(
        "SELECT 1 FROM branches WHERE id=$1 AND company_id=$2 AND active=true",
        [branchId, companyId],
      );
      if (!branch.rowCount) throw new Error("The selected branch is not active or belongs to another company.");
    }
    await client.query(`INSERT INTO users(email,display_name,password_hash,role_id,company_id,branch_id,is_owner)
      VALUES ($1,$2,$3,(SELECT id FROM roles WHERE role_key=$4),$5,$6,false)`,
    [input.email.toLowerCase(), input.displayName, passwordHash, input.role, companyId, branchId ?? null]);
  });
}

export async function setUserActive(id: string, active: boolean, actor: SessionUser) {
  if (id === actor.id && !active) throw new Error("You cannot deactivate your own signed-in account.");
  if (isDemoMode()) {
    const user = demoUsers().find((item) => item.id === id);
    if (!user) throw new Error("User not found.");
    if (user.isOwner && !active) throw new Error("The Axora owner account cannot be deactivated.");
    user.active = active;
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: active ? "Account activated" : "Account deactivated" }, async (client) => {
    const targetResult = await client.query<{ active: boolean; isOwner: boolean; role: UserRole; companyId?: string }>(
      `SELECT u.active,u.is_owner AS "isOwner",r.role_key AS role,u.company_id::text AS "companyId"
       FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND ($2::boolean OR (u.company_id=$3::uuid AND ($4::uuid IS NULL OR u.branch_id=$4)))
       FOR UPDATE`,
      [id, actor.isOwner, actor.companyId ?? null, actor.branchId ?? null],
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error("User not found.");
    if (actor.role === "BRANCH_ADMIN" && !["REQUESTER", "APPROVER"].includes(target.role)) {
      throw new Error("A branch administrator can manage only requesters and branch approvers.");
    }
    if (!active && target.isOwner) throw new Error("The Axora owner account cannot be deactivated.");
    if (!active && target.active && target.role === "ADMIN") {
      await client.query("SELECT 1 FROM companies WHERE id=$1 FOR UPDATE", [target.companyId]);
      const activeAdmins = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users u
         JOIN roles r ON r.id=u.role_id WHERE u.active=true AND r.role_key='ADMIN'
         AND u.company_id=$1::uuid`,
        [target.companyId],
      );
      if (Number(activeAdmins.rows[0]?.count ?? 0) <= 1) {
        throw new Error("The last active administrator cannot be deactivated.");
      }
    }
    await client.query("UPDATE users SET active=$2 WHERE id=$1", [id, active]);
  });
}

export async function deleteUser(id: string, actor: SessionUser) {
  if (id === actor.id) throw new Error("You cannot delete your own signed-in account.");
  if (isDemoMode()) {
    const users = demoUsers();
    const target = users.find((item) => item.id === id);
    if (!target) throw new Error("User not found.");
    if (target.isOwner) throw new Error("The Axora owner account cannot be deleted.");
    const index = users.findIndex((item) => item.id === id);
    users.splice(index, 1);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: "User deleted" }, async (client) => {
    const targetResult = await client.query<{ isOwner: boolean; role: UserRole; companyId?: string; active: boolean }>(
      `SELECT u.active,u.is_owner AS "isOwner",r.role_key AS role,u.company_id::text AS "companyId"
       FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.id=$1 AND ($2::boolean OR (u.company_id=$3::uuid AND ($4::uuid IS NULL OR u.branch_id=$4 OR u.id=$5::uuid)))
       FOR UPDATE`,
      [id, actor.isOwner, actor.companyId ?? null, actor.branchId ?? null, actor.id],
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error("User not found.");

    if (actor.role === "BRANCH_ADMIN" && !["REQUESTER", "APPROVER"].includes(target.role)) {
      throw new Error("A branch administrator can delete only requesters and branch approvers.");
    }
    if (target.isOwner) throw new Error("The Axora owner account cannot be deleted.");
    if (target.role === "ADMIN" && target.companyId) {
      const activeAdmins = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users u
         JOIN roles r ON r.id=u.role_id WHERE u.active=true AND r.role_key='ADMIN'
         AND u.company_id=$1::uuid`,
        [target.companyId],
      );
      if (Number(activeAdmins.rows[0]?.count ?? 0) <= 1) {
        throw new Error("The last active administrator cannot be deleted.");
      }
    }

    await client.query("UPDATE requests SET created_by=NULL WHERE created_by=$1", [id]);
    await client.query("UPDATE approvals SET reviewer_id=NULL WHERE reviewer_id=$1", [id]);
    await client.query("UPDATE payments SET recorded_by=NULL WHERE recorded_by=$1", [id]);
    await client.query("UPDATE attachments SET uploaded_by=NULL WHERE uploaded_by=$1", [id]);
    await client.query("UPDATE audit_logs SET actor_id=NULL WHERE actor_id=$1", [id]);
    await client.query("UPDATE product_images SET created_by=NULL WHERE created_by=$1", [id]);
    await client.query("DELETE FROM users WHERE id=$1", [id]);
  });
}

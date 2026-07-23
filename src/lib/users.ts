import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { UserRecord, UserRole } from "./types";

declare global {
  var __axoraDemoUsers: UserRecord[] | undefined;
}

function demoUsers() {
  if (!global.__axoraDemoUsers) global.__axoraDemoUsers = [{ id: "demo-admin", email: process.env.DEMO_EMAIL || "demo@axora.local",
    displayName: "Axora demo administrator", role: "ADMIN", active: true, isOwner: true, createdAt: new Date().toISOString() }];
  return global.__axoraDemoUsers;
}

export async function listUsers(): Promise<UserRecord[]> {
  if (isDemoMode()) return demoUsers();
  const result = await query<UserRecord>(`SELECT u.id::text,u.email,u.display_name AS "displayName",r.role_key AS role,u.active,
    u.is_owner AS "isOwner",u.last_login_at::text AS "lastLoginAt",u.created_at::text AS "createdAt"
    FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.display_name`);
  return result.rows;
}

export async function createUser(input: { email: string; displayName: string; role: UserRole; password: string }, actorId: string) {
  const passwordHash = await hash(input.password, 12);
  if (isDemoMode()) {
    if (demoUsers().some((user) => user.email.toLowerCase() === input.email.toLowerCase())) throw new Error("A user with this email already exists.");
    demoUsers().push({ id: randomUUID(), email: input.email.toLowerCase(), displayName: input.displayName, role: input.role,
      active: true, isOwner: false, createdAt: new Date().toISOString() });
    return;
  }
  await withAuditTransaction({ userId: actorId }, (client) => client.query(`INSERT INTO users(email,display_name,password_hash,role_id)
    VALUES ($1,$2,$3,(SELECT id FROM roles WHERE role_key=$4))`, [input.email.toLowerCase(), input.displayName, passwordHash, input.role]));
}

export async function setUserActive(id: string, active: boolean, actorId: string) {
  if (id === actorId && !active) throw new Error("You cannot deactivate your own signed-in account.");
  if (isDemoMode()) {
    const user = demoUsers().find((item) => item.id === id);
    if (!user) throw new Error("User not found.");
    if (user.isOwner && !active) throw new Error("The Axora owner account cannot be deactivated.");
    user.active = active;
    return;
  }
  await withAuditTransaction({ userId: actorId, reason: active ? "Account activated" : "Account deactivated" }, async (client) => {
    const targetResult = await client.query<{ active: boolean; isOwner: boolean; role: UserRole }>(
      `SELECT u.active,u.is_owner AS "isOwner",r.role_key AS role
       FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=$1 FOR UPDATE`,
      [id],
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error("User not found.");
    if (!active && target.isOwner) throw new Error("The Axora owner account cannot be deactivated.");
    if (!active && target.active && target.role === "ADMIN") {
      const activeAdmins = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users u
         JOIN roles r ON r.id=u.role_id WHERE u.active=true AND r.role_key='ADMIN'`,
      );
      if (Number(activeAdmins.rows[0]?.count ?? 0) <= 1) {
        throw new Error("The last active administrator cannot be deactivated.");
      }
    }
    await client.query("UPDATE users SET active=$2 WHERE id=$1", [id, active]);
  });
}

import { compare } from "bcryptjs";
import fs from "node:fs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDemoMode, query, withAuditTransaction } from "./db";
import type { UserRole } from "./types";

const COOKIE_NAME = "axora_session";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

function secretKey() {
  const value = process.env.SESSION_SECRET_FILE && fs.existsSync(process.env.SESSION_SECRET_FILE)
    ? fs.readFileSync(process.env.SESSION_SECRET_FILE, "utf8").trim()
    : process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters.");
  return new TextEncoder().encode(value);
}

async function createToken(user: SessionUser) {
  return new SignJWT({ email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("8h").sign(secretKey());
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  if (isDemoMode()) {
    if (email.toLowerCase() === (process.env.DEMO_EMAIL ?? "").toLowerCase() && password === process.env.DEMO_PASSWORD) {
      return { id: "demo-admin", email, name: "Axora demo administrator", role: "ADMIN" };
    }
    return null;
  }
  const result = await query<{ id: string; email: string; displayName: string; passwordHash: string; role: UserRole }>(
    `SELECT u.id::text,u.email,u.display_name AS "displayName",u.password_hash AS "passwordHash",r.role_key AS role
     FROM users u JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1) AND u.active=true`, [email]);
  const user = result.rows[0];
  if (!user || !(await compare(password, user.passwordHash))) return null;
  await withAuditTransaction({ userId: user.id, reason: "Successful login" }, (client) => client.query("UPDATE users SET last_login_at=now() WHERE id=$1", [user.id]));
  return { id: user.id, email: user.email, name: user.displayName, role: user.role };
}

export async function setSession(user: SessionUser) {
  const store = await cookies();
  store.set(COOKIE_NAME, await createToken(user), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 60 * 60 * 8,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || !payload.email || !payload.name || !payload.role) return null;
    return { id: payload.sub, email: String(payload.email), name: String(payload.name), role: payload.role as UserRole };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const user = await getSession();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(allowed: UserRole[]) {
  const user = await requireSession();
  if (!allowed.includes(user.role)) throw new Error("Your account does not have permission to perform this action.");
  return user;
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}

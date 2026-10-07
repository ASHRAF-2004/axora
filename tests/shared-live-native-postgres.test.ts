import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { resolveEffectiveRoutePermissions } from "@/lib/route-authorization";
import { customerCatalogLiveVersion } from "@/lib/repository";
import { createLiveReader } from "@/lib/live-update-reader";
import { authoritativeSnapshotVersion } from "@/lib/server-event-stream";
import { canAccess } from "@/lib/permissions";

const state = vi.hoisted(() => ({ actor: null as AuthenticatedSessionUser | null }));
vi.mock("@/lib/auth", async (original) => ({
  ...await original<typeof import("@/lib/auth")>(),
  getSession: async () => {
    if (!state.actor) return null;
    try { return { ...state.actor, effectivePermissions: await resolveEffectiveRoutePermissions(state.actor) }; }
    catch { return null; }
  },
}));
const native = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Isolated native live test configuration is incomplete");
  return value;
}

native.sequential("Shared live authorized native snapshot resync", () => {
  let admin: Client;
  const companyA = randomUUID(); const companyB = randomUUID();
  const branchA = randomUUID(); const branchB = randomUUID();
  const ownProduct = randomUUID(); const foreignProduct = randomUUID(); const inactiveProduct = randomUUID();
  let requester: AuthenticatedSessionUser; let cam: AuthenticatedSessionUser;
  async function actor(role: "REQUESTER" | "CLIENT_ACCOUNT_MANAGER") {
    const id = randomUUID(); const assignment = randomUUID();
    const company = role === "REQUESTER" ? companyA : null;
    const branch = role === "REQUESTER" ? branchA : null;
    const kind = role === "REQUESTER" ? "COMPANY" : "PLATFORM";
    const scope = role === "REQUESTER" ? "BRANCH" : "PLATFORM";
    await admin.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,
      company_id,branch_id,account_kind,account_status,is_owner,active,auth_version,account_setup_completed_at)
      SELECT $1,$2,'Isolated live fixture','not-a-real-hash',id,$3,$4,$5,'ACTIVE',false,true,1,now()
      FROM roles WHERE role_key=$6`, [id, `${id}@example.test`, company, branch, kind, role]);
    if (company) {
      await admin.query(`INSERT INTO company_memberships(user_id,company_id,status,is_primary,created_by)
        VALUES ($1,$2,'ACTIVE',true,$1)`, [id, company]);
      await admin.query(`INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary,created_by)
        VALUES ($1,$2,$3,'ACTIVE',true,$1)`, [id, company, branch]);
    }
    await admin.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_by)
      SELECT $1,$2,id,$3,$4,$5,true,$2 FROM roles WHERE role_key=$6`, [assignment, id, scope, company, branch, role]);
    const fixture = { id, email: `${id}@example.test`, name: "Isolated live fixture", role,
      roleAssignmentId: assignment, accountKind: kind, scopeType: scope, isOwner: false, authVersion: 1,
      ...(company ? { companyId: company, branchId: branch! } : {}) } as AuthenticatedSessionUser;
    return { ...fixture, effectivePermissions: await resolveEffectiveRoutePermissions(fixture) };
  }
  async function open(actor: AuthenticatedSessionUser) {
    state.actor = actor;
    const current = { ...actor, effectivePermissions: await resolveEffectiveRoutePermissions(actor) };
    return createLiveReader(current, ["catalog"], actor.accountKind === "COMPANY" ? { branchId: branchA } : {});
  }
  beforeAll(async () => {
    const host = required("AXORA_NATIVE_POSTGRES_HOST");
    const port = Number(required("AXORA_NATIVE_POSTGRES_PORT"));
    if (required("AXORA_NATIVE_POSTGRES_DATABASE") !== "axora_native_ci"
      || (host !== "127.0.0.1" && host !== "::1")
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535
      || required("DB_USER") !== "axora_app"
      || required("DB_NAME") !== "axora_native_ci" || process.env.DATABASE_URL || process.env.DB_PASSWORD_FILE
      || required("DB_HOST") !== host
      || required("DB_PORT") !== required("AXORA_NATIVE_POSTGRES_PORT")) throw new Error("Shared live tests require the isolated native CI database");
    admin = new Client({ host, port, database: "axora_native_ci",
      user: required("AXORA_NATIVE_POSTGRES_ADMIN_USER"), password: required("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"), ssl: false,
      statement_timeout: 10_000, connectionTimeoutMillis: 5_000 });
    await admin.connect();
    for (const [id, branch] of [[companyA, branchA], [companyB, branchB]]) {
      await admin.query("INSERT INTO companies(id,company_code,name,active) VALUES ($1,$2,'Isolated live company',true)", [id, `LS-${id}`]);
      await admin.query(`INSERT INTO branches(id,branch_code_id,company_id,name,branch_code,delivery_address,city,active)
        VALUES ($1,$2,$3,'Isolated live branch','LIVE','Isolated destination','Kuala Lumpur',true)`, [branch, `LS-${branch}`, id]);
    }
    for (const [id, company, active] of [[ownProduct, companyA, true], [foreignProduct, companyB, true], [inactiveProduct, companyA, false]] as const) {
      await admin.query(`INSERT INTO products(id,product_code,name,company_id,category,unit_of_measure,default_buy_price,default_sell_price,active)
        VALUES ($1,$2,$3,$4,'Office','piece',10,11,$5)`, [id, `LS-${id}`, `Isolated product ${id}`, company, active]);
    }
    requester = await actor("REQUESTER");
    cam = await actor("CLIENT_ACCOUNT_MANAGER");
    // Explicit independent catalog grant; never grants confidential pricing.
    await admin.query(`INSERT INTO user_permission_overrides(user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by)
      SELECT $1,id,'GRANT','PLATFORM',now(),true,'Isolated live catalog fixture',$1 FROM permissions WHERE permission_code='product.manage'`, [cam.id]);
    cam = { ...cam, effectivePermissions: await resolveEffectiveRoutePermissions(cam) };
  }, 30_000);
  afterAll(async () => { state.actor = null; await global.__axoraPool?.end(); delete global.__axoraPool; await admin?.end(); });

  it("keeps customer branch/company scope and rejects missing/foreign branch contexts", async () => {
    expect(await customerCatalogLiveVersion(requester, branchA)).toBeDefined();
    await expect(customerCatalogLiveVersion(requester, branchB)).rejects.toThrow();
    await expect(customerCatalogLiveVersion(requester)).rejects.toThrow();
    const reader = await open(requester);
    const before = await reader.load();
    await admin.query("UPDATE products SET description='Foreign invisible update' WHERE id=$1", [foreignProduct]);
    expect(await reader.load()).toEqual(before);
    expect(JSON.stringify(before)).not.toMatch(/count|supplier|cost|productId|companyId|branchId/);
    await admin.query("UPDATE products SET description='Authorized customer metadata update' WHERE id=$1", [ownProduct]);
    const changed = await reader.load();
    expect(changed.topics.catalog?.version).not.toBe(before.topics.catalog?.version);
    await admin.query("UPDATE products SET default_buy_price=12 WHERE id=$1", [ownProduct]);
    const repriced = await reader.load();
    expect(repriced.topics.catalog?.version).not.toBe(changed.topics.catalog?.version);
    expect(JSON.stringify(repriced)).not.toMatch(/cost|price|description|count/);
  });
  it("detects a silent authorized catalog change and exposes only opaque versions to CAM", async () => {
    expect(canAccess(cam, "manage_catalog")).toBe(true);
    expect(canAccess(cam, "view_internal_cost")).toBe(false);
    const reader = await open(cam);
    const before = await reader.load();
    await admin.query("UPDATE products SET description='Authorized silent change' WHERE id=$1", [inactiveProduct]);
    const after = await reader.load();
    expect(after.topics.catalog?.version).not.toBe(before.topics.catalog?.version);
    expect(JSON.stringify(after)).not.toMatch(/supplier|cost|price|description|count/);
    const aggregate = await customerCatalogLiveVersion(cam);
    expect(authoritativeSnapshotVersion(aggregate)).toBe(after.topics.catalog?.version);
    // The canonical model permits one active override per permission/scope.
    // Replace the fixture GRANT with a committed DENY rather than bypassing it.
    const denied = await admin.query<{ id: string }>(`UPDATE user_permission_overrides
      SET effect='DENY',reason='Isolated live CAM DENY'
      WHERE user_id=$1 AND active AND scope_type='PLATFORM'
        AND permission_id=(SELECT id FROM permissions WHERE permission_code='product.manage')
      RETURNING id::text`, [cam.id]);
    expect(denied.rowCount).toBe(1);
    try { await expect(reader.load()).rejects.toThrow(); }
    finally { await admin.query("UPDATE user_permission_overrides SET effect='GRANT' WHERE id=$1", [denied.rows[0].id]); }
  });
  it("rechecks committed DENY, revoked branch membership and inactive role before subsequent delivery", async () => {
    const reader = await open(requester);
    await reader.authorize();
    const deny = randomUUID();
    await admin.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,company_id,branch_id,starts_at,active,reason,changed_by)
      SELECT $1,$2,id,'DENY','BRANCH',$3,$4,now(),true,'Isolated live DENY',$2 FROM permissions WHERE permission_code='product.view'`, [deny, requester.id, companyA, branchA]);
    await expect(reader.authorize()).rejects.toThrow();
    await admin.query("DELETE FROM user_permission_overrides WHERE id=$1", [deny]);
    const membershipReader = await open(requester);
    await admin.query("UPDATE branch_assignments SET status='SUSPENDED' WHERE user_id=$1 AND branch_id=$2", [requester.id, branchA]);
    await expect(membershipReader.load()).rejects.toThrow();
    await admin.query("UPDATE branch_assignments SET status='ACTIVE' WHERE user_id=$1 AND branch_id=$2", [requester.id, branchA]);
    const roleReader = await open(requester);
    await admin.query(`UPDATE role_assignments
      SET active=false,revoked_at=now(),revoked_by=$2,revoke_reason='Isolated live revocation'
      WHERE id=$1`, [requester.roleAssignmentId, cam.id]);
    await expect(roleReader.load()).rejects.toThrow();
  });
});

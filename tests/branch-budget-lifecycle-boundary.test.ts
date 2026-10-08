import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";
import { branchBudgetRefusal } from "@/lib/branch-budget-refusal";

describe.sequential("branch budget and lifecycle boundary", () => {
  let db: PGlite;
  const companyId = randomUUID();
  const branchId = randomUUID();
  let accountId: string;
  const adminId = randomUUID();
  const adminAssignment = randomUUID();
  const branchAdminId = randomUUID();
  const branchAdminAssignment = randomUUID();
  const ownerId = randomUUID();
  const ownerAssignment = randomUUID();
  const backupAdminId = randomUUID();
  const backupAdminAssignment = randomUUID();

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE axora_app NOLOGIN; CREATE ROLE axora_cleanup_worker NOLOGIN;
      CREATE ROLE axora_integration_worker NOLOGIN;
      CREATE TABLE schema_migrations(filename text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT now())`);
    await applyMigrations(db);
    const grants = (await readFile(new URL("../database/admin/apply-app-grants.sql", import.meta.url), "utf8"))
      .replace(/SELECT format\('GRANT CONNECT[\s\S]*?\\gexec/g, "")
      .replace(/^\\.*$/gm, "");
    await db.exec(grants);
    await db.exec(grants);
    await db.query(`INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES ($1,'BOUNDARY-ONLY','Isolated boundary tenant',true,100)`, [companyId]);
    await db.query(`INSERT INTO branches(id,company_id,branch_code_id,branch_code,name,delivery_address,city,active)
      VALUES ($1,$2,'B-BOUNDARY','BOUNDARY','Isolated budget branch','Isolated fixture address','Cyberjaya',true)`, [branchId,companyId]);
    for (const [id,assignment,role,branch] of [
      [adminId,adminAssignment,"COMPANY_ADMIN",null],
      [branchAdminId,branchAdminAssignment,"BRANCH_ADMIN",branchId],
      [backupAdminId,backupAdminAssignment,"COMPANY_ADMIN",null],
    ]) {
      await db.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,
        company_id,branch_id,is_owner,account_setup_completed_at,email_verified_at,
        account_kind,account_status,active,auth_version)
        SELECT $1,$2,'Isolated boundary actor','not-a-real-hash',id,$3,$4,false,now(),now(),
          'COMPANY','ACTIVE',true,1 FROM roles WHERE role_key=$5`,
      [id,`${id}@example.test`,companyId,branch,role]);
      await db.query(`INSERT INTO company_memberships(user_id,company_id,status,is_primary)
        VALUES ($1,$2,'ACTIVE',true)`, [id,companyId]);
      if (branch) await db.query(`INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
        VALUES ($1,$2,$3,'ACTIVE',true)`, [id,companyId,branch]);
      await db.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,branch_id,active)
        SELECT $1,$2,id,$3,$4,$5,true FROM roles WHERE role_key=$6`,
      [assignment,id,branch ? "BRANCH" : "COMPANY",companyId,branch,role]);
    }
    await db.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version)
      SELECT $1,$2,'Isolated boundary owner','not-a-real-hash',id,true,now(),'PLATFORM','ACTIVE',true,1
      FROM roles WHERE role_key='PLATFORM_OWNER'`, [ownerId,`${ownerId}@example.test`]);
    await db.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
      SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'`, [ownerAssignment,ownerId]);
    accountId = (await db.query<{ id: string }>("SELECT id::text FROM budget_accounts WHERE branch_id=$1 AND level_type='BRANCH'", [branchId])).rows[0].id;
  }, 30_000);
  afterAll(async () => { await db.close(); });

  async function asActor<T>(actor: string,assignment: string,operation: () => Promise<T>,commit = false) {
    await db.exec("BEGIN; SET LOCAL ROLE axora_app");
    try {
      await db.query(`SELECT set_config('axora.user_id',$1,true),
        set_config('axora.role_assignment_id',$2,true),set_config('axora.change_reason','Isolated boundary regression',true)`,
      [actor,assignment]);
      const result = await operation();
      await db.exec(commit ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) { await db.exec("ROLLBACK"); throw error; }
  }

  function add(amount: number,command = randomUUID()) {
    return asActor(adminId,adminAssignment,() => db.query<{ result: { changed: boolean } }>(
      "SELECT axora_add_branch_budget($1,$2,$3,$4,$5,now()) AS result",
      [adminId,adminAssignment,branchId,amount,command]),true);
  }

  async function emptyBranch(company = companyId,withoutBudget = false) {
    const id = randomUUID();
    // Isolated pre-use fixture only: a genuinely unreferenced branch. Ordinary
    // branch insertion still bootstraps a budget and is therefore protected.
    if (withoutBudget) await db.exec("ALTER TABLE branches DISABLE TRIGGER seed_branch_budget_account");
    try {
      await db.query(`INSERT INTO branches(id,company_id,branch_code_id,branch_code,name,delivery_address,city,active)
        VALUES ($1,$2,$3,$3,$3,'Isolated fixture address','Cyberjaya',true)`, [id,company,`B-${id}`]);
    } finally { if (withoutBudget) await db.exec("ALTER TABLE branches ENABLE TRIGGER seed_branch_budget_account"); }
    return id;
  }

  function setActive(actor: string,assignment: string,target: string,active: boolean,commit = false) {
    return asActor(actor,assignment,() => db.query<{ result: { branchId: string; changed: boolean } }>(
      "SELECT axora_set_branch_active($1,$2,$3,$4,now()) AS result", [actor,assignment,target,active]),commit);
  }

  function remove(actor: string,assignment: string,target: string,commit = false) {
    return asActor(actor,assignment,() => db.query<{ result: { branchId: string; deleted: boolean } }>(
      "SELECT axora_delete_empty_branch($1,$2,$3,now()) AS result", [actor,assignment,target]),commit);
  }

  it("reports precise authorized ceiling refusal without changing Wallet/recurring/ledger", async () => {
    const error = await add(101).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: "AX004",message: "CEILING_EXCEEDED" });
    expect(branchBudgetRefusal(error)).toEqual({ code: "CEILING_EXCEEDED",
      limits: { ceiling: "100.00",allocated: "0.00",headroom: "100.00" } });
    const state = (await db.query<{ ledger: number; wallet: number; recurring: string }>(`SELECT
      (SELECT count(*)::int FROM budget_ledger_entries WHERE budget_account_id=$1) AS ledger,
      (SELECT count(*)::int FROM company_wallet_ledger_entries WHERE company_id=$2) AS wallet,
      recurring_allocation::text AS recurring FROM budget_accounts WHERE id=$1`, [accountId,companyId])).rows[0];
    expect(state).toEqual({ ledger: 0,wallet: 0,recurring: "0.00" });
  });

  it("revalidates explicit DENY before response-loss replay; authorized replay remains idempotent", async () => {
    const command = randomUUID();
    expect((await add(1,command)).rows[0].result.changed).toBe(true);
    const deny = randomUUID();
    await db.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,
      company_id,reason,changed_by) SELECT $1,$2,id,'DENY','COMPANY',$3,'Isolated revocation',$2
      FROM permissions WHERE permission_code='budget.increase'`, [deny,adminId,companyId]);
    try { await expect(add(1,command)).rejects.toMatchObject({ code: "AX002",message: "FORBIDDEN" }); }
    finally { await db.query("DELETE FROM user_permission_overrides WHERE id=$1", [deny]); }
    expect((await add(1,command)).rows[0].result.changed).toBe(false);
    await expect(add(2,command)).rejects.toMatchObject({ code: "AX005",message: "COMMAND_MISMATCH" });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM branch_budget_add_commands WHERE actor_user_id=$1", [adminId])).rows[0].count).toBe(1);
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM budget_ledger_entries WHERE budget_account_id=$1", [accountId])).rows[0].count).toBe(1);
    expect((await db.query<{ recurring: string }>("SELECT recurring_allocation::text AS recurring FROM budget_accounts WHERE id=$1", [accountId])).rows[0].recurring).toBe("0.00");
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM company_wallet_ledger_entries WHERE company_id=$1", [companyId])).rows[0].count).toBe(0);
  });

  it("reports an absent budget separately and does not fabricate account/period/Wallet", async () => {
    const target = await emptyBranch(companyId,true);
    await expect(asActor(adminId,adminAssignment,() => db.query(
      "SELECT axora_add_branch_budget($1,$2,$3,1,$4,now())", [adminId,adminAssignment,target,randomUUID()]))).rejects.toMatchObject({ code: "AX003",message: "BUDGET_UNAVAILABLE" });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM budget_accounts WHERE branch_id=$1", [target])).rows[0].count).toBe(0);
  });

  it("denies raw lifecycle columns/DELETE after two grant replays but retains metadata UPDATE", async () => {
    for (const column of ["active","deactivated_at","deactivated_by","deactivation_reason"]) {
      expect((await db.query<{ allowed: boolean }>("SELECT has_column_privilege('axora_app','branches',$1,'UPDATE') AS allowed", [column])).rows[0].allowed).toBe(false);
    }
    await expect(asActor(branchAdminId,branchAdminAssignment,() => db.query(
      "UPDATE branches SET active=false,deactivated_at=now(),deactivation_reason='Isolated raw change' WHERE id=$1", [branchId]))).rejects.toMatchObject({ code: "42501" });
    await expect(asActor(adminId,adminAssignment,() => db.query("DELETE FROM branches WHERE id=$1", [branchId]))).rejects.toMatchObject({ code: "42501" });
    expect((await asActor(adminId,adminAssignment,() => db.query<{ name: string }>(
      "UPDATE branches SET name='Permitted metadata fixture' WHERE id=$1 RETURNING name", [branchId]))).rows[0].name).toBe("Permitted metadata fixture");
    for (const helper of ["axora_branch_command_actor_snapshot","axora_branch_lifecycle_actor_snapshot"]) {
      expect((await db.query<{ allowed: boolean }>("SELECT has_function_privilege('axora_app',$1,'EXECUTE') AS allowed", [`public.${helper}(uuid,uuid)`])).rows[0].allowed).toBe(false);
    }
  });

  it("denies Branch Administrator lifecycle despite custom GRANT at canonical/delete/legacy boundaries", async () => {
    await db.query(`INSERT INTO user_permission_overrides(user_id,permission_id,effect,scope_type,
      company_id,branch_id,reason,changed_by) SELECT $1,id,'GRANT','BRANCH',$2,$3,
        'Isolated lifecycle override',$4 FROM permissions WHERE permission_code='organization.branch.manage'`, [branchAdminId,companyId,branchId,adminId]);
    await expect(setActive(branchAdminId,branchAdminAssignment,branchId,false)).rejects.toMatchObject({ message: "The branch is unavailable" });
    await expect(remove(branchAdminId,branchAdminAssignment,branchId)).rejects.toMatchObject({ message: "The branch is unavailable" });
    await expect(asActor(branchAdminId,branchAdminAssignment,() => db.query("DELETE FROM branches WHERE id=$1", [branchId]))).rejects.toMatchObject({ code: "42501" });
    await expect(asActor(branchAdminId,branchAdminAssignment,() => db.query(
      "SELECT axora_set_organization_node_active($1,$2,'BRANCH',$3,false,'Isolated lifecycle',$4)",
      [branchAdminId,branchAdminAssignment,branchId,new Date()]))).rejects.toMatchObject({ message: "The organization status change is unavailable" });
    expect((await db.query<{ active: boolean }>("SELECT active FROM branches WHERE id=$1", [branchId])).rows[0].active).toBe(true);
  });

  it.each([["Company Administrator",adminId,adminAssignment],["Owner",ownerId,ownerAssignment]])("preserves %s lifecycle with audit evidence and response-loss repeat", async (_role,actor,assignment) => {
    const target = await emptyBranch();
    expect((await setActive(actor,assignment,target,false,true)).rows[0].result.changed).toBe(true);
    expect((await setActive(actor,assignment,target,false,true)).rows[0].result.changed).toBe(false);
    const state = (await db.query<{ active: boolean; actor: string; reason: string; history: number; audit: number }>(`SELECT active,deactivated_by::text AS actor,deactivation_reason AS reason,
      (SELECT count(*)::int FROM organization_structure_history WHERE node_id=$1) AS history,
      (SELECT count(*)::int FROM audit_logs WHERE record_id=$1 AND action='UPDATE') AS audit
      FROM branches WHERE id=$1`, [target])).rows[0];
    expect(state).toMatchObject({ active: false,actor,reason: "BRANCH_DEACTIVATED",history: 1,audit: 1 });
    expect((await setActive(actor,assignment,target,true,true)).rows[0].result.changed).toBe(true);
    expect((await db.query<{ actor: string | null; reason: string | null }>("SELECT deactivated_by::text AS actor,deactivation_reason AS reason FROM branches WHERE id=$1", [target])).rows[0]).toEqual({ actor: null,reason: null });
    await expect(remove(actor,assignment,target)).rejects.toMatchObject({ message: "Used branches can only be deactivated" });
    const virgin = await emptyBranch(companyId,true);
    expect((await remove(actor,assignment,virgin,true)).rows[0].result).toEqual({ branchId: virgin,deleted: true });
    expect((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_logs WHERE record_id=$1 AND action='DELETE'", [virgin])).rows[0].count).toBe(1);
  });

  it("honors Company Administrator DENY before revealing or mutating a branch", async () => {
    const deny = randomUUID();
    await db.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,
      company_id,reason,changed_by) SELECT $1,$2,id,'DENY','COMPANY',$3,'Isolated lifecycle denial',$2
      FROM permissions WHERE permission_code='organization.branch.manage'`, [deny,adminId,companyId]);
    try {
      await expect(setActive(adminId,adminAssignment,branchId,false)).rejects.toMatchObject({ message: "The branch is unavailable" });
      await expect(remove(adminId,adminAssignment,randomUUID())).rejects.toMatchObject({ message: "The branch is unavailable" });
    } finally { await db.query("DELETE FROM user_permission_overrides WHERE id=$1", [deny]); }
  });

  it("denies foreign-company lifecycle and budget without tenant details", async () => {
    const otherCompany = randomUUID();
    await db.query("INSERT INTO companies(id,company_code,name,active) VALUES ($1,$2,'Foreign isolated company',true)", [otherCompany,`C-${otherCompany}`]);
    const target = await emptyBranch(otherCompany);
    await expect(setActive(adminId,adminAssignment,target,false)).rejects.toMatchObject({ message: "The branch is unavailable" });
    await expect(remove(adminId,adminAssignment,target)).rejects.toMatchObject({ message: "The branch is unavailable" });
    await expect(asActor(adminId,adminAssignment,() => db.query(
      "SELECT axora_add_branch_budget($1,$2,$3,1,$4,now())", [adminId,adminAssignment,target,randomUUID()]))).rejects.toMatchObject({ code: "AX002",message: "FORBIDDEN" });
  });

  it("denies missing/mismatched audit identity and inactive actor before lookup", async () => {
    await db.exec("SET ROLE axora_app");
    try { await expect(db.query("SELECT axora_set_branch_active($1,$2,$3,false,now())", [adminId,adminAssignment,branchId])).rejects.toMatchObject({ message: "The branch is unavailable" }); }
    finally { await db.exec("RESET ROLE"); }
    await expect(asActor(branchAdminId,branchAdminAssignment,() => db.query(
      "SELECT axora_set_branch_active($1,$2,$3,false,now())", [adminId,adminAssignment,branchId]))).rejects.toMatchObject({ message: "The branch is unavailable" });
    await db.query("UPDATE users SET active=false WHERE id=$1", [adminId]);
    try { await expect(setActive(adminId,adminAssignment,branchId,false)).rejects.toMatchObject({ message: "The branch is unavailable" }); }
    finally { await db.query("UPDATE users SET active=true WHERE id=$1", [adminId]); }
    await db.query("UPDATE role_assignments SET active=false,revoked_at=now(),revoke_reason='Isolated revocation' WHERE id=$1", [backupAdminAssignment]);
    await expect(setActive(backupAdminId,backupAdminAssignment,branchId,false)).rejects.toMatchObject({ message: "The branch is unavailable" });
    await expect(asActor(backupAdminId,backupAdminAssignment,() => db.query(
      "SELECT axora_add_branch_budget($1,$2,$3,1,$4,now())", [backupAdminId,backupAdminAssignment,branchId,randomUUID()]))).rejects.toMatchObject({ code: "AX002",message: "FORBIDDEN" });
  });

  it("retains active-cart deactivation protection at canonical and legacy boundaries", async () => {
    const target = await emptyBranch();
    const product = randomUUID();
    const cart = randomUUID();
    await db.query(`INSERT INTO products(id,product_code,name,category,unit_of_measure,default_buy_price,default_sell_price)
      VALUES ($1,$2,'Isolated blocker item','Office','unit',1,1)`, [product,`P-${product}`]);
    await db.query("INSERT INTO procurement_carts(id,user_id,company_id,branch_id) VALUES ($1,$2,$3,$4)", [cart,adminId,companyId,target]);
    await db.query(`INSERT INTO procurement_cart_items(cart_id,product_id,quantity,displayed_unit_price,displayed_price_rule_version,currency)
      VALUES ($1,$2,1,1,1,'MYR')`, [cart,product]);
    await expect(setActive(adminId,adminAssignment,target,false)).rejects.toMatchObject({ message: "Finish or clear the active cart before deactivating this branch." });
    await expect(asActor(adminId,adminAssignment,() => db.query(
      "SELECT axora_set_organization_node_active($1,$2,'BRANCH',$3,false,'Isolated legacy guard',now())", [adminId,adminAssignment,target]))).rejects.toMatchObject({ message: "The organization status change is unavailable" });
    await expect(remove(adminId,adminAssignment,target)).rejects.toMatchObject({ message: "Used branches can only be deactivated" });
  });

  it("keeps the complete dependency scan and all canonical operational guard classes", async () => {
    const definition = (await db.query<{ current: string; legacy: string; removal: string }>(`SELECT
      pg_get_functiondef('axora_set_branch_active(uuid,uuid,uuid,boolean,timestamptz)'::regprocedure) AS current,
      pg_get_functiondef('axora_set_organization_node_active(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure) AS legacy,
      pg_get_functiondef('axora_delete_empty_branch(uuid,uuid,uuid,timestamptz)'::regprocedure) AS removal`)).rows[0];
    for (const relation of ["delivery_jobs","procurement_carts","procurement_cart_items","requests"]) {
      expect(definition.current).toContain(`public.${relation}`);
      expect(definition.legacy).toContain(`public.${relation}`);
    }
    expect(definition.legacy).toContain("public.departments");
    expect(definition.legacy).toContain("public.delivery_locations");
    expect(definition.legacy).toContain("public.role_assignments");
    expect(definition.removal).toContain("pg_catalog.pg_constraint");
    expect(definition.removal).toContain("public.organization_structure_history");
  });
});

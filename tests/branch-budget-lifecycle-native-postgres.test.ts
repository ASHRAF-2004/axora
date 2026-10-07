import { randomUUID } from "node:crypto";
import { Client,type ClientConfig } from "pg";
import { afterAll,beforeAll,describe,expect,it } from "vitest";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for isolated native verification.`);
  return value;
}

nativeDescribe.sequential("branch budget/lifecycle native authorization serialization", () => {
  let admin: Client;
  let adminConfig: ClientConfig;
  let appConfig: ClientConfig;
  const companyId = randomUUID();
  const actorId = randomUUID();
  const assignmentId = randomUUID();
  const appName = `axora-native-branch-boundary-${randomUUID()}`;

  async function connect(config: ClientConfig) {
    const connection = new Client(config);
    await connection.connect();
    await connection.query("SET statement_timeout='15s'; SET lock_timeout='10s'");
    return connection;
  }
  async function transaction(actor = actorId,assignment = assignmentId) {
    const connection = await connect(appConfig);
    await connection.query("BEGIN");
    await connection.query(`SELECT set_config('axora.user_id',$1,true),
      set_config('axora.role_assignment_id',$2,true),
      set_config('axora.change_reason','Native isolated branch boundary',true)`, [actor,assignment]);
    return connection;
  }
  async function branch() {
    const id = randomUUID();
    await admin.query(`INSERT INTO branches(id,branch_code_id,company_id,name,branch_code,delivery_address,city,active)
      VALUES ($1,$2,$3,$2,$2,'Isolated native destination','Cyberjaya',true)`, [id,`NB-${id}`,companyId]);
    return id;
  }
  async function add(connection: Client,target: string,amount: string,commandId: string) {
    return (await connection.query<{ result: { changed: boolean } }>(
      "SELECT axora_add_branch_budget($1,$2,$3,$4,$5,now()) AS result", [actorId,assignmentId,target,amount,commandId])).rows[0].result;
  }
  async function blockedBy(blockedPid: number,blockerPid: number) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if ((await admin.query<{ blocked: boolean }>("SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked", [blockedPid,blockerPid])).rows[0].blocked) return;
      await new Promise((resolve) => setTimeout(resolve,25));
    }
    throw new Error("The expected isolated branch authority lock wait was not observed.");
  }

  beforeAll(async () => {
    const host = required("AXORA_NATIVE_POSTGRES_HOST");
    const database = required("AXORA_NATIVE_POSTGRES_DATABASE");
    const port = Number(required("AXORA_NATIVE_POSTGRES_PORT"));
    // Reject arbitrary destinations before opening a socket or writing fixtures.
    if ((host !== "127.0.0.1" && host !== "::1") || database !== "axora_native_ci"
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535 || required("DB_USER") !== "axora_app") {
      throw new Error("Branch boundary races require the loopback isolated native CI database.");
    }
    const shared = { host,port,database,ssl: false,connectionTimeoutMillis: 2_000,application_name: appName };
    adminConfig = { ...shared,user: required("AXORA_NATIVE_POSTGRES_ADMIN_USER"),password: required("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD") };
    appConfig = { ...shared,user: "axora_app",password: required("DB_PASSWORD") };
    admin = await connect(adminConfig);
    expect((await admin.query<{ database: string }>("SELECT current_database() AS database")).rows[0].database).toBe("axora_native_ci");
    await admin.query("INSERT INTO companies(id,company_code,name,active,contractual_ceiling) VALUES ($1,$2,'Native isolated boundary',true,2)", [companyId,`NBC-${companyId}`]);
    await admin.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version)
      SELECT $1,$2,'Native isolated Company Administrator','not-a-real-hash',id,$3,false,now(),'COMPANY','ACTIVE',true,1
      FROM roles WHERE role_key='COMPANY_ADMIN'`, [actorId,`${actorId}@example.test`,companyId]);
    await admin.query("INSERT INTO company_memberships(user_id,company_id,status,is_primary) VALUES ($1,$2,'ACTIVE',true)", [actorId,companyId]);
    await admin.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,active)
      SELECT $1,$2,id,'COMPANY',$3,true FROM roles WHERE role_key='COMPANY_ADMIN'`, [assignmentId,actorId,companyId]);
  }, 30_000);
  afterAll(async () => { await admin?.end(); });

  it("serializes concurrent same-command additions exactly once with Wallet and recurring unchanged", async () => {
    const target = await branch();
    const command = randomUUID();
    const first = await transaction();
    const second = await transaction();
    try {
      const results = await Promise.all([first,second].map(async (connection) => {
        const result = await add(connection,target,"0.01",command);
        await connection.query("COMMIT");
        return result;
      }));
      expect(results.map((result) => result.changed).sort()).toEqual([false,true]);
      expect((await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM branch_budget_add_commands WHERE actor_user_id=$1 AND command_id=$2", [actorId,command])).rows[0].count).toBe(1);
      const totals = (await admin.query<{ allocated: string; recurring: string; wallet: number }>(`SELECT
        (SELECT sum(balance.allocated)::text FROM v_budget_period_balances balance JOIN budget_periods period ON period.id=balance.budget_period_id
          JOIN budget_accounts account ON account.id=balance.budget_account_id
          WHERE balance.company_id=$1 AND period.status='ACTIVE' AND account.level_type<>'COMPANY') AS allocated,
        (SELECT sum(recurring_allocation)::text FROM budget_accounts WHERE company_id=$1 AND level_type<>'COMPANY') AS recurring,
        (SELECT count(*)::int FROM company_wallet_ledger_entries WHERE company_id=$1) AS wallet`, [companyId])).rows[0];
      expect(totals).toEqual({ allocated: "0.01",recurring: "0.00",wallet: 0 });
    } finally {
      await Promise.all([first.query("ROLLBACK"),second.query("ROLLBACK")]);
      await Promise.all([first.end(),second.end()]);
    }
  });

  it("serializes separate branch additions against the unchanged contractual ceiling", async () => {
    const targets = await Promise.all([branch(),branch()]);
    const first = await transaction();
    const second = await transaction();
    try {
      const results = await Promise.all([first,second].map(async (connection,index) => {
        try {
          await add(connection,targets[index],"1.50",randomUUID());
          await connection.query("COMMIT");
          return "ADDED";
        } catch (error) {
          await connection.query("ROLLBACK");
          return error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
        }
      }));
      expect(results.sort()).toEqual(["ADDED","AX004"]);
      expect((await admin.query<{ within: boolean }>(`SELECT sum(balance.allocated)<=2 AS within
        FROM v_budget_period_balances balance JOIN budget_periods period ON period.id=balance.budget_period_id
        JOIN budget_accounts account ON account.id=balance.budget_account_id
        WHERE balance.company_id=$1 AND period.status='ACTIVE' AND account.level_type<>'COMPANY'`, [companyId])).rows[0].within).toBe(true);
    } finally {
      await Promise.all([first.query("ROLLBACK"),second.query("ROLLBACK")]);
      await Promise.all([first.end(),second.end()]);
    }
  });

  it("observes newly committed budget/lifecycle DENY after waiting on the permission writer's user lock", async () => {
    const target = await branch();
    const budget = await transaction();
    const lifecycle = await transaction();
    const writer = await connect(adminConfig);
    const budgetDeny = randomUUID();
    const lifecycleDeny = randomUUID();
    try {
      const budgetPid = (await budget.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const lifecyclePid = (await lifecycle.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const writerPid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actorId]);
      await writer.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,
        company_id,starts_at,active,reason,changed_by) SELECT fixture.id,$1,permission.id,'DENY','COMPANY',$2,
        clock_timestamp(),true,'Native isolated concurrent DENY',$1 FROM
        (VALUES ($3::uuid,'budget.increase'),($4::uuid,'organization.branch.manage')) fixture(id,code)
        JOIN permissions permission ON permission.permission_code=fixture.code`, [actorId,companyId,budgetDeny,lifecycleDeny]);
      // Consume both rejection paths immediately, including cleanup failures.
      const adding = add(budget,target,"0.01",randomUUID()).then(() => "ADDED",(error: { code?: string }) => error.code);
      const changing = lifecycle.query("SELECT axora_set_branch_active($1,$2,$3,false,now())", [actorId,assignmentId,target])
        .then(() => "CHANGED",(error: { message?: string }) => error.message);
      await blockedBy(budgetPid,writerPid);
      await blockedBy(lifecyclePid,writerPid);
      await writer.query("COMMIT");
      expect(await adding).toBe("AX002");
      expect(await changing).toBe("The branch is unavailable");
      expect((await admin.query<{ active: boolean }>("SELECT active FROM branches WHERE id=$1", [target])).rows[0].active).toBe(true);
    } finally {
      // Release the blocker before awaiting rollback queued behind blocked SQL.
      await writer.query("ROLLBACK");
      await Promise.all([budget.query("ROLLBACK"),lifecycle.query("ROLLBACK")]);
      await Promise.all([budget.end(),lifecycle.end(),writer.end()]);
      await admin.query("DELETE FROM user_permission_overrides WHERE id IN ($1,$2)", [budgetDeny,lifecycleDeny]);
    }
  });

  it("does not retain a custom lifecycle GRANT that expired during an authority lock wait", async () => {
    const auditor = randomUUID();
    const auditorAssignment = randomUUID();
    const grant = randomUUID();
    const target = await branch();
    await admin.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,account_kind,account_status,active,auth_version)
      SELECT $1,$2,'Native isolated grant expiry actor','not-a-real-hash',id,$3,false,now(),'COMPANY','ACTIVE',true,1
      FROM roles WHERE role_key='AUDITOR'`, [auditor,`${auditor}@example.test`,companyId]);
    await admin.query("INSERT INTO company_memberships(user_id,company_id,status,is_primary) VALUES ($1,$2,'ACTIVE',true)", [auditor,companyId]);
    await admin.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,active)
      SELECT $1,$2,id,'COMPANY',$3,true FROM roles WHERE role_key='AUDITOR'`, [auditorAssignment,auditor,companyId]);
    await admin.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,
      company_id,starts_at,ends_at,active,reason,changed_by)
      SELECT $1,$2,id,'GRANT','COMPANY',$3,clock_timestamp(),clock_timestamp()+interval '5 seconds',true,
      'Native isolated expiring lifecycle grant',$4 FROM permissions WHERE permission_code='organization.branch.manage'`,
    [grant,auditor,companyId,actorId]);
    const changing = await transaction(auditor,auditorAssignment);
    const writer = await connect(adminConfig);
    try {
      const changingPid = (await changing.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const beganAt = (await changing.query<{ started: string }>("SELECT transaction_timestamp()::text AS started")).rows[0].started;
      expect((await admin.query<{ active: boolean }>("SELECT starts_at<=$2::timestamptz AND ends_at>$2::timestamptz AND ends_at>clock_timestamp() AS active FROM user_permission_overrides WHERE id=$1", [grant,beganAt])).rows[0].active).toBe(true);
      const writerPid = (await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      await writer.query("BEGIN");
      await writer.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [auditor]);
      const mutation = changing.query("SELECT axora_set_branch_active($1,$2,$3,false,now())", [auditor,auditorAssignment,target])
        .then(() => "CHANGED",(error: { message?: string }) => error.message);
      await blockedBy(changingPid,writerPid);
      let expired = false;
      for (let attempt = 0; attempt < 140; attempt += 1) {
        expired = (await admin.query<{ expired: boolean }>("SELECT clock_timestamp()>ends_at AS expired FROM user_permission_overrides WHERE id=$1", [grant])).rows[0].expired;
        if (expired) break;
        await new Promise((resolve) => setTimeout(resolve,50));
      }
      expect(expired).toBe(true);
      await writer.query("COMMIT");
      expect(await mutation).toBe("The branch is unavailable");
      expect((await admin.query<{ active: boolean }>("SELECT active FROM branches WHERE id=$1", [target])).rows[0].active).toBe(true);
    } finally {
      await writer.query("ROLLBACK");
      await changing.query("ROLLBACK");
      await Promise.all([writer.end(),changing.end()]);
      await admin.query("DELETE FROM user_permission_overrides WHERE id=$1", [grant]);
    }
  }, 15_000);
});

import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  CompanyCreationCommandConflictError,
  createCompanyWithoutBrand,
} from "@/lib/company-lifecycle";

const native = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true" ? describe : describe.skip;
const ambiguousSql = `SELECT public.axora_create_company_direct(
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
) AS snapshot`;

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Isolated native company creation configuration is incomplete");
  return value;
}

native.sequential("no-brand company creation native parameter inference", () => {
  let admin: Client;
  let appConfig: ClientConfig;
  const owner = {
    id: randomUUID(), roleAssignmentId: randomUUID(), email: "native-creation@example.test",
    name: "Synthetic native creation owner", role: "PLATFORM_OWNER",
    accountKind: "PLATFORM", scopeType: "PLATFORM", isOwner: true, authVersion: 1,
  } satisfies AuthenticatedSessionUser;

  beforeAll(async () => {
    const host = required("AXORA_NATIVE_POSTGRES_HOST");
    const port = Number(required("AXORA_NATIVE_POSTGRES_PORT"));
    if ((host !== "127.0.0.1" && host !== "::1")
      || !Number.isSafeInteger(port) || port < 1 || port > 65_535
      || required("AXORA_NATIVE_POSTGRES_DATABASE") !== "axora_native_ci"
      || required("DB_HOST") !== host || required("DB_PORT") !== required("AXORA_NATIVE_POSTGRES_PORT")
      || required("DB_NAME") !== "axora_native_ci" || required("DB_USER") !== "axora_app"
      || process.env.DEMO_MODE !== "false" || process.env.DATABASE_URL || process.env.DB_PASSWORD_FILE) {
      throw new Error("Company creation tests require the isolated native CI database");
    }
    const base = { host, port, database: "axora_native_ci", ssl: false,
      connectionTimeoutMillis: 5_000, statement_timeout: 10_000 } satisfies ClientConfig;
    appConfig = { ...base, user: "axora_app", password: required("DB_PASSWORD") };
    admin = new Client({ ...base, user: required("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: required("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD") });
    await admin.connect();
    const account = await admin.query(`INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,
      account_kind,account_status,active,auth_version,account_setup_completed_at)
      SELECT $1,$2,$3,'not-a-real-hash',id,true,'PLATFORM','ACTIVE',true,1,now()
      FROM roles WHERE role_key='PLATFORM_OWNER'`, [owner.id, `${owner.id}@example.test`, owner.name]);
    expect(account.rowCount).toBe(1);
    const assignment = await admin.query(`INSERT INTO role_assignments(id,user_id,role_id,scope_type,active)
      SELECT $1,$2,id,'PLATFORM',true FROM roles WHERE role_key='PLATFORM_OWNER'`, [owner.roleAssignmentId, owner.id]);
    expect(assignment.rowCount).toBe(1);
  }, 30_000);

  afterAll(async () => {
    await global.__axoraPool?.end();
    delete global.__axoraPool;
    await admin?.end();
  });

  it("proves unknown node-pg parameters choose the defaulted branded overload", async () => {
    const app = new Client(appConfig);
    const commandId = randomUUID();
    const name = `Native ambiguous no-brand ${randomUUID()}`;
    await app.connect();
    try {
      await app.query(`PREPARE native_no_brand_ambiguous AS ${ambiguousSql}`);
      const prepared = await app.query<{ lastType: string }>(`SELECT parameter_types[12]::text AS "lastType"
        FROM pg_prepared_statements WHERE name='native_no_brand_ambiguous'`);
      expect(prepared.rows[0].lastType).toBe("text");
      await app.query("DEALLOCATE native_no_brand_ambiguous");
      await app.query("BEGIN");
      await app.query(`SELECT set_config('axora.user_id',$1,true),
        set_config('axora.role_assignment_id',$2,true),
        set_config('axora.change_reason','Synthetic no-brand overload regression',true)`, [owner.id, owner.roleAssignmentId]);
      // A Date is serialized without a parameter OID by the real pg driver,
      // unlike a successful literal now() SQL probe which pins timestamptz.
      await expect(app.query(ambiguousSql, [owner.id, owner.roleAssignmentId, commandId,
        name, name, "", "", null, "Synthetic contact", "Monthly", null, new Date()]))
        .rejects.toMatchObject({ code: "P0001" });
    } finally {
      await app.query("ROLLBACK");
      await app.end();
    }
    const count = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM companies WHERE creation_command_id=$1", [commandId]);
    expect(count.rows[0].count).toBe(0);
  });

  it("creates through the actual adapter, validates its record and preserves replay without funding", async () => {
    const commandId = randomUUID();
    const input = { name: `Native typed no-brand ${randomUUID()}`, mainContactName: "Synthetic contact" };
    const created = await createCompanyWithoutBrand(input, owner, commandId);
    expect(created.created).toBe(true);
    if (!("company" in created)) throw new Error("Native creation must return the validated lifecycle record");
    expect(created.company).toMatchObject({ id: created.companyId, name: input.name, status: "ONBOARDING" });
    expect(created.creationLogoId).toBeNull();
    expect(created.creationThemeId).toBeNull();
    await expect(createCompanyWithoutBrand(input, owner, commandId))
      .resolves.toMatchObject({ companyId: created.companyId, created: false });
    await expect(createCompanyWithoutBrand({ ...input, name: "Different native payload" }, owner, commandId))
      .rejects.toBeInstanceOf(CompanyCreationCommandConflictError);
    const state = await admin.query(`SELECT
      (SELECT count(*)::int FROM companies WHERE creation_command_id=$1) AS companies,
      (SELECT count(*)::int FROM company_wallets WHERE company_id=$2) AS wallets,
      (SELECT count(*)::int FROM company_wallet_ledger_entries WHERE company_id=$2) AS wallet_entries,
      (SELECT count(*)::int FROM company_wallet_top_up_requests WHERE company_id=$2) AS top_ups,
      (SELECT count(*)::int FROM budget_ledger_entries WHERE company_id=$2) AS budget_entries,
      (SELECT count(*)::int FROM requests WHERE company_id=$2) AS requests`, [commandId, created.companyId]);
    // Existing INSERT bootstrap provisions an empty Wallet; never fabricate
    // funding, approvals or branch budget allocations just to test creation.
    expect(state.rows[0]).toEqual({ companies: 1, wallets: 1, wallet_entries: 0, top_ups: 0, budget_entries: 0, requests: 0 });
  });

  it("keeps a committed explicit creation DENY authoritative", async () => {
    const denyId = randomUUID();
    const commandId = randomUUID();
    const denied = await admin.query(`INSERT INTO user_permission_overrides(id,user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by)
      SELECT $1,$2,id,'DENY','PLATFORM',now(),true,'Synthetic company creation DENY',$2
      FROM permissions WHERE permission_code='company.create'`, [denyId, owner.id]);
    expect(denied.rowCount).toBe(1);
    try {
      await expect(createCompanyWithoutBrand({ name: "Denied native company", mainContactName: "Synthetic contact" }, owner, commandId))
        .rejects.toMatchObject({ code: "P0001" });
      const count = await admin.query<{ count: number }>("SELECT count(*)::int AS count FROM companies WHERE creation_command_id=$1", [commandId]);
      expect(count.rows[0].count).toBe(0);
    } finally {
      await admin.query("DELETE FROM user_permission_overrides WHERE id=$1", [denyId]);
    }
  });
});

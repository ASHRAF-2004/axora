import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  company: "b3000000-0000-4000-8000-000000000001",
  otherCompany: "b3000000-0000-4000-8000-000000000002",
  admin: "b3000000-0000-4000-8000-000000000003",
  adminAssignment: "b3000000-0000-4000-8000-000000000004",
  otherAdmin: "b3000000-0000-4000-8000-000000000005",
  otherAssignment: "b3000000-0000-4000-8000-000000000006",
} as const;

const SAME_UTC_AND_LOCAL_DATE_AT = "2026-08-24T10:00:00.000Z";
const DIFFERENT_UTC_AND_LOCAL_DATE_AT = "2026-08-24T19:59:00.000Z";
const ACCOUNT_TIMEZONE = "Asia/Kuala_Lumpur";

type BudgetCommandResult = { status: string };

async function createFundedBranchBudgetFixture() {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db, { through: "112_company_activation_contract_reconciliation.sql" });
  await db.exec(await readFile(new URL("../database/migrations/113_company_admin_branch_location_budget_foundation.sql", import.meta.url), "utf8"));

  const establishedAt = "2026-08-01T00:00:00.000Z";
  await db.query(`
    INSERT INTO companies(id,company_code,name,active,contractual_ceiling,timezone)
    VALUES ($1,'FOUNDATION-A','Foundation tenant',true,0,$3),
      ($2,'FOUNDATION-B','Other tenant',true,0,$3)
  `, [ids.company, ids.otherCompany, ACCOUNT_TIMEZONE]);
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,email_verified_at,account_kind,account_status,active,auth_version
    ) SELECT fixture.id,fixture.email,fixture.name,'not-a-real-hash',role.id,fixture.company_id,
      false,$5::timestamptz,$5::timestamptz,'COMPANY','ACTIVE',true,1
    FROM (VALUES
      ($1::uuid,'foundation-admin@example.test','Foundation administrator',$3::uuid),
      ($2::uuid,'foundation-other@example.test','Other administrator',$4::uuid)
    ) fixture(id,email,name,company_id)
    JOIN roles role ON role.role_key='COMPANY_ADMIN'
  `, [ids.admin, ids.otherAdmin, ids.company, ids.otherCompany, establishedAt]);
  await db.query(`
    INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
    VALUES ($1,$3,'ACTIVE',true,$5),($2,$4,'ACTIVE',true,$5)
  `, [ids.admin, ids.otherAdmin, ids.company, ids.otherCompany, establishedAt]);
  await db.query(`
    INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,active,assigned_at)
    SELECT fixture.assignment_id,fixture.user_id,role.id,'COMPANY',fixture.company_id,true,$7
    FROM (VALUES ($1::uuid,$3::uuid,$5::uuid),($2::uuid,$4::uuid,$6::uuid))
      fixture(assignment_id,user_id,company_id)
    JOIN roles role ON role.role_key='COMPANY_ADMIN'
  `, [
    ids.adminAssignment, ids.otherAssignment, ids.admin, ids.otherAdmin,
    ids.company, ids.otherCompany, establishedAt,
  ]);
  await db.query(`
    INSERT INTO company_wallet_ledger_entries(
      company_id,entry_type,amount_delta,currency,effective_date,business_reference,
      reason,correlation_id,idempotency_key,actor_user_id,actor_role_assignment_id,posted_at
    ) VALUES ($1,'TOP_UP',2000,'MYR',
      ($4::timestamptz AT TIME ZONE $5)::date,'Foundation test funding',
      'Controlled test Wallet funding',gen_random_uuid(),'foundation-wallet-funding',$2,$3,$4)
  `, [ids.company, ids.admin, ids.adminAssignment, establishedAt, ACCOUNT_TIMEZONE]);

  async function asApp<T>(operation: () => Promise<T>) {
    await db.exec("SET ROLE axora_app");
    try { return await operation(); } finally { await db.exec("RESET ROLE"); }
  }

  const branchInput = {
    companyId: ids.company,
    name: "Cyberjaya budget fixture",
    branchCode: "CYB-BUDGET",
    city: "Cyberjaya",
    addressLabel: "Budget fixture entrance, Cyberjaya, Selangor, Malaysia",
    latitude: 2.918829,
    longitude: 101.641169,
    providerId: "axora-osm-klang-valley",
    providerPlaceId: "osm-way-824624308",
    providerAttribution: "© OpenStreetMap contributors",
    contactName: "Operations desk",
    contactPhone: "+60300000000",
    contactEmail: "",
    deliveryInstructions: "Use the guarded entrance",
    notes: "",
    commandId: randomUUID(),
  };
  const created = await asApp(() => db.query<{ result: { branchId: string } }>(
    "SELECT axora_create_branch_with_primary_location($1,$2,$3::jsonb,$4,$5) AS result",
    [ids.admin, ids.adminAssignment, JSON.stringify(branchInput), branchInput.commandId, establishedAt],
  ));
  const branchId = created.rows[0]!.result.branchId;

  async function dateContext(commandAt: string) {
    const result = await db.query<{
      sessionTimezone: string;
      sessionCurrentDate: string;
      accountTimezone: string;
      accountLocalDate: string;
      utcDate: string;
    }>(`
      SELECT current_setting('TimeZone') AS "sessionTimezone",
        CURRENT_DATE::text AS "sessionCurrentDate",
        account.period_timezone AS "accountTimezone",
        ($2::timestamptz AT TIME ZONE account.period_timezone)::date::text AS "accountLocalDate",
        ($2::timestamptz AT TIME ZONE 'UTC')::date::text AS "utcDate"
      FROM budget_accounts account
      WHERE account.branch_id=$1 AND account.level_type='BRANCH'
    `, [branchId, commandAt]);
    return result.rows[0]!;
  }

  async function configureBudget(input: {
    commandAt: string;
    startDate: string;
    commandId?: string;
    amount?: number;
  }) {
    return asApp(() => db.query<{ result: BudgetCommandResult }>(`
      SELECT axora_configure_first_branch_budget(
        $1,$2,$3,$4,'MONTHLY',$5::date,NULL,$6,$7::timestamptz
      ) AS result
    `, [
      ids.admin, ids.adminAssignment, branchId, input.amount ?? 1000,
      input.startDate, input.commandId ?? randomUUID(), input.commandAt,
    ]));
  }

  return { db, asApp, branchId, dateContext, configureBudget };
}

describe.sequential("Company Administrator branch, location and budget foundation", () => {
  let db: PGlite;
  let branchId: string;

  async function asApp<T>(operation: () => Promise<T>) {
    await db.exec("SET ROLE axora_app");
    try { return await operation(); } finally { await db.exec("RESET ROLE"); }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "112_company_activation_contract_reconciliation.sql" });
    await db.exec(await readFile(new URL("../database/migrations/113_company_admin_branch_location_budget_foundation.sql", import.meta.url), "utf8"));
    await db.query(`
      INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES ($1,'FOUNDATION-A','Foundation tenant',true,0),($2,'FOUNDATION-B','Other tenant',true,0)
    `, [ids.company, ids.otherCompany]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,account_status,active,auth_version
      ) SELECT fixture.id,fixture.email,fixture.name,'not-a-real-hash',role.id,fixture.company_id,
        false,now(),now(),'COMPANY','ACTIVE',true,1
      FROM (VALUES
        ($1::uuid,'foundation-admin@example.test','Foundation administrator',$3::uuid),
        ($2::uuid,'foundation-other@example.test','Other administrator',$4::uuid)
      ) fixture(id,email,name,company_id)
      JOIN roles role ON role.role_key='COMPANY_ADMIN'
    `, [ids.admin, ids.otherAdmin, ids.company, ids.otherCompany]);
    await db.query(`
      INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
      VALUES ($1,$3,'ACTIVE',true,now()),($2,$4,'ACTIVE',true,now())
    `, [ids.admin, ids.otherAdmin, ids.company, ids.otherCompany]);
    await db.query(`
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,active,assigned_at)
      SELECT fixture.assignment_id,fixture.user_id,role.id,'COMPANY',fixture.company_id,true,now()
      FROM (VALUES ($1::uuid,$3::uuid,$5::uuid),($2::uuid,$4::uuid,$6::uuid))
        fixture(assignment_id,user_id,company_id)
      JOIN roles role ON role.role_key='COMPANY_ADMIN';
    `, [ids.adminAssignment, ids.otherAssignment, ids.admin, ids.otherAdmin, ids.company, ids.otherCompany]);
    await db.query(`
      INSERT INTO company_wallet_ledger_entries(
        company_id,entry_type,amount_delta,currency,effective_date,business_reference,
        reason,correlation_id,idempotency_key,actor_user_id,actor_role_assignment_id,posted_at
      ) VALUES ($1,'TOP_UP',2000,'MYR',CURRENT_DATE,'Foundation test funding',
        'Controlled test Wallet funding',gen_random_uuid(),'foundation-wallet-funding',$2,$3,now())
    `, [ids.company, ids.admin, ids.adminAssignment]);
  }, 45_000);

  afterAll(async () => { await db.close(); });

  it("upgrades 112 with the additive capabilities and forced-RLS command evidence", async () => {
    const state = await db.query<{ function_count: number; forced_count: number; provider_column: string }>(`
      SELECT
        (SELECT count(*)::int FROM pg_proc procedure JOIN pg_namespace namespace ON namespace.oid=procedure.pronamespace
          WHERE namespace.nspname='public' AND procedure.proname IN (
            'axora_create_branch_with_primary_location','axora_save_branch_delivery_location_v2',
            'axora_update_branch_details','axora_configure_first_branch_budget','axora_branch_budget_funding_state'
          )) AS function_count,
        (SELECT count(*)::int FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
          WHERE namespace.nspname='public' AND relation.relname IN (
            'branch_creation_commands','branch_delivery_location_provider_evidence','branch_details_commands',
            'branch_budget_commands','branch_budget_funding_states'
          ) AND relation.relrowsecurity AND relation.relforcerowsecurity) AS forced_count,
        (SELECT data_type FROM information_schema.columns WHERE table_schema='public'
          AND table_name='delivery_locations' AND column_name='geocoder_provider_id') AS provider_column
    `);
    expect(state.rows[0]).toEqual({ function_count: 5, forced_count: 5, provider_column: "text" });
  });

  it("creates one tenant-bound branch and canonical location atomically and replays safely", async () => {
    const commandId = randomUUID();
    const input = {
      companyId: ids.company, name: "Cyberjaya operations", branchCode: "CYB-OPS", city: "Cyberjaya",
      addressLabel: "Verdi Eco-Dominiums, Cyberjaya, Selangor, Malaysia", latitude: 2.918829,
      longitude: 101.641169, providerId: "axora-osm-klang-valley", providerPlaceId: "osm-way-824624308",
      providerAttribution: "© OpenStreetMap contributors", contactName: "Operations desk",
      contactPhone: "+60300000000", contactEmail: "", deliveryInstructions: "Use the guarded entrance",
      notes: "", commandId,
    };
    const first = await asApp(() => db.query<{ result: { branchId: string } }>(
      "SELECT axora_create_branch_with_primary_location($1,$2,$3::jsonb,$4,now()) AS result",
      [ids.admin, ids.adminAssignment, JSON.stringify(input), commandId],
    ));
    const replay = await asApp(() => db.query<{ result: { branchId: string } }>(
      "SELECT axora_create_branch_with_primary_location($1,$2,$3::jsonb,$4,now()) AS result",
      [ids.admin, ids.adminAssignment, JSON.stringify(input), commandId],
    ));
    branchId = first.rows[0]!.result.branchId;
    expect(replay.rows[0]!.result.branchId).toBe(branchId);
    const persisted = await db.query<{ branches: number; locations: number; provider: string; commands: number }>(`
      SELECT (SELECT count(*)::int FROM branches WHERE id=$1 AND company_id=$2) AS branches,
        (SELECT count(*)::int FROM delivery_locations WHERE branch_id=$1 AND company_id=$2
          AND active AND is_primary AND latitude IS NOT NULL AND longitude IS NOT NULL) AS locations,
        (SELECT geocoder_provider_id FROM delivery_locations WHERE branch_id=$1 AND active AND is_primary) AS provider,
        (SELECT count(*)::int FROM branch_creation_commands WHERE branch_id=$1) AS commands
    `, [branchId, ids.company]);
    expect(persisted.rows[0]).toEqual({ branches: 1, locations: 1, provider: "axora-osm-klang-valley", commands: 1 });

    await asApp(() => db.query(
      `SELECT axora_save_branch_delivery_location_v2(
        $1,$2,$3,'Corrected entrance, Cyberjaya',2.918830,101.641170,
        'Use the corrected entrance','DELIVERY_LOCATION_UPDATED',$4,now(),
        'axora-osm-klang-valley','osm-way-824624308','© OpenStreetMap contributors'
      )`,
      [ids.admin, ids.adminAssignment, branchId, randomUUID()],
    ));
    const synchronized = await db.query<{ branchAddress: string; locationAddress: string }>(`
      SELECT branch.delivery_address AS "branchAddress",location.address AS "locationAddress"
      FROM branches branch JOIN delivery_locations location ON location.branch_id=branch.id
      WHERE branch.id=$1 AND location.active AND location.is_primary
    `, [branchId]);
    expect(synchronized.rows[0]).toEqual({
      branchAddress: "Corrected entrance, Cyberjaya",
      locationAddress: "Corrected entrance, Cyberjaya",
    });

    await expect(asApp(() => db.query(
      "SELECT axora_create_branch_with_primary_location($1,$2,$3::jsonb,$4,now())",
      [ids.admin, ids.adminAssignment, JSON.stringify({ ...input, companyId: ids.otherCompany, branchCode: "FORGED" }), randomUUID()],
    ))).rejects.toThrow(/unavailable/);
  });

  it("updates branch contact details without accepting browser-controlled company scope", async () => {
    const commandId = randomUUID();
    const input = {
      name: "Cyberjaya fulfilment", city: "Cyberjaya", contactName: "Receiving desk",
      contactPhone: "+60311112222", contactEmail: "receiving@example.test", notes: "Call on arrival",
    };
    const first = await asApp(() => db.query<{ result: { status: string } }>(
      "SELECT axora_update_branch_details($1,$2,$3,$4::jsonb,$5,now()) AS result",
      [ids.admin, ids.adminAssignment, branchId, JSON.stringify(input), commandId],
    ));
    const replay = await asApp(() => db.query<{ result: { status: string } }>(
      "SELECT axora_update_branch_details($1,$2,$3,$4::jsonb,$5,now()) AS result",
      [ids.admin, ids.adminAssignment, branchId, JSON.stringify(input), commandId],
    ));
    expect(first.rows[0]!.result.status).toBe("UPDATED");
    expect(replay.rows[0]!.result.status).toBe("UPDATED");
    const persisted = await db.query<{ name: string; contactPhone: string; commands: number; history: number }>(`
      SELECT branch.name,branch.contact_phone AS "contactPhone",
        (SELECT count(*)::int FROM branch_details_commands command WHERE command.branch_id=branch.id) AS commands,
        (SELECT count(*)::int FROM organization_structure_history history
          WHERE history.node_type='BRANCH' AND history.node_id=branch.id
            AND history.reason='BRANCH_DETAILS_UPDATED') AS history
      FROM branches branch WHERE branch.id=$1
    `, [branchId]);
    expect(persisted.rows[0]).toEqual({
      name: "Cyberjaya fulfilment", contactPhone: "+60311112222", commands: 1, history: 1,
    });
    await expect(asApp(() => db.query(
      "SELECT axora_update_branch_details($1,$2,$3,$4::jsonb,$5,now())",
      [ids.otherAdmin, ids.otherAssignment, branchId, JSON.stringify({ ...input, name: "Forged" }), randomUUID()],
    ))).rejects.toThrow(/unavailable/);
  });

  it("uses the exact account-local date at same-date and UTC/local midnight boundaries", async () => {
    const sameDateFixture = await createFundedBranchBudgetFixture();
    const boundaryFixture = await createFundedBranchBudgetFixture();
    try {
      const sameDate = await sameDateFixture.dateContext(SAME_UTC_AND_LOCAL_DATE_AT);
      expect(sameDate).toMatchObject({
        accountTimezone: ACCOUNT_TIMEZONE,
        accountLocalDate: "2026-08-24",
        utcDate: "2026-08-24",
      });
      const sameDateCreated = await sameDateFixture.configureBudget({
        commandAt: SAME_UTC_AND_LOCAL_DATE_AT,
        startDate: sameDate.accountLocalDate,
      });
      expect(sameDateCreated.rows[0]!.result.status).toBe("CREATED");

      const boundary = await boundaryFixture.dateContext(DIFFERENT_UTC_AND_LOCAL_DATE_AT);
      expect(boundary).toMatchObject({
        accountTimezone: ACCOUNT_TIMEZONE,
        accountLocalDate: "2026-08-25",
        utcDate: "2026-08-24",
      });
      await expect(boundaryFixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: boundary.utcDate,
      })).rejects.toThrow(/command is invalid/);
      const boundaryCreated = await boundaryFixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: boundary.accountLocalDate,
      });
      expect(boundaryCreated.rows[0]!.result.status).toBe("CREATED");
    } finally {
      await sameDateFixture.db.close();
      await boundaryFixture.db.close();
    }
  }, 45_000);

  it("creates the first funded period once, keeps Wallet unchanged, and makes the active period immutable", async () => {
    const fixture = await createFundedBranchBudgetFixture();
    try {
      const date = await fixture.dateContext(DIFFERENT_UTC_AND_LOCAL_DATE_AT);
      const commandId = randomUUID();
      const first = await fixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: date.accountLocalDate,
        commandId,
      });
      const replay = await fixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: date.accountLocalDate,
        commandId,
      });
      const state = await fixture.db.query<{ allocations: number; wallet: string; amount: string }>(`
        SELECT (SELECT count(*)::int FROM budget_ledger_entries entry JOIN budget_accounts account
          ON account.id=entry.budget_account_id WHERE account.branch_id=$1 AND entry.entry_type='INITIAL_ALLOCATION') AS allocations,
          (SELECT available_balance::text FROM v_company_wallet_balances WHERE company_id=$2) AS wallet,
          (SELECT recurring_allocation::text FROM budget_accounts WHERE branch_id=$1 AND level_type='BRANCH') AS amount
      `, [fixture.branchId, ids.company]);
      expect(first.rows[0]!.result.status).toBe("CREATED");
      expect(replay.rows[0]!.result.status).toBe("ALREADY_CREATED");
      expect(state.rows[0]).toEqual({ allocations: 1, wallet: "2000.00", amount: "1000.00" });
      await expect(fixture.db.query(`UPDATE budget_periods SET starts_at=starts_at-interval '1 day'
        WHERE budget_account_id=(SELECT id FROM budget_accounts WHERE branch_id=$1) AND status='ACTIVE'`, [fixture.branchId]))
        .rejects.toThrow(/immutable/);
      const second = await fixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: date.accountLocalDate,
        amount: 1200,
      });
      expect(second.rows[0]!.result.status).toBe("ACTIVE_IMMUTABLE");
    } finally {
      await fixture.db.close();
    }
  }, 45_000);

  it("leaves the active period intact and retries idempotently when renewal Wallet funding is unavailable", async () => {
    const fixture = await createFundedBranchBudgetFixture();
    try {
      const date = await fixture.dateContext(DIFFERENT_UTC_AND_LOCAL_DATE_AT);
      const configured = await fixture.configureBudget({
        commandAt: DIFFERENT_UTC_AND_LOCAL_DATE_AT,
        startDate: date.accountLocalDate,
      });
      expect(configured.rows[0]!.result.status).toBe("CREATED");
      await fixture.db.query(`
        INSERT INTO company_wallet_ledger_entries(
          company_id,entry_type,amount_delta,currency,effective_date,business_reference,
          reason,correlation_id,idempotency_key,actor_user_id,actor_role_assignment_id,posted_at
        ) VALUES ($1,'ADJUSTMENT',-2000,'MYR',
          ($4::timestamptz AT TIME ZONE $5)::date,'Controlled funding test',
          'Controlled test removes disposable fixture funding',gen_random_uuid(),
          'foundation-wallet-funding-removal',$2,$3,$4)
      `, [ids.company, ids.admin, ids.adminAssignment, DIFFERENT_UTC_AND_LOCAL_DATE_AT, ACCOUNT_TIMEZONE]);
      const target = await fixture.db.query<{ accountId: string; periodId: string; refreshAt: string }>(`
        SELECT account.id AS "accountId",period.id AS "periodId",
          (period.ends_at+interval '1 second')::text AS "refreshAt"
        FROM budget_accounts account JOIN budget_periods period ON period.budget_account_id=account.id
        WHERE account.branch_id=$1 AND period.status='ACTIVE'
      `, [fixture.branchId]);
      const { accountId, periodId, refreshAt } = target.rows[0]!;
      await fixture.asApp(() => fixture.db.query("SELECT axora_reconcile_budget_refresh_jobs($1)", [refreshAt]));

      let jobId = "";
      let retryAt = refreshAt;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await fixture.asApp(() => fixture.db.query(
          "SELECT * FROM axora_claim_budget_refresh_jobs('foundation-worker',50,90,$1)",
          [retryAt],
        ));
        const lease = await fixture.db.query<{ jobId: string; leaseToken: string }>(`
          SELECT id AS "jobId",lease_token::text AS "leaseToken" FROM budget_refresh_jobs
          WHERE budget_account_id=$1 AND state='LEASED'
        `, [accountId]);
        expect(lease.rows).toHaveLength(1);
        jobId = lease.rows[0]!.jobId;
        const processed = await fixture.asApp(() => fixture.db.query<{
          result: { state: string; errorCode: string; nextAttemptAt: string };
        }>(`
          SELECT axora_process_budget_refresh_job('foundation-worker',$1,$2,$3) AS result
        `, [jobId, lease.rows[0]!.leaseToken, retryAt]));
        expect(processed.rows[0]!.result).toMatchObject({ state: "RETRY", errorCode: "FUNDING_REQUIRED" });
        retryAt = processed.rows[0]!.result.nextAttemptAt;
      }

      const state = await fixture.db.query<{
        activePeriods: number;
        successors: number;
        fundingStates: number;
        notifications: number;
        attempts: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM budget_periods WHERE budget_account_id=$1 AND status='ACTIVE') AS "activePeriods",
          (SELECT count(*)::int FROM budget_periods WHERE previous_period_id=$2) AS successors,
          (SELECT count(*)::int FROM branch_budget_funding_states WHERE budget_account_id=$1 AND state='FUNDING_REQUIRED') AS "fundingStates",
          (SELECT count(*)::int FROM in_app_notifications WHERE dedupe_key LIKE $3||'%') AS notifications,
          (SELECT attempt_count FROM budget_refresh_jobs WHERE id=$4) AS attempts
      `, [accountId, periodId, `budget-funding-required:${accountId}:${periodId}`, jobId]);
      expect(state.rows[0]).toEqual({ activePeriods: 1, successors: 0, fundingStates: 1, notifications: 1, attempts: 0 });
      const visible = await fixture.asApp(() => fixture.db.query<{ payload: { state: string } }>(`
        SELECT axora_branch_budget_funding_state($1,$2,$3,$4) AS payload
      `, [ids.admin, ids.adminAssignment, fixture.branchId, retryAt]));
      expect(visible.rows[0]!.payload.state).toBe("FUNDING_REQUIRED");
      const foreign = await fixture.asApp(() => fixture.db.query<{ payload: unknown }>(`
        SELECT axora_branch_budget_funding_state($1,$2,$3,$4) AS payload
      `, [ids.otherAdmin, ids.otherAssignment, fixture.branchId, retryAt]));
      expect(foreign.rows[0]!.payload).toBeNull();
    } finally {
      await fixture.db.close();
    }
  }, 45_000);
});

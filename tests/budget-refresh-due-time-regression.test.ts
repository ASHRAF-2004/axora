import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe.sequential("budget refresh due-time regression", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "133_supervisor_demo_hardening.sql" });
    await applyDemoSeed(db);
  }, 90_000);

  afterAll(async () => { await db.close(); });

  it("does not consume retries before due time and requeues only a prematurely exhausted job", async () => {
    const source = await db.query<{
      companyId: string;
      accountId: string;
      periodId: string;
      scheduleId: string;
      futureDueAt: string;
      expiredDueAt: string;
    }>(`
      SELECT account.company_id AS "companyId",account.id AS "accountId",
        period.id AS "periodId",schedule.id AS "scheduleId",
        (now()+interval '2 days')::text AS "futureDueAt",
        (now()-interval '2 days')::text AS "expiredDueAt"
      FROM budget_accounts account
      JOIN budget_periods period ON period.budget_account_id=account.id
      JOIN budget_cycle_schedules schedule ON schedule.budget_account_id=account.id
      WHERE account.level_type='BRANCH' AND account.active AND period.status='ACTIVE'
      ORDER BY account.id,period.id,schedule.id LIMIT 1
    `);
    const fixture = source.rows[0]!;
    const futureJob = "d4000000-0000-4000-8000-000000000001";
    const exhaustedJob = "d4000000-0000-4000-8000-000000000002";
    await db.query(`
      INSERT INTO budget_refresh_jobs(
        id,company_id,budget_account_id,budget_period_id,schedule_id,due_at,state,next_attempt_at
      ) VALUES
        ($1,$2,$3,$4,$5,$6,'PENDING',$6),
        ($7,$2,$3,$4,$5,$8,'DEAD_LETTER',$8)
    `, [futureJob, fixture.companyId, fixture.accountId, fixture.periodId,
      fixture.scheduleId, fixture.futureDueAt, exhaustedJob, fixture.expiredDueAt]);
    await db.query(`
      INSERT INTO budget_refresh_job_events(
        job_id,company_id,event_type,attempt_count,occurred_at
      ) VALUES ($1,$2,'DEAD_LETTERED',6,$3::timestamptz-interval '1 second')
    `, [exhaustedJob, fixture.companyId, fixture.expiredDueAt]);

    const beforeRepair = await db.query<{ entries: number; allocated: string; wallet: string }>(`
      SELECT
        (SELECT count(*)::int FROM budget_ledger_entries WHERE budget_account_id=$1) AS entries,
        (SELECT COALESCE(sum(allocated),0)::text FROM v_budget_period_balances
          WHERE company_id=$2) AS allocated,
        (SELECT available_balance::text FROM v_company_wallet_balances WHERE company_id=$2) AS wallet
    `, [fixture.accountId, fixture.companyId]);

    await db.exec(await readFile(
      new URL("../database/migrations/134_budget_refresh_and_dashboard_consistency.sql", import.meta.url),
      "utf8",
    ));

    const afterRepair = await db.query<{ entries: number; allocated: string; wallet: string }>(`
      SELECT
        (SELECT count(*)::int FROM budget_ledger_entries WHERE budget_account_id=$1) AS entries,
        (SELECT COALESCE(sum(allocated),0)::text FROM v_budget_period_balances
          WHERE company_id=$2) AS allocated,
        (SELECT available_balance::text FROM v_company_wallet_balances WHERE company_id=$2) AS wallet
    `, [fixture.accountId, fixture.companyId]);
    expect(afterRepair.rows[0]).toEqual(beforeRepair.rows[0]);

    const repaired = await db.query<{ state: string; attempts: number; evidence: number }>(`
      SELECT job.state,job.attempt_count AS attempts,
        (SELECT count(*)::int FROM budget_refresh_job_events event
          WHERE event.job_id=job.id AND event.event_type='REQUEUED_PREMATURE_CLAIM') AS evidence
      FROM budget_refresh_jobs job WHERE job.id=$1
    `, [exhaustedJob]);
    expect(repaired.rows[0]).toEqual({ state: "RETRY", attempts: 0, evidence: 1 });

    const early = await db.query<{ job_id: string }>(`
      SELECT job_id::text FROM axora_claim_budget_refresh_jobs('due-time-worker',50,90,now())
    `);
    expect(early.rows.map((row) => row.job_id)).not.toContain(futureJob);

    const atDue = await db.query<{ job_id: string }>(`
      SELECT job_id::text FROM axora_claim_budget_refresh_jobs(
        'due-time-worker',50,90,$1::timestamptz+interval '1 second'
      )
    `, [fixture.futureDueAt]);
    expect(atDue.rows.map((row) => row.job_id)).toContain(futureJob);
  });
});

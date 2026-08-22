import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ownerId = "a9100000-0000-4000-8000-000000000001";
const operatorId = "a9100000-0000-4000-8000-000000000002";
const companyId = "a9200000-0000-4000-8000-000000000001";
const ownerAssignment = "a9300000-0000-4000-8000-000000000001";
const operatorAssignment = "a9300000-0000-4000-8000-000000000002";

describe("Axora email usage tracking migration", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await db.exec(`
      INSERT INTO companies(
        id,company_code,name,industry,main_contact_name,main_contact_email,
        main_contact_phone,billing_contact_name,billing_contact_email,
        billing_contact_phone,billing_address,payment_terms,billing_cycle,active
      ) VALUES (
        '${companyId}','USAGE-1','Usage fixture','Testing','Fixture owner',
        'usage@example.test','000','Fixture billing','billing@example.test',
        '000','Fixture address','Standard billing terms','Monthly',true
      );
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${ownerId}','usage-owner@example.test','Usage Owner','not-a-real-hash',id,true,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO users(id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status)
      SELECT '${operatorId}','usage-operator@example.test','Usage Operator','not-a-real-hash',id,false,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OPERATIONS';
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,assigned_at)
      SELECT '${ownerAssignment}','${ownerId}',id,'PLATFORM','2026-01-01T00:00:00Z' FROM roles WHERE role_key='PLATFORM_OWNER';
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,assigned_at)
      SELECT '${operatorAssignment}','${operatorId}',id,'PLATFORM','2026-01-01T00:00:00Z' FROM roles WHERE role_key='PLATFORM_OPERATIONS';
      SELECT set_config('axora.user_id','${ownerId}',false),
        set_config('axora.role_assignment_id','${ownerAssignment}',false);
    `);
  });

  afterAll(async () => db.close());

  async function usage(at: string) {
    const result = await db.query<{ usage: {
      initialized: boolean;
      monthlyUsed: number;
      dailyUsed: number;
      lastCountedAt: string | null;
    } }>("SELECT axora_current_email_usage($1::timestamptz) AS usage", [at]);
    return result.rows[0]!.usage;
  }

  async function addAcceptedInvitation(
    index: number,
    acceptedAt: string,
    providerName: "resend" | "test" = "resend",
  ) {
    const suffix = String(index).padStart(12, "0");
    const userId = `a9400000-0000-4000-8000-${suffix}`;
    const invitationId = `a9500000-0000-4000-8000-${suffix}`;
    const token = index.toString(16).padStart(64, "0");
    await db.query(`
      INSERT INTO users(id,email,display_name,password_hash,role_id,company_id,account_kind,account_status)
      SELECT $1,$2,'Usage recipient','not-a-real-hash',id,'${companyId}','COMPANY','INVITED'
      FROM roles WHERE role_key='COMPANY_ADMIN'
    `, [userId, `usage-${index}@example.test`]);
    await db.query(`
      INSERT INTO company_memberships(user_id,company_id,status,is_primary,created_by)
      VALUES ($1,'${companyId}','INVITED',true,'${ownerId}')
    `, [userId]);
    await db.query(`
      INSERT INTO role_assignments(id,user_id,role_id,scope_type,company_id,assigned_at)
      SELECT gen_random_uuid(),$1,id,'COMPANY','${companyId}','2026-01-01T00:00:00Z'
      FROM roles WHERE role_key='COMPANY_ADMIN'
    `, [userId]);
    await db.query(`
      INSERT INTO account_setup_invitations(
        id,user_id,company_id,token_hash,expires_at,email_locale,
        delivery_status,delivery_attempt_count,delivery_attempted_at,sent_at,
        provider_message_id,accepted_provider_name,created_by,created_at,intended_role_id,
        intended_scope_type
      ) VALUES (
        $2,$1,'${companyId}',$3,$4::timestamptz + interval '1 day','en',
        'SENT',1,$4::timestamptz,$4::timestamptz,$5,$6,'${ownerId}',
        $4::timestamptz - interval '1 minute',
        (SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),'COMPANY'
      )
    `, [userId, invitationId, token, acceptedAt, `provider-${index}`, providerName]);
    return invitationId;
  }

  it("has no implicit baseline and initializes the confirmed 8/0 opening once", async () => {
    await expect(usage("2026-08-22T10:00:00Z")).resolves.toMatchObject({
      initialized: false, monthlyUsed: 0, dailyUsed: 0,
    });
    const initialize = () => db.query<{ inserted: boolean }>(`
      INSERT INTO email_usage_opening_baselines(
        provider_name,baseline_at,period_timezone,month_start,
        monthly_opening_used,day_start,daily_opening_used,source,operator_reference
      ) VALUES (
        'resend','2026-08-22T10:00:00Z','UTC','2026-08-01',8,
        '2026-08-22',0,'USER_CONFIRMED_RESEND_DASHBOARD','release-acceptance'
      ) ON CONFLICT(provider_name) DO NOTHING RETURNING true AS inserted
    `);
    await expect(initialize()).resolves.toMatchObject({ rows: [{ inserted: true }] });
    await expect(initialize()).resolves.toMatchObject({ rows: [] });
    await expect(usage("2026-08-22T10:00:00Z")).resolves.toMatchObject({
      initialized: true, monthlyUsed: 8, dailyUsed: 0,
    });
    await expect(db.query(`
      INSERT INTO email_usage_opening_baselines(
        provider_name,baseline_at,period_timezone,month_start,
        monthly_opening_used,day_start,daily_opening_used,source,operator_reference
      ) VALUES ('other','2026-08-22T10:00:00Z','UTC','2026-08-01',99,
        '2026-08-22',99,'USER_CONFIRMED_RESEND_DASHBOARD','invalid-provider')
    `)).rejects.toThrow();
  });

  it("counts accepted logical deliveries once and excludes non-accepted states", async () => {
    await addAcceptedInvitation(1, "2026-08-22T10:01:00Z");
    await expect(usage("2026-08-22T10:01:30Z")).resolves.toMatchObject({
      monthlyUsed: 9, dailyUsed: 1,
    });
    await addAcceptedInvitation(2, "2026-08-22T10:02:00Z");
    await expect(usage("2026-08-22T10:02:30Z")).resolves.toMatchObject({
      monthlyUsed: 10, dailyUsed: 2,
    });
    await addAcceptedInvitation(5, "2026-08-22T10:03:00Z", "test");

    const sentId = "a9500000-0000-4000-8000-000000000002";
    await db.exec(`
      INSERT INTO email_delivery_attempts(
        delivery_kind,delivery_id,event_type,template_key,template_version,
        provider_name,provider_agent,attempt_number,outcome,correlation_id,
        attempted_at
      ) VALUES
        ('ACCOUNT_SETUP','${sentId}','invitation.sent','internal-user-invitation',1,
          'resend','axora-auth',1,'sent',gen_random_uuid(),'2026-08-22T10:02:00Z'),
        ('ACCOUNT_SETUP','${sentId}','invitation.sent','internal-user-invitation',1,
          'resend','axora-auth',2,'sent',gen_random_uuid(),'2026-08-22T10:02:01Z'),
        ('TRANSACTIONAL',gen_random_uuid(),'password.reset','password-reset',1,
          'resend','axora-auth',1,'retry',gen_random_uuid(),'2026-08-22T10:03:00Z'),
        ('WORKFLOW',gen_random_uuid(),'invoice.ready','invoice-ready',1,
          'resend','axora-documents',1,'failed',gen_random_uuid(),'2026-08-22T10:04:00Z');
    `);
    await expect(usage("2026-08-22T10:05:00Z")).resolves.toMatchObject({
      monthlyUsed: 10, dailyUsed: 2,
    });
  });

  it("resets deterministically at UTC day and month boundaries", async () => {
    await addAcceptedInvitation(3, "2026-08-23T00:00:01Z");
    await expect(usage("2026-08-23T00:01:00Z")).resolves.toMatchObject({
      monthlyUsed: 11, dailyUsed: 1,
    });
    await addAcceptedInvitation(4, "2026-09-01T00:00:01Z");
    await expect(usage("2026-09-01T00:01:00Z")).resolves.toMatchObject({
      monthlyUsed: 1, dailyUsed: 1,
    });
  });

  it("allows only an active Platform Owner to read and denies raw app writes", async () => {
    await db.exec("SET ROLE axora_app");
    await expect(db.query("SELECT * FROM email_usage_opening_baselines"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query(`INSERT INTO email_usage_opening_baselines(
      provider_name,baseline_at,period_timezone,month_start,monthly_opening_used,
      day_start,daily_opening_used,source,operator_reference
    ) VALUES ('resend',now(),'UTC',date_trunc('month',now())::date,0,
      now()::date,0,'USER_CONFIRMED_RESEND_DASHBOARD','app-write')`))
      .rejects.toThrow(/permission denied/i);
    await db.exec(`SELECT set_config('axora.user_id','${operatorId}',false),
      set_config('axora.role_assignment_id','${operatorAssignment}',false)`);
    await expect(db.query("SELECT axora_current_email_usage(now())"))
      .rejects.toThrow(/unavailable/i);
    await db.exec(`SELECT set_config('axora.user_id','${ownerId}',false),
      set_config('axora.role_assignment_id','${ownerAssignment}',false)`);
    await expect(db.query("SELECT axora_current_email_usage(now())"))
      .resolves.toMatchObject({ rows: [expect.any(Object)] });
    await db.exec("RESET ROLE");
  });

  it("upgrades migration 108 additively", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(upgrade, { through: "108_resend_quota_snapshot.sql" });
      await upgrade.exec(await readFile(new URL(
        "../database/migrations/109_axora_email_usage_tracking.sql",
        import.meta.url,
      ), "utf8"));
      await expect(upgrade.query(`SELECT to_regclass('public.resend_quota_snapshot') AS provider_snapshot,
        to_regclass('public.email_usage_opening_baselines') AS internal_baseline`))
        .resolves.toMatchObject({ rows: [{
          provider_snapshot: "resend_quota_snapshot",
          internal_baseline: "email_usage_opening_baselines",
        }] });
    } finally {
      await upgrade.close();
    }
  }, 45_000);
});

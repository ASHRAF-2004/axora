import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

interface ActorFixture {
  actor_id: string;
  assignment_id: string;
  email: string;
}

const commandIds = {
  pause: "70000000-0000-4000-8000-000000000001",
  resume: "70000000-0000-4000-8000-000000000002",
  health: "70000000-0000-4000-8000-000000000003",
  missing: "70000000-0000-4000-8000-000000000004",
  delivery: "70000000-0000-4000-8000-000000000099",
};
const assignmentIds = {
  owner: "70000000-0000-4000-8000-000000000010",
  company: "70000000-0000-4000-8000-000000000011",
};
const userIds = {
  owner: "70000000-0000-4000-8000-000000000020",
  company: "70000000-0000-4000-8000-000000000021",
};

describe("transactional email operations migration", () => {
  let db: PGlite;
  let owner: ActorFixture;
  let companyUser: ActorFixture;
  let applied: string[];

  async function assume(actor: ActorFixture) {
    await db.exec("SET ROLE axora_app");
    await db.query(`
      SELECT set_config('axora.user_id',$1,false),
        set_config('axora.role_assignment_id',$2,false),
        set_config('axora.correlation_id','email-operations-test',false)
    `, [actor.actor_id, actor.assignment_id]);
  }

  async function reset() {
    await db.exec("RESET ROLE");
    await db.query(`
      SELECT set_config('axora.user_id','',false),
        set_config('axora.role_assignment_id','',false),
        set_config('axora.correlation_id','',false)
    `);
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    applied = await applyMigrations(db);
    await applyDemoSeed(db);

    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT
        '${userIds.owner}','email-operations-owner@example.test',
        'Email operations owner','not-a-real-hash',role.id,true,'PLATFORM',
        'ACTIVE',now()
      FROM roles role WHERE role.role_key='PLATFORM_OWNER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT
        '${userIds.company}','email-operations-company@example.test',
        'Email operations company user','not-a-real-hash',role.id,company.id,
        false,'COMPANY','ACTIVE',now()
      FROM roles role CROSS JOIN LATERAL (
        SELECT id FROM companies ORDER BY id LIMIT 1
      ) company
      WHERE role.role_key='COMPANY_ADMIN';
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at
      )
      SELECT account.id,account.company_id,'ACTIVE',true,now()
      FROM users account WHERE account.id='${userIds.company}';
      INSERT INTO role_assignments(id,user_id,role_id,scope_type)
      SELECT '${assignmentIds.owner}',account.id,account.role_id,'PLATFORM'
      FROM users account WHERE account.id='${userIds.owner}';
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id
      )
      SELECT '${assignmentIds.company}',account.id,account.role_id,
        'COMPANY',account.company_id
      FROM users account WHERE account.id='${userIds.company}';
    `);
    const owners = await db.query<ActorFixture>(`
      SELECT account.id::text AS actor_id,assignment.id::text AS assignment_id,
        account.email
      FROM users account
      JOIN role_assignments assignment ON assignment.user_id=account.id
      WHERE assignment.id=$1
    `, [assignmentIds.owner]);
    const companyUsers = await db.query<ActorFixture>(`
      SELECT account.id::text AS actor_id,assignment.id::text AS assignment_id,
        account.email
      FROM users account
      JOIN role_assignments assignment ON assignment.user_id=account.id
      WHERE assignment.id=$1
    `, [assignmentIds.company]);
    owner = owners.rows[0];
    companyUser = companyUsers.rows[0];
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("applies last with six provider Agents and private operational evidence", async () => {
    expect(applied.at(-1)).toBe("070_transactional_email_operations.sql");
    const state = await db.query<{
      agents: number;
      event_tables: number;
      queue_view: boolean;
    }>(`
      SELECT
        (SELECT count(*)::integer FROM email_agent_controls) AS agents,
        (SELECT count(*)::integer FROM information_schema.tables
          WHERE table_schema='public' AND table_name IN (
            'email_operations_events','email_agent_control_events',
            'email_resend_versions','email_operator_suppression_events',
            'email_provider_health_snapshots','email_webhook_health_hourly'
          )) AS event_tables,
        to_regclass('public.email_operations_delivery_queue') IS NOT NULL AS queue_view
    `);
    expect(state.rows[0]).toEqual({ agents: 6, event_tables: 6, queue_view: true });
  });

  it("gives axora_app only narrow functions and no direct operational-table reads", async () => {
    const privileges = await db.query<{
      event_read: boolean;
      health_read: boolean;
      snapshot_execute: boolean;
      command_execute: boolean;
    }>(`
      SELECT
        has_table_privilege('axora_app','public.email_operations_events','SELECT')
          AS event_read,
        has_table_privilege('axora_app','public.email_provider_health_snapshots','SELECT')
          AS health_read,
        has_function_privilege(
          'axora_app','public.axora_email_operations_snapshot(jsonb)','EXECUTE'
        ) AS snapshot_execute,
        has_function_privilege(
          'axora_app',
          'public.axora_email_operations_command(uuid,text,text,uuid,text,text,jsonb)',
          'EXECUTE'
        ) AS command_execute
    `);
    expect(privileges.rows[0]).toEqual({
      event_read: false,
      health_read: false,
      snapshot_execute: true,
      command_execute: true,
    });

    await db.exec("SET ROLE axora_app");
    await expect(db.query("SELECT * FROM email_operations_events"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query("SELECT * FROM email_operations_delivery_queue"))
      .rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE");
  });

  it("filters the workspace in PostgreSQL, masks recipients, and denies company users", async () => {
    await assume(owner);
    const workspace = await db.query<{ value: Record<string, unknown> }>(`
      SELECT axora_email_operations_snapshot(
        '{"status":"PENDING","offset":0}'::jsonb
      ) AS value
    `);
    expect(workspace.rows[0].value).toMatchObject({ canManage: true });
    expect(JSON.stringify(workspace.rows[0].value)).not.toContain(owner.email);
    await reset();

    await assume(companyUser);
    await expect(db.query("SELECT axora_email_operations_snapshot('{}'::jsonb)"))
      .rejects.toThrow(/Email operations are unavailable/i);
    await reset();
  });

  it("pauses and resumes an Agent idempotently with append-only evidence", async () => {
    await assume(owner);
    const paused = await db.query<{ value: { changed: boolean; action: string } }>(`
      SELECT axora_email_operations_command(
        $1,'PAUSE_AGENT',NULL,NULL,'axora-budget',$2,'{}'::jsonb
      ) AS value
    `, [commandIds.pause, "Pause budget mail while provider health is investigated"]);
    expect(paused.rows[0].value).toMatchObject({ changed: true, action: "PAUSE_AGENT" });
    const replay = await db.query<{ value: { action: string } }>(`
      SELECT axora_email_operations_command(
        $1,'PAUSE_AGENT',NULL,NULL,'axora-budget',$2,'{}'::jsonb
      ) AS value
    `, [commandIds.pause, "Pause budget mail while provider health is investigated"]);
    expect(replay.rows[0].value).toEqual(paused.rows[0].value);
    await reset();

    const pausedState = await db.query<{ paused: boolean; events: number }>(`
      SELECT control.paused,
        (SELECT count(*)::integer FROM email_operations_events
          WHERE command_id=$1) AS events
      FROM email_agent_controls control WHERE provider_agent='axora-budget'
    `, [commandIds.pause]);
    expect(pausedState.rows[0]).toEqual({ paused: true, events: 1 });

    await assume(owner);
    const resumed = await db.query<{ value: { changed: boolean; action: string } }>(`
      SELECT axora_email_operations_command(
        $1,'RESUME_AGENT',NULL,NULL,'axora-budget',$2,'{}'::jsonb
      ) AS value
    `, [commandIds.resume, "Resume budget mail after provider health validation"]);
    expect(resumed.rows[0].value).toMatchObject({ changed: true, action: "RESUME_AGENT" });
    await reset();

    await expect(db.query(`
      UPDATE email_operations_events SET outcome='NOOP' WHERE command_id=$1
    `, [commandIds.pause])).rejects.toThrow(/append-only/i);
    await expect(db.query(`
      DELETE FROM email_agent_control_events
      WHERE operation_event_id=(
        SELECT id FROM email_operations_events WHERE command_id=$1
      )
    `, [commandIds.pause])).rejects.toThrow(/append-only/i);
  });

  it("records manual provider health provenance and privacy-minimized webhook failures", async () => {
    await assume(owner);
    const health = await db.query<{ value: { action: string; source: string } }>(`
      SELECT axora_email_operations_command(
        $1,'RECORD_PROVIDER_HEALTH',NULL,NULL,NULL,$2,$3::jsonb
      ) AS value
    `, [
      commandIds.health,
      "Record verified provider console health for operations",
      JSON.stringify({
        providerName: "zeptomail",
        source: "MANUAL",
        accountState: "HEALTHY",
        domainState: "VERIFIED",
        configurationState: "HEALTHY",
        domainName: "mail.example.test",
        remainingRecipientUnits: "24000",
        note: "Verified by an authorized operator in the provider console",
      }),
    ]);
    expect(health.rows[0].value).toMatchObject({
      action: "RECORD_PROVIDER_HEALTH",
      source: "MANUAL",
    });
    await db.query(
      "SELECT axora_record_email_webhook_failure('zeptomail','signature_invalid')",
    );
    await reset();

    const evidence = await db.query<{
      source: string;
      remaining_units: number;
      failures: number;
      payload: string;
    }>(`
      SELECT health.source,health.remaining_recipient_units::integer AS remaining_units,
        (SELECT sum(processing_failure_count)::integer
          FROM email_webhook_health_hourly) AS failures,
        (SELECT jsonb_agg(to_jsonb(webhook))::text
          FROM email_webhook_health_hourly webhook) AS payload
      FROM email_provider_health_snapshots health
      JOIN email_operations_events operation
        ON operation.id=health.operation_event_id
      WHERE operation.command_id=$1
    `, [commandIds.health]);
    expect(evidence.rows[0]).toMatchObject({
      source: "MANUAL",
      remaining_units: 24000,
      failures: 1,
    });
    expect(evidence.rows[0].payload).not.toContain("recipient");
    await expect(db.query(`
      UPDATE email_provider_health_snapshots health
      SET source='SUPPORTED_API'
      FROM email_operations_events operation
      WHERE operation.id=health.operation_event_id AND operation.command_id=$1
    `, [commandIds.health])).rejects.toThrow(/append-only/i);
  });

  it("keeps missing delivery actions non-revealing and encodes safe retry, resend, and suppression rules", async () => {
    await assume(owner);
    await expect(db.query(`
      SELECT axora_email_operations_command(
        $1,'CANCEL','WORKFLOW',$2,NULL,$3,'{}'::jsonb
      )
    `, [
      commandIds.missing,
      commandIds.delivery,
      "Cancel a pending workflow delivery after an operator review",
    ])).rejects.toThrow(/Email operation is unavailable/i);
    await reset();

    const definition = await db.query<{ body: string }>(`
      SELECT pg_get_functiondef(
        'public.axora_email_operations_command(uuid,text,text,uuid,text,text,jsonb)'
          ::regprocedure
      ) AS body
    `);
    expect(definition.rows[0].body).toContain("delivery_attempt_count<target.maximum_attempts");
    expect(definition.rows[0].body).toContain("original.template_version+1");
    expect(definition.rows[0].body).toContain("correctionResolved");
    expect(definition.rows[0].body).toContain("recipient_suppressed");
    expect(definition.rows[0].body).toContain("token_ciphertext=NULL");
  });
});

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  user: "71000000-0000-4000-8000-000000000001",
  otherUser: "71000000-0000-4000-8000-000000000002",
  assignment: "71000000-0000-4000-8000-000000000003",
  otherAssignment: "71000000-0000-4000-8000-000000000004",
  event: "71000000-0000-4000-8000-000000000005",
  notification: "71000000-0000-4000-8000-000000000006",
  command: "71000000-0000-4000-8000-000000000007",
  preferenceCommand: "71000000-0000-4000-8000-000000000008",
  aggregate: "71000000-0000-4000-8000-000000000009",
  correlation: "71000000-0000-4000-8000-000000000010",
};

describe("P2-05 notification centre migration", () => {
  let db: PGlite;
  let companyId: string;

  async function assume(userId: string, assignmentId: string) {
    await db.exec("SET ROLE axora_app");
    await db.query(`
      SELECT set_config('axora.user_id',$1,false),
        set_config('axora.role_assignment_id',$2,false),
        set_config('axora.correlation_id','notification-centre-test',false)
    `, [userId, assignmentId]);
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
    await applyMigrations(db);
    await applyDemoSeed(db);
    const company = await db.query<{ id: string }>(`
      SELECT id::text FROM companies WHERE active ORDER BY id LIMIT 1
    `);
    companyId = company.rows[0].id;
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at,account_setup_completed_at
      ) SELECT
        '${ids.user}','notification-user@example.test','Notification User',
        'not-a-real-hash',role.id,'${companyId}',false,'COMPANY','ACTIVE',
        now(),now()
      FROM roles role WHERE role.role_key='AUDITOR';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at,account_setup_completed_at
      ) SELECT
        '${ids.otherUser}','notification-other@example.test','Other User',
        'not-a-real-hash',role.id,'${companyId}',false,'COMPANY','ACTIVE',
        now(),now()
      FROM roles role WHERE role.role_key='AUDITOR';
      INSERT INTO user_profiles(
        user_id,display_name,preferred_locale,profile_completed_at
      ) VALUES
        ('${ids.user}','Notification User','en',now()),
        ('${ids.otherUser}','Other User','en',now());
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at
      ) VALUES
        ('${ids.user}','${companyId}','ACTIVE',true,now()),
        ('${ids.otherUser}','${companyId}','ACTIVE',true,now());
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id
      ) SELECT '${ids.assignment}','${ids.user}',role.id,'COMPANY','${companyId}'
        FROM roles role WHERE role.role_key='AUDITOR';
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id
      ) SELECT '${ids.otherAssignment}','${ids.otherUser}',role.id,'COMPANY','${companyId}'
        FROM roles role WHERE role.role_key='AUDITOR';
      INSERT INTO workflow_events(
        id,company_id,aggregate_type,aggregate_id,event_key,event_version,
        actor_user_id,actor_kind,correlation_id,idempotency_key,occurred_at
      ) VALUES (
        '${ids.event}','${companyId}','request','${ids.aggregate}',
        'approval.needed',1,'${ids.user}','COMPANY','${ids.correlation}',
        'notification-centre:approval-needed',now()
      );
    `);
  }, 30_000);

  afterAll(async () => {
    await db.close();
  });

  it("removes direct table capabilities and exposes only narrow operations", async () => {
    const grants = await db.query<{
      raw_read: boolean;
      raw_write: boolean;
      snapshot: boolean;
      command: boolean;
      insert_capability: boolean;
      forced_rls: number;
      append_only: number;
    }>(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.table_privileges
          WHERE grantee='axora_app'
            AND table_name IN (
              'in_app_notifications','notification_preferences',
              'company_notification_preferences','notification_reminders',
              'notification_commands','notification_state_events'
            ) AND privilege_type='SELECT') AS raw_read,
        EXISTS (SELECT 1 FROM information_schema.table_privileges
          WHERE grantee='axora_app'
            AND table_name IN (
              'in_app_notifications','notification_preferences',
              'company_notification_preferences','notification_reminders',
              'notification_commands','notification_state_events'
            ) AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE'))
          AS raw_write,
        has_function_privilege('axora_app',
          'axora_notification_center_snapshot(uuid,uuid,jsonb,timestamptz)',
          'EXECUTE') AS snapshot,
        has_function_privilege('axora_app',
          'axora_notification_command(uuid,uuid,uuid,text,jsonb,timestamptz)',
          'EXECUTE') AS command,
        has_function_privilege('axora_app',
          'axora_insert_in_app_notification(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,timestamptz)',
          'EXECUTE') AS insert_capability,
        (SELECT count(*)::int FROM pg_class
          WHERE relname IN (
            'in_app_notifications','notification_preferences',
            'company_notification_preferences','notification_reminders',
            'notification_commands','notification_state_events'
          ) AND relrowsecurity AND relforcerowsecurity) AS forced_rls,
        (SELECT count(*)::int FROM pg_trigger WHERE tgname IN (
          'notification_commands_append_only',
          'notification_state_events_append_only',
          'notification_email_relations_append_only'
        ) AND NOT tgisinternal) AS append_only
    `);
    expect(grants.rows[0]).toEqual({
      raw_read: false,
      raw_write: false,
      snapshot: true,
      command: true,
      insert_capability: true,
      forced_rls: 6,
      append_only: 3,
    });
  });

  it("deduplicates authoritative events and filters by exact live recipient", async () => {
    await assume(ids.user, ids.assignment);
    const first = await db.query<{ notification_id: string; created: boolean }>(`
      SELECT notification_id::text,created
      FROM axora_insert_in_app_notification(
        $1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,now()
      )
    `, [
      ids.notification,
      companyId,
      ids.user,
      ids.event,
      "approval.needed",
      "notification-centre:approval-needed",
      "Approval required",
      "A request needs an authorized decision.",
      "HIGH",
      "/notifications",
    ]);
    const retry = await db.query<{ notification_id: string; created: boolean }>(`
      SELECT notification_id::text,created
      FROM axora_insert_in_app_notification(
        $1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,now()
      )
    `, [
      "71000000-0000-4000-8000-000000000099",
      companyId,
      ids.user,
      ids.event,
      "approval.needed",
      "notification-centre:approval-needed",
      "Approval required",
      "A request needs an authorized decision.",
      "HIGH",
      "/notifications",
    ]);
    expect(first.rows[0]).toEqual({ notification_id: ids.notification, created: true });
    expect(retry.rows[0]).toEqual({ notification_id: ids.notification, created: false });
    const ownerSnapshot = await db.query<{ snapshot: { notifications: unknown[] } }>(`
      SELECT axora_notification_center_snapshot(
        $1,$2,'{}'::jsonb,now()
      ) AS snapshot
    `, [ids.user, ids.assignment]);
    expect(ownerSnapshot.rows[0].snapshot.notifications).toHaveLength(1);
    await expect(db.query("SELECT * FROM in_app_notifications")).rejects.toThrow();
    await reset();

    await assume(ids.otherUser, ids.otherAssignment);
    const otherSnapshot = await db.query<{ snapshot: { notifications: unknown[] } }>(`
      SELECT axora_notification_center_snapshot(
        $1,$2,'{}'::jsonb,now()
      ) AS snapshot
    `, [ids.otherUser, ids.otherAssignment]);
    expect(otherSnapshot.rows[0].snapshot.notifications).toHaveLength(0);
    await reset();
  });

  it("keeps read commands idempotent and materializes one referenced reminder", async () => {
    await assume(ids.user, ids.assignment);
    const first = await db.query<{ result: { changed: boolean; stateVersion: number } }>(`
      SELECT axora_notification_command(
        $1,$2,$3,'MARK_READ',jsonb_build_object('notificationId',$4::uuid),now()
      ) AS result
    `, [ids.user, ids.assignment, ids.command, ids.notification]);
    const retry = await db.query<{ result: { changed: boolean; stateVersion: number } }>(`
      SELECT axora_notification_command(
        $1,$2,$3,'MARK_READ',jsonb_build_object('notificationId',$4::uuid),now()
      ) AS result
    `, [ids.user, ids.assignment, ids.command, ids.notification]);
    expect(first.rows[0].result).toEqual(retry.rows[0].result);
    expect(first.rows[0].result.changed).toBe(true);
    await reset();

    await db.query(`
      UPDATE notification_reminders SET due_at=created_at
      WHERE original_notification_id=$1
    `, [ids.notification]);
    await assume(ids.user, ids.assignment);
    const snapshot = await db.query<{
      snapshot: { notifications: Array<{ reminderOfNotificationId?: string }> };
    }>(`
      SELECT axora_notification_center_snapshot(
        $1,$2,'{}'::jsonb,now()+interval '1 second'
      ) AS snapshot
    `, [ids.user, ids.assignment]);
    expect(snapshot.rows[0].snapshot.notifications).toHaveLength(2);
    expect(snapshot.rows[0].snapshot.notifications.some(
      (item) => item.reminderOfNotificationId === ids.notification,
    )).toBe(true);
    await reset();
  });

  it("enforces mandatory email policy and revokes all rows with the role assignment", async () => {
    await assume(ids.user, ids.assignment);
    await db.query(`
      SELECT axora_notification_command(
        $1,$2,$3,'SAVE_USER_PREFERENCE',jsonb_build_object(
          'eventKey','approval.needed','emailEnabled',false,
          'deliverySchedule','WEEKLY','reminderHours',0
        ),now()
      )
    `, [ids.user, ids.assignment, ids.preferenceCommand]);
    const snapshot = await db.query<{
      snapshot: { preferences: Array<{
        eventKey: string; mandatoryEmail: boolean; emailEnabled: boolean;
        deliverySchedule: string;
      }> };
    }>(`
      SELECT axora_notification_center_snapshot($1,$2,'{}'::jsonb,now()) AS snapshot
    `, [ids.user, ids.assignment]);
    expect(snapshot.rows[0].snapshot.preferences.find(
      (item) => item.eventKey === "approval.needed",
    )).toMatchObject({
      mandatoryEmail: true,
      emailEnabled: true,
      deliverySchedule: "IMMEDIATE",
    });
    await reset();

    expect((await db.query<{ cancels: boolean }>(`
      SELECT axora_notification_reminder_should_cancel(
        'approval.needed','request.rejected'
      ) AS cancels
    `)).rows[0].cancels).toBe(true);
    await db.query(`
      UPDATE role_assignments SET active=false,revoked_at=now()
      WHERE id=$1
    `, [ids.assignment]);
    await assume(ids.user, ids.assignment);
    const revoked = await db.query<{ snapshot: unknown }>(`
      SELECT axora_notification_center_snapshot($1,$2,'{}'::jsonb,now()) AS snapshot
    `, [ids.user, ids.assignment]);
    expect(revoked.rows[0].snapshot).toBeNull();
    await reset();
  });
});

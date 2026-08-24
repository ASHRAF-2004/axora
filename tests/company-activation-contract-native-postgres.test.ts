import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { approveCompanyVerification } from "@/lib/company-onboarding";
import { activateCompany } from "@/lib/company-lifecycle";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;
const PENDING_HASH = "$2b$12$WuY.R47gEaitrj7J5zwZzutoX6T8co.PmnoE28TzRlWv93Cmxd0By";

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

nativeDescribe("company activation contract native PostgreSQL", () => {
  let admin: Client | undefined;
  let appConfig: ClientConfig;
  let owner: AuthenticatedSessionUser;
  const companyIds: string[] = [];

  async function createCompanyFixture(label: string) {
    if (!admin) throw new Error("Native activation fixture is unavailable.");
    const companyId = randomUUID();
    const administratorId = randomUUID();
    const administratorAssignmentId = randomUUID();
    const invitationId = randomUUID();
    companyIds.push(companyId);
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Activation contract ${label} fixture`,
      ]);
      await admin.query(`
        INSERT INTO companies(
          id,company_code,name,legal_name,main_contact_name,industry_code,
          default_locale,timezone,active,lifecycle_status,lifecycle_version,
          portal_access_enabled,verification_status,is_publicly_listed
        ) VALUES (
          $1,$2,$3,$3,'Activation owner','OTHER','en','Asia/Kuala_Lumpur',
          false,'COMPANY_REVIEW',1,false,'DRAFT',false
        )
      `, [companyId, `N112-${label}-${companyId.slice(0, 6)}`, `Native ${label}`]);
      await admin.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,active,
          company_id,account_setup_completed_at,auth_version,account_kind,account_status
        ) VALUES (
          $1,$2,$3,$4,(SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),
          false,true,$5,NULL,1,'COMPANY','INVITED'
        )
      `, [
        administratorId,
        `native-activation-${label}-${administratorId}@example.test`,
        `Native ${label} Administrator`,
        PENDING_HASH,
        companyId,
      ]);
      await admin.query(`
        INSERT INTO account_credentials(
          user_id,password_hash,password_algorithm,password_changed_at,credential_version
        ) VALUES ($1,NULL,NULL,NULL,1)
      `, [administratorId]);
      await admin.query(`
        INSERT INTO user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
      `, [administratorId, `Native ${label} Administrator`]);
      await admin.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,created_by
        ) VALUES ($1,$2,'INVITED',true,$3)
      `, [administratorId, companyId, owner.id]);
      await admin.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
        ) VALUES ($1,$2,(SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),
          'COMPANY',$3,true,$4,now())
      `, [administratorAssignmentId, administratorId, companyId, owner.id]);
      await admin.query(`
        INSERT INTO account_setup_invitations(
          id,user_id,company_id,token_hash,expires_at,created_by,email_locale,
          intended_role_id,intended_scope_type
        ) VALUES (
          $1,$2,$3,$4,now()+interval '1 day',$5,'en',
          (SELECT id FROM roles WHERE role_key='COMPANY_ADMIN'),'COMPANY'
        )
      `, [invitationId, administratorId, companyId, randomUUID().replaceAll("-", "").padEnd(64, "a"), owner.id]);
      await admin.query(`
        UPDATE account_setup_invitations
        SET delivery_status='SENDING',delivery_attempt_count=1,
          delivery_attempted_at=now()
        WHERE id=$1
      `, [invitationId]);
      await admin.query(`
        UPDATE account_setup_invitations
        SET delivery_status='SENT',sent_at=now(),provider_message_id=$2,
          accepted_provider_name='test'
        WHERE id=$1
      `, [invitationId, `native-${label}`]);
      await admin.query(`
        UPDATE users SET password_hash='argon2id-test-hash',
          account_setup_completed_at=now(),account_status='ACTIVE',
          auth_version=auth_version+1
        WHERE id=$1
      `, [administratorId]);
      await admin.query(`
        UPDATE account_credentials
        SET password_hash='argon2id-test-hash',password_algorithm='argon2id',
          password_changed_at=now(),credential_version=2
        WHERE user_id=$1
      `, [administratorId]);
      await admin.query(`
        UPDATE company_memberships SET status='ACTIVE',joined_at=now()
        WHERE user_id=$1 AND company_id=$2
      `, [administratorId, companyId]);
      await admin.query(`
        UPDATE account_setup_invitations
        SET consumed_at=now(),
          terms_policy_version='account-terms-2026-08-08',terms_accepted_at=now(),
          privacy_policy_version='account-privacy-2026-08-08',privacy_accepted_at=now()
        WHERE id=$1
      `, [invitationId]);
      await admin.query(
        "SELECT axora_complete_company_administrator_setup($1,now())",
        [invitationId],
      );
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return companyId;
  }

  beforeAll(async () => {
    const port = Number(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"));
    const database = requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE");
    admin = new Client({
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),
      port,
      database,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
      ssl: false,
    });
    appConfig = {
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),
      port,
      database,
      user: "axora_app",
      password: requiredEnvironment("DB_PASSWORD"),
      ssl: false,
    };
    await admin.connect();
    const ownerId = randomUUID();
    const ownerAssignmentId = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        "Activation contract native Owner fixture",
      ]);
      await admin.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,active,
          account_setup_completed_at,auth_version,account_kind,account_status
        ) VALUES (
          $1,$2,'Activation Contract Owner','not-a-real-hash',
          (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),true,true,
          now(),1,'PLATFORM','ACTIVE'
        )
      `, [ownerId, `native-activation-owner-${ownerId}@example.test`]);
      await admin.query(`
        INSERT INTO account_credentials(
          user_id,password_hash,password_algorithm,password_changed_at,credential_version
        ) VALUES ($1,'not-a-real-hash','bcrypt',now(),1)
      `, [ownerId]);
      await admin.query(`
        INSERT INTO user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,'Activation Contract Owner','en','Asia/Kuala_Lumpur',now())
      `, [ownerId]);
      await admin.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) VALUES ($1,$2,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
          'PLATFORM',true,$2,now())
      `, [ownerAssignmentId, ownerId]);
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    owner = {
      id: ownerId,
      email: `native-activation-owner-${ownerId}@example.test`,
      name: "Activation Contract Owner",
      role: "PLATFORM_OWNER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      roleAssignmentId: ownerAssignmentId,
      isOwner: true,
      authVersion: 1,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
      effectivePermissions: ["manage_companies"],
    };
  });

  afterAll(async () => {
    await admin?.end();
  });

  it("serializes ten valid commands into one activation and one notification set", async () => {
    if (!admin) throw new Error("Native activation fixture is unavailable.");
    const companyId = await createCompanyFixture("concurrency");
    const blocked = await activateCompany(owner, companyId, 3, "COMPANY_ACTIVATED");
    expect(blocked).toEqual({
      status: "BLOCKED",
      blockedReasons: ["COMPANY_VERIFICATION_REQUIRED"],
    });
    const verification = await approveCompanyVerification(owner, companyId, 1);
    expect(verification.status).toBe("VERIFIED");

    const outcomes = await Promise.all(Array.from({ length: 10 }, () => (
      activateCompany(owner, companyId, 3, "COMPANY_ACTIVATED")
    )));
    expect(outcomes.filter((result) => result.status === "ACTIVATED")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "ALREADY_ACTIVE")).toHaveLength(9);

    const state = await admin.query<{
      active: boolean;
      portal: boolean;
      lifecycle: string;
      publication: boolean;
      history: number;
      events: number;
      notifications: number;
      notificationRecipients: number;
    }>(`
      SELECT company.active,company.portal_access_enabled AS portal,
        company.lifecycle_status AS lifecycle,
        company.is_publicly_listed AS publication,
        (SELECT count(*)::int FROM company_status_history history
          WHERE history.company_id=company.id AND history.to_status='ACTIVE') AS history,
        (SELECT count(*)::int FROM workflow_events event
          WHERE event.company_id=company.id AND event.event_key='company.activated') AS events,
        (SELECT count(*)::int FROM in_app_notifications notification
          WHERE notification.company_id=company.id
            AND notification.event_key='company.activated') AS notifications,
        (SELECT count(DISTINCT notification.recipient_user_id)::int
          FROM in_app_notifications notification
          WHERE notification.company_id=company.id
            AND notification.event_key='company.activated') AS "notificationRecipients"
      FROM companies company WHERE company.id=$1
    `, [companyId]);
    expect(state.rows[0]).toMatchObject({
      active: true,
      portal: true,
      lifecycle: "ACTIVE",
      publication: false,
      history: 1,
      events: 1,
    });
    expect(state.rows[0]?.notifications).toBeGreaterThan(0);
    expect(state.rows[0]?.notifications).toBe(state.rows[0]?.notificationRecipients);
  }, 60_000);

  it("rolls back the complete activation when a downstream statement fails", async () => {
    if (!admin) throw new Error("Native activation fixture is unavailable.");
    const companyId = await createCompanyFixture("rollback");
    await admin.query(
      "UPDATE companies SET verification_status='VERIFIED' WHERE id=$1",
      [companyId],
    );
    const app = new Client(appConfig);
    await app.connect();
    try {
      await app.query("BEGIN");
      const command = await app.query<{ snapshot: { status: string } }>(`
        SELECT axora_activate_company($1,$2,1,$3,3,$4,now()) AS snapshot
      `, [owner.id, owner.roleAssignmentId, companyId, "COMPANY_ACTIVATED"]);
      expect(command.rows[0]?.snapshot.status).toBe("ACTIVATED");
      await expect(app.query("SELECT 1/0")).rejects.toThrow();
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
    const state = await admin.query<{
      active: boolean;
      portal: boolean;
      lifecycle: string;
      history: number;
      events: number;
      notifications: number;
    }>(`
      SELECT company.active,company.portal_access_enabled AS portal,
        company.lifecycle_status AS lifecycle,
        (SELECT count(*)::int FROM company_status_history history
          WHERE history.company_id=company.id AND history.to_status='ACTIVE') AS history,
        (SELECT count(*)::int FROM workflow_events event
          WHERE event.company_id=company.id AND event.event_key='company.activated') AS events,
        (SELECT count(*)::int FROM in_app_notifications notification
          WHERE notification.company_id=company.id
            AND notification.event_key='company.activated') AS notifications
      FROM companies company WHERE company.id=$1
    `, [companyId]);
    expect(state.rows[0]).toEqual({
      active: false,
      portal: false,
      lifecycle: "COMPANY_ADMINISTRATOR_ACTIVATED",
      history: 0,
      events: 0,
      notifications: 0,
    });
  }, 60_000);
});

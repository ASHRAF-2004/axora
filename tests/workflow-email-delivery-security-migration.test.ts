import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  companyOne: "10000000-0000-4000-8000-000000000001",
  companyTwo: "10000000-0000-4000-8000-000000000002",
  branchOne: "20000000-0000-4000-8000-000000000001",
  requestOne: "50000000-0000-4000-8000-000000000001",
  requestTwo: "50000000-0000-4000-8000-000000000002",
  lineOne: "60000000-0000-4000-8000-000000000001",
  lineTwo: "60000000-0000-4000-8000-000000000002",
  supplierOne: "30000000-0000-4000-8000-000000000001",
  supplierTwo: "30000000-0000-4000-8000-000000000002",
  platform: "d9000000-0000-4000-8000-000000000001",
  companyActor: "d9000000-0000-4000-8000-000000000002",
  companyNonActor: "d9000000-0000-4000-8000-000000000003",
  crossCompanyUser: "d9000000-0000-4000-8000-000000000004",
  unverifiedUser: "d9000000-0000-4000-8000-000000000005",
  inactiveUser: "d9000000-0000-4000-8000-000000000006",
  supplierUserOne: "d9000000-0000-4000-8000-000000000007",
  supplierUserTwo: "d9000000-0000-4000-8000-000000000008",
  driverOne: "d9000000-0000-4000-8000-000000000009",
  driverTwo: "d9000000-0000-4000-8000-000000000010",
  rfqOne: "da000000-0000-4000-8000-000000000001",
  rfqTwo: "da000000-0000-4000-8000-000000000002",
  jobOne: "db000000-0000-4000-8000-000000000001",
  jobTwo: "db000000-0000-4000-8000-000000000002",
  assignmentOne: "db100000-0000-4000-8000-000000000001",
  assignmentTwo: "db100000-0000-4000-8000-000000000002",
  requestEvent: "dc000000-0000-4000-8000-000000000001",
  supplierEvent: "dc000000-0000-4000-8000-000000000002",
  driverEvent: "dc000000-0000-4000-8000-000000000003",
};

describe("workflow email delivery migration security", () => {
  let db: PGlite;
  let requestDeliveryId = "";

  const assumeAppUser = async (userId = "") => {
    await db.exec("SET ROLE axora_app");
    await db.query("SELECT set_config('axora.user_id',$1,false)", [userId]);
  };

  const resetRole = async () => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('axora.user_id','',false)");
  };

  const enqueue = async (input: {
    actorId: string;
    eventId: string;
    recipientId: string;
    eventKey: string;
    dedupeKey: string;
    title?: string;
    body?: string;
    routePath?: string;
  }) => {
    await assumeAppUser(input.actorId);
    const result = await db.query<{ id: string | null }>(`
      SELECT axora_enqueue_workflow_email(
        $1,$2,$3,$4,$5,$6,$7,$8
      )::text AS id
    `, [
      ids.companyOne,
      input.eventId,
      input.recipientId,
      input.eventKey,
      input.dedupeKey,
      input.title ?? "Workflow request title",
      input.body ?? "Workflow request body",
      input.routePath ?? "/requests/one",
    ]);
    return result.rows[0]?.id ?? null;
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "073_production_route_stabilization.sql" });
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT '${ids.platform}','workflow-mail-platform@example.test',
        'Workflow mail platform','not-a-real-hash',id,true,'PLATFORM','ACTIVE',now()
      FROM roles WHERE role_key='PLATFORM_OWNER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT '${ids.companyActor}','workflow-mail-actor@example.test',
        'Workflow mail actor','not-a-real-hash',id,'${ids.companyOne}',false,
        'COMPANY','ACTIVE',now()
      FROM roles WHERE role_key='COMPANY_ADMIN';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT '${ids.companyNonActor}','workflow-mail-recipient@example.test',
        'Workflow mail recipient','not-a-real-hash',id,'${ids.companyOne}',false,
        'COMPANY','ACTIVE',now()
      FROM roles WHERE role_key='AUDITOR';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT '${ids.crossCompanyUser}','workflow-mail-cross@example.test',
        'Workflow mail cross tenant','not-a-real-hash',id,'${ids.companyTwo}',false,
        'COMPANY','ACTIVE',now()
      FROM roles WHERE role_key='AUDITOR';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status,email_verified_at
      ) SELECT '${ids.unverifiedUser}','workflow-mail-unverified@example.test',
        'Workflow mail unverified','not-a-real-hash',id,'${ids.companyOne}',false,
        'COMPANY','ACTIVE',NULL
      FROM roles WHERE role_key='AUDITOR';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,active,
        account_kind,account_status,email_verified_at
      ) SELECT '${ids.inactiveUser}','workflow-mail-inactive@example.test',
        'Workflow mail inactive','not-a-real-hash',id,'${ids.companyOne}',false,false,
        'COMPANY','DEACTIVATED',now()
      FROM roles WHERE role_key='AUDITOR';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT '${ids.supplierUserOne}','workflow-mail-supplier-one@example.test',
        'Workflow mail supplier one','not-a-real-hash',id,false,'SUPPLIER','ACTIVE',now()
      FROM roles WHERE role_key='SUPPLIER_USER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT '${ids.supplierUserTwo}','workflow-mail-supplier-two@example.test',
        'Workflow mail supplier two','not-a-real-hash',id,false,'SUPPLIER','ACTIVE',now()
      FROM roles WHERE role_key='SUPPLIER_USER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT '${ids.driverOne}','workflow-mail-driver-one@example.test',
        'Workflow mail driver one','not-a-real-hash',id,false,'DELIVERY','ACTIVE',now()
      FROM roles WHERE role_key='DELIVERY_DRIVER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,
        account_status,email_verified_at
      ) SELECT '${ids.driverTwo}','workflow-mail-driver-two@example.test',
        'Workflow mail driver two','not-a-real-hash',id,false,'DELIVERY','ACTIVE',now()
      FROM roles WHERE role_key='DELIVERY_DRIVER';

      INSERT INTO user_profiles(user_id,display_name,preferred_locale)
      VALUES
        ('${ids.companyActor}','Workflow mail actor','en'),
        ('${ids.companyNonActor}','Workflow mail recipient','ms'),
        ('${ids.crossCompanyUser}','Workflow mail cross tenant','en'),
        ('${ids.unverifiedUser}','Workflow mail unverified','en'),
        ('${ids.inactiveUser}','Workflow mail inactive','en'),
        ('${ids.supplierUserOne}','Workflow mail supplier one','en'),
        ('${ids.supplierUserTwo}','Workflow mail supplier two','en'),
        ('${ids.driverOne}','Workflow mail driver one','ar'),
        ('${ids.driverTwo}','Workflow mail driver two','en');

      INSERT INTO company_memberships(user_id,company_id,status,joined_at)
      VALUES
        ('${ids.companyActor}','${ids.companyOne}','ACTIVE',now()),
        ('${ids.companyNonActor}','${ids.companyOne}','ACTIVE',now()),
        ('${ids.crossCompanyUser}','${ids.companyTwo}','ACTIVE',now()),
        ('${ids.unverifiedUser}','${ids.companyOne}','ACTIVE',now()),
        ('${ids.inactiveUser}','${ids.companyOne}','ACTIVE',now());
      INSERT INTO supplier_memberships(user_id,supplier_id,status)
      VALUES
        ('${ids.supplierUserOne}','${ids.supplierOne}','ACTIVE'),
        ('${ids.supplierUserTwo}','${ids.supplierTwo}','ACTIVE');
      INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
      VALUES
        ('${ids.driverOne}','DRV-WORKFLOW-MAIL-1',true),
        ('${ids.driverTwo}','DRV-WORKFLOW-MAIL-2',true);

      INSERT INTO supplier_rfqs(
        id,company_id,request_line_id,supplier_id,rfq_reference,issued_by,
        idempotency_key,respond_by
      ) VALUES
        ('${ids.rfqOne}','${ids.companyOne}','${ids.lineOne}','${ids.supplierOne}',
          'RFQ-WORKFLOW-MAIL-1','${ids.platform}','rfq:workflow-mail-one',now()+interval '1 day'),
        ('${ids.rfqTwo}','${ids.companyOne}','${ids.lineTwo}','${ids.supplierTwo}',
          'RFQ-WORKFLOW-MAIL-2','${ids.platform}','rfq:workflow-mail-two',now()+interval '1 day');
      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,delivery_address_snapshot,
        idempotency_key,created_by
      ) VALUES
        ('${ids.jobOne}','${ids.companyOne}','${ids.branchOne}','${ids.requestOne}',
          'JOB-WORKFLOW-MAIL-1','Workflow mail address one',
          'job:workflow-mail-one','${ids.platform}'),
        ('${ids.jobTwo}','${ids.companyOne}','${ids.branchOne}','${ids.requestTwo}',
          'JOB-WORKFLOW-MAIL-2','Workflow mail address two',
          'job:workflow-mail-two','${ids.platform}');
      INSERT INTO delivery_job_assignments(
        id,company_id,delivery_job_id,driver_user_id,status,assigned_by
      ) VALUES
        ('${ids.assignmentOne}','${ids.companyOne}','${ids.jobOne}',
          '${ids.driverOne}','ASSIGNED','${ids.platform}'),
        ('${ids.assignmentTwo}','${ids.companyOne}','${ids.jobTwo}',
          '${ids.driverTwo}','ASSIGNED','${ids.platform}');

      INSERT INTO workflow_events(
        id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES
        ('${ids.requestEvent}','${ids.companyOne}','${ids.branchOne}','${ids.requestOne}',
          'request','${ids.requestOne}','request.updated',1,'${ids.companyActor}',
          'COMPANY','${ids.requestOne}','workflow-mail:request',now(),'{}'::jsonb),
        ('${ids.supplierEvent}','${ids.companyOne}','${ids.branchOne}','${ids.requestOne}',
          'supplier-rfq','${ids.rfqOne}','quotation.received',1,
          '${ids.supplierUserOne}','SUPPLIER','${ids.rfqOne}',
          'workflow-mail:supplier',now(),'{}'::jsonb),
        ('${ids.driverEvent}','${ids.companyOne}','${ids.branchOne}','${ids.requestOne}',
          'delivery-job','${ids.jobOne}','delivery.arrived',1,'${ids.driverOne}',
          'DELIVERY','${ids.jobOne}','workflow-mail:driver',now(),
          jsonb_build_object('deliveryJobId','${ids.jobOne}'));
    `);
  }, 30_000);

  afterAll(async () => {
    await resetRole();
    await db.close();
  });

  it("denies every direct outbox operation to the shared application role", async () => {
    await assumeAppUser(ids.companyActor);
    await expect(db.query("SELECT * FROM workflow_email_outbox"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query("INSERT INTO workflow_email_outbox DEFAULT VALUES"))
      .rejects.toThrow(/permission denied/i);
    await expect(db.query("UPDATE workflow_email_outbox SET title='forbidden'"))
      .rejects.toThrow(/permission denied/i);
    await resetRole();

    const privileges = await db.query<{
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_enqueue: boolean;
      can_preference: boolean;
      can_scope_helper: boolean;
      can_email_helper: boolean;
      rls_enabled: boolean;
    }>(`
      SELECT
        has_table_privilege('axora_app','workflow_email_outbox','SELECT') AS can_select,
        has_table_privilege('axora_app','workflow_email_outbox','INSERT') AS can_insert,
        has_table_privilege('axora_app','workflow_email_outbox','UPDATE') AS can_update,
        has_function_privilege(
          'axora_app',
          'axora_enqueue_workflow_email(uuid,uuid,uuid,text,text,text,text,text)',
          'EXECUTE'
        ) AS can_enqueue,
        has_function_privilege(
          'axora_app',
          'axora_workflow_notification_preference(uuid,uuid,uuid,text)',
          'EXECUTE'
        ) AS can_preference,
        has_function_privilege(
          'axora_app',
          'axora_workflow_notification_recipient_is_valid(uuid,uuid,uuid)',
          'EXECUTE'
        ) AS can_scope_helper,
        has_function_privilege(
          'axora_app',
          'axora_workflow_email_recipient_is_valid(uuid,uuid,uuid)',
          'EXECUTE'
        ) AS can_email_helper,
        (SELECT relrowsecurity FROM pg_class
          WHERE oid='workflow_email_outbox'::regclass) AS rls_enabled
    `);
    expect(privileges.rows[0]).toEqual({
      can_select: false,
      can_insert: false,
      can_update: false,
      can_enqueue: true,
      can_preference: true,
      can_scope_helper: false,
      can_email_helper: false,
      rls_enabled: true,
    });
  });

  it("binds enqueue to the event actor, recipient relationship, verified state, preferences, and dedupe", async () => {
    requestDeliveryId = await enqueue({
      actorId: ids.companyActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:request:dedupe",
    }) ?? "";
    expect(requestDeliveryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await enqueue({
      actorId: ids.companyActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:request:dedupe",
    })).toBeNull();

    await expect(enqueue({
      actorId: ids.companyNonActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyNonActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:non-actor",
    })).rejects.toThrow(/only by its event actor/i);
    for (const [recipientId, suffix] of [
      [ids.crossCompanyUser, "cross-tenant"],
      [ids.unverifiedUser, "unverified"],
      [ids.inactiveUser, "inactive"],
    ] as const) {
      expect(await enqueue({
        actorId: ids.companyActor,
        eventId: ids.requestEvent,
        recipientId,
        eventKey: "request.updated",
        dedupeKey: `workflow-mail:${suffix}`,
      }), suffix).toBeNull();
    }

    await resetRole();
    await db.query(`
      INSERT INTO notification_preferences(user_id,event_key,email_enabled)
      VALUES ($1,'request.updated',false)
    `, [ids.companyNonActor]);
    expect(await enqueue({
      actorId: ids.companyActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyNonActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:preference-disabled",
    })).toBeNull();

    expect(await enqueue({
      actorId: ids.supplierUserOne,
      eventId: ids.supplierEvent,
      recipientId: ids.supplierUserOne,
      eventKey: "quotation.received",
      dedupeKey: "workflow-mail:supplier-own",
      title: "Supplier title",
      body: "Supplier body",
    })).toMatch(/^[0-9a-f-]{36}$/);
    expect(await enqueue({
      actorId: ids.supplierUserOne,
      eventId: ids.supplierEvent,
      recipientId: ids.supplierUserTwo,
      eventKey: "quotation.received",
      dedupeKey: "workflow-mail:supplier-unrelated",
    })).toBeNull();

    expect(await enqueue({
      actorId: ids.driverOne,
      eventId: ids.driverEvent,
      recipientId: ids.driverOne,
      eventKey: "delivery.arrived",
      dedupeKey: "workflow-mail:driver-own",
      title: "Driver title",
      body: "Driver body",
    })).toMatch(/^[0-9a-f-]{36}$/);
    expect(await enqueue({
      actorId: ids.driverOne,
      eventId: ids.driverEvent,
      recipientId: ids.driverTwo,
      eventKey: "delivery.arrived",
      dedupeKey: "workflow-mail:driver-unassigned",
    })).toBeNull();

    await resetRole();
    const stored = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM workflow_email_outbox
      WHERE dedupe_key='workflow-mail:request:dedupe'
    `);
    expect(stored.rows[0].count).toBe(1);
  });

  it("exposes only an actor-bound effective preference capability across self-only RLS", async () => {
    await assumeAppUser(ids.companyActor);
    await expect(db.query(`
      SELECT email_enabled FROM notification_preferences WHERE user_id=$1
    `, [ids.companyNonActor])).rejects.toThrow();

    const effective = await db.query<{
      global_in_app_enabled: boolean;
      global_email_enabled: boolean;
      event_preference_exists: boolean;
      event_in_app_enabled: boolean;
      event_email_enabled: boolean;
      delivery_schedule: string;
      recipient_locale: string;
    }>(`
      SELECT global_in_app_enabled,global_email_enabled,
        event_preference_exists,event_in_app_enabled,event_email_enabled,
        delivery_schedule,recipient_locale
      FROM axora_workflow_notification_preference($1,$2,$3,$4)
    `, [
      ids.companyOne,
      ids.requestEvent,
      ids.companyNonActor,
      "request.updated",
    ]);
    expect(effective.rows[0]).toEqual({
      global_in_app_enabled: true,
      global_email_enabled: true,
      event_preference_exists: true,
      event_in_app_enabled: true,
      event_email_enabled: false,
      delivery_schedule: "IMMEDIATE",
      recipient_locale: "ms",
    });

    const unverifiedInApp = await db.query(`
      SELECT * FROM axora_workflow_notification_preference($1,$2,$3,$4)
    `, [ids.companyOne, ids.requestEvent, ids.unverifiedUser, "request.updated"]);
    expect(unverifiedInApp.rows).toHaveLength(1);
    const crossTenant = await db.query(`
      SELECT * FROM axora_workflow_notification_preference($1,$2,$3,$4)
    `, [ids.companyOne, ids.requestEvent, ids.crossCompanyUser, "request.updated"]);
    expect(crossTenant.rows).toHaveLength(0);

    await assumeAppUser(ids.companyNonActor);
    await expect(db.query(`
      SELECT * FROM axora_workflow_notification_preference($1,$2,$3,$4)
    `, [ids.companyOne, ids.requestEvent, ids.companyNonActor, "request.updated"]))
      .rejects.toThrow(/event actor/i);
    await resetRole();
  });

  it("enforces immutable content and lease-bound, terminal delivery transitions", async () => {
    await assumeAppUser();
    const firstClaim = await db.query<{
      delivery_id: string;
      lease_id: string;
      locale: string;
      recipient_email: string;
      title: string;
      body: string;
      route_path: string;
    }>("SELECT * FROM axora_claim_workflow_email(90,3)");
    expect(firstClaim.rows[0]).toMatchObject({
      delivery_id: requestDeliveryId,
      locale: "en",
      recipient_email: "workflow-mail-actor@example.test",
      title: "Workflow request title",
      body: "Workflow request body",
      route_path: "/requests/one",
    });
    const firstLease = firstClaim.rows[0].lease_id;
    const wrongLease = "dd000000-0000-4000-8000-000000000001";
    const wrongCompletion = await db.query<{ recorded: boolean }>(`
      SELECT axora_complete_workflow_email($1,$2,'sent','provider-wrong',NULL,3,60)
        AS recorded
    `, [requestDeliveryId, wrongLease]);
    expect(wrongCompletion.rows[0].recorded).toBe(false);
    await resetRole();

    await expect(db.query(`
      UPDATE workflow_email_outbox SET title='Rewritten title' WHERE id=$1
    `, [requestDeliveryId])).rejects.toThrow(/content are immutable/i);
    await expect(db.query(`
      UPDATE workflow_email_outbox SET delivery_attempt_count=0 WHERE id=$1
    `, [requestDeliveryId])).rejects.toThrow(/cannot decrease/i);

    await assumeAppUser();
    const retry = await db.query<{ recorded: boolean }>(`
      SELECT axora_complete_workflow_email(
        $1,$2,'retry',NULL,'provider_timeout',3,30
      ) AS recorded
    `, [requestDeliveryId, firstLease]);
    expect(retry.rows[0].recorded).toBe(true);
    await resetRole();
    await db.query(`
      UPDATE workflow_email_outbox
      SET delivery_available_at=created_at-interval '4 seconds'
      WHERE id=$1
    `, [requestDeliveryId]);

    await assumeAppUser();
    const secondClaim = await db.query<{
      delivery_id: string;
      lease_id: string;
    }>("SELECT delivery_id,lease_id FROM axora_claim_workflow_email(90,3)");
    expect(secondClaim.rows[0].delivery_id).toBe(requestDeliveryId);
    expect(secondClaim.rows[0].lease_id).not.toBe(firstLease);
    const sent = await db.query<{ recorded: boolean }>(`
      SELECT axora_complete_workflow_email(
        $1,$2,'sent','provider-workflow-1',NULL,3,60
      ) AS recorded
    `, [requestDeliveryId, secondClaim.rows[0].lease_id]);
    expect(sent.rows[0].recorded).toBe(true);
    const replay = await db.query<{ recorded: boolean }>(`
      SELECT axora_complete_workflow_email(
        $1,$2,'failed',NULL,'late_failure',3,60
      ) AS recorded
    `, [requestDeliveryId, secondClaim.rows[0].lease_id]);
    expect(replay.rows[0].recorded).toBe(false);
    await resetRole();

    const finalState = await db.query<{
      status: string;
      attempts: number;
      lease_id: string | null;
      sent: boolean;
      provider_message_id: string | null;
    }>(`
      SELECT delivery_status AS status,delivery_attempt_count AS attempts,
        delivery_lease_id::text AS lease_id,sent_at IS NOT NULL AS sent,
        provider_message_id
      FROM workflow_email_outbox WHERE id=$1
    `, [requestDeliveryId]);
    expect(finalState.rows[0]).toEqual({
      status: "SENT",
      attempts: 2,
      lease_id: null,
      sent: true,
      provider_message_id: "provider-workflow-1",
    });
    await expect(db.query(`
      UPDATE workflow_email_outbox SET delivery_status='PENDING' WHERE id=$1
    `, [requestDeliveryId])).rejects.toThrow(/metadata is final/i);
  });

  it("revalidates preferences at claim and keeps sensitive delivery content out of audit JSON", async () => {
    await resetRole();
    await db.query(`
      UPDATE notification_preferences SET email_enabled=true
      WHERE user_id=$1 AND event_key='request.updated'
    `, [ids.companyNonActor]);
    const preferenceDelivery = await enqueue({
      actorId: ids.companyActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyNonActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:preference-revalidation",
      title: "Preference title",
      body: "Preference body",
    });
    expect(preferenceDelivery).toMatch(/^[0-9a-f-]{36}$/);
    await resetRole();
    await db.query(`
      UPDATE notification_preferences SET email_enabled=false
      WHERE user_id=$1 AND event_key='request.updated'
    `, [ids.companyNonActor]);
    await assumeAppUser();
    await db.query("SELECT * FROM axora_claim_workflow_email(90,3)");
    await resetRole();

    const cancelled = await db.query<{
      status: string;
      error: string | null;
    }>(`
      SELECT delivery_status AS status,last_delivery_error AS error
      FROM workflow_email_outbox WHERE id=$1
    `, [preferenceDelivery]);
    expect(cancelled.rows[0]).toEqual({
      status: "CANCELLED",
      error: "email_preference_disabled",
    });

    const audits = await db.query<{ old_values: unknown; new_values: unknown }>(`
      SELECT old_values,new_values FROM audit_logs
      WHERE entity_type='workflow_email_outbox' AND record_id=$1
      ORDER BY occurred_at,id
    `, [requestDeliveryId]);
    expect(audits.rows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(audits.rows);
    for (const forbidden of [
      "Workflow request title",
      "Workflow request body",
      "/requests/one",
      "workflow-mail-actor@example.test",
      "provider-workflow-1",
      "\"title\"",
      "\"body\"",
      "\"route_path\"",
      "\"provider_message_id\"",
      "\"delivery_lease_id\"",
      "\"dedupe_key\"",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("cancels suppressed workflow email without disabling in-app notification scope", async () => {
    const deliveryId = await enqueue({
      actorId: ids.companyActor,
      eventId: ids.requestEvent,
      recipientId: ids.companyActor,
      eventKey: "request.updated",
      dedupeKey: "workflow-mail:provider-suppression",
      title: "Provider suppression title",
      body: "Provider suppression body",
    });
    expect(deliveryId).toMatch(/^[0-9a-f-]{36}$/);

    await assumeAppUser();
    const suppressedFingerprint = createHash("sha256")
      .update("workflow-mail-actor@example.test")
      .digest("hex");
    const providerMessageFingerprint = createHash("sha256")
      .update("provider-workflow-suppression")
      .digest("hex");
    const event = await db.query<{ recorded: boolean; suppressed: boolean }>(`
      SELECT recorded,suppressed
      FROM axora_record_cloudflare_email_event(
        'de000000-0000-4000-8000-000000000001',
        'MESSAGE_BOUNCED',
        $1,
        $2,
        'HARD',true,now(),1
      )
    `, [suppressedFingerprint, providerMessageFingerprint]);
    expect(event.rows[0]).toEqual({ recorded: true, suppressed: true });
    await resetRole();

    const inAppScope = await db.query<{ valid: boolean }>(`
      SELECT axora_workflow_notification_recipient_is_valid($1,$2,$3) AS valid
    `, [ids.companyOne, ids.requestEvent, ids.companyActor]);
    expect(inAppScope.rows[0].valid).toBe(true);
    const emailScope = await db.query<{ valid: boolean }>(`
      SELECT axora_workflow_email_recipient_is_valid($1,$2,$3) AS valid
    `, [ids.companyOne, ids.requestEvent, ids.companyActor]);
    expect(emailScope.rows[0].valid).toBe(false);

    const cancelled = await db.query<{ status: string; error: string }>(`
      SELECT delivery_status AS status,last_delivery_error AS error
      FROM workflow_email_outbox WHERE id=$1
    `, [deliveryId]);
    expect(cancelled.rows[0]).toEqual({
      status: "CANCELLED",
      error: "recipient_suppressed",
    });
  });
});

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  companyA: "f1290000-0000-4000-8000-000000000001",
  companyB: "f1290000-0000-4000-8000-000000000002",
  adminA: "f1290000-0000-4000-8000-000000000011",
  adminB: "f1290000-0000-4000-8000-000000000012",
  assignmentA: "f1290000-0000-4000-8000-000000000021",
  assignmentB: "f1290000-0000-4000-8000-000000000022",
  application: "f1290000-0000-4000-8000-000000000031",
  connectionA: "f1290000-0000-4000-8000-000000000041",
  connectionB: "f1290000-0000-4000-8000-000000000042",
  subscriptionA: "f1290000-0000-4000-8000-000000000051",
  subscriptionB: "f1290000-0000-4000-8000-000000000052",
} as const;

const ciphertext = JSON.stringify({
  version: 1,
  nonce: "a".repeat(16),
  ciphertext: "b".repeat(24),
  tag: "c".repeat(22),
});

async function setIntegrationContext(db: PGlite) {
  await db.query("SELECT set_config('axora.system_identity','integration-maintenance',true)");
}

describe.sequential("migration 129 isolated webhook platform", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await db.exec("BEGIN");
    await setIntegrationContext(db);
    await db.query(`
      INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES
        ($1,'WEBHOOK-A','Webhook tenant A',true,0),
        ($2,'WEBHOOK-B','Webhook tenant B',true,0)
    `, [ids.companyA, ids.companyB]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT fixture.id,fixture.email,fixture.name,'not-a-real-hash',role.id,
        fixture.company_id,false,now(),now(),'COMPANY','ACTIVE',true,1
      FROM (VALUES
        ($1::uuid,'admin-a-129@example.test','Admin A 129',$3::uuid),
        ($2::uuid,'admin-b-129@example.test','Admin B 129',$4::uuid)
      ) fixture(id,email,name,company_id)
      JOIN roles role ON role.role_key='COMPANY_ADMIN'
    `, [ids.adminA, ids.adminB, ids.companyA, ids.companyB]);
    await db.query(`
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at,created_by
      ) VALUES
        ($1,$3,'ACTIVE',true,now(),$1),
        ($2,$4,'ACTIVE',true,now(),$2)
    `, [ids.adminA, ids.adminB, ids.companyA, ids.companyB]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
      ) SELECT fixture.assignment_id,fixture.user_id,role.id,'COMPANY',
        fixture.company_id,true,fixture.user_id,now()
      FROM (VALUES
        ($1::uuid,$3::uuid,$5::uuid),
        ($2::uuid,$4::uuid,$6::uuid)
      ) fixture(assignment_id,user_id,company_id)
      JOIN roles role ON role.role_key='COMPANY_ADMIN'
    `, [
      ids.assignmentA, ids.assignmentB, ids.adminA, ids.adminB,
      ids.companyA, ids.companyB,
    ]);
    await db.query(`
      INSERT INTO integration_applications(
        id,client_id,client_secret_hash,client_type,token_endpoint_auth_method,
        slug,name,description,redirect_uris,allowed_scopes,created_by
      ) VALUES (
        $1,$2,$3,'CONFIDENTIAL','client_secret_basic','webhook-fixture',
        'Webhook fixture','Fictional webhook test application',
        ARRAY['https://client.example.test/oauth/callback'],
        ARRAY['webhooks:manage']::text[],$4
      )
    `, [
      ids.application,
      `axora_client_${"a".repeat(24)}`,
      "d".repeat(64),
      ids.adminA,
    ]);
    await db.query(`
      INSERT INTO integration_connections(
        id,application_id,company_id,status,connected_by
      ) VALUES
        ($1,$3,$4,'ACTIVE',$6),
        ($2,$3,$5,'ACTIVE',$7)
    `, [
      ids.connectionA, ids.connectionB, ids.application,
      ids.companyA, ids.companyB, ids.adminA, ids.adminB,
    ]);
    await db.query(`
      INSERT INTO integration_webhook_subscriptions(
        id,application_id,connection_id,company_id,endpoint_ciphertext,
        endpoint_hash,endpoint_origin,event_types,current_credential_ciphertext,
        authorized_user_id,authorized_role_assignment_id,
        auth_version_at_authorization,created_by
      ) VALUES
        ($1,$3,$4,$6,$8::jsonb,$10,'https://hooks-a.receiver.dev',$12,$8::jsonb,$14,$16,1,$14),
        ($2,$3,$5,$7,$9::jsonb,$11,'https://hooks-b.receiver.dev',$13,$9::jsonb,$15,$17,1,$15)
    `, [
      ids.subscriptionA, ids.subscriptionB, ids.application,
      ids.connectionA, ids.connectionB, ids.companyA, ids.companyB,
      ciphertext, ciphertext, "a".repeat(64), "b".repeat(64),
      ["company.created", "request.approved"],
      ["company.created"], ids.adminA, ids.adminB,
      ids.assignmentA, ids.assignmentB,
    ]);
    await db.exec("COMMIT");
  }, 60_000);

  beforeEach(async () => {
    await db.exec("BEGIN");
    await setIntegrationContext(db);
  });

  afterEach(async () => { await db.exec("ROLLBACK"); });
  afterAll(async () => { await db.close(); });

  it("accepts only the exact versioned ciphertext envelope",async()=>{
    const result=await db.query<{valid:boolean;numeric:boolean;shortTag:boolean}>(`
      SELECT
        axora_integration_ciphertext_is_valid($1::jsonb) AS valid,
        axora_integration_ciphertext_is_valid(
          '{"version":1,"nonce":1111111111111111,"ciphertext":2222222222222222,"tag":3333333333333333}'::jsonb
        ) AS numeric,
        axora_integration_ciphertext_is_valid(
          '{"version":1,"nonce":"aaaaaaaaaaaaaaaa","ciphertext":"bbbbbbbbbbbb","tag":"ccccccccccccccccccccc"}'::jsonb
        ) AS "shortTag"
    `,[ciphertext]);
    expect(result.rows[0]).toEqual({valid:true,numeric:false,shortTag:false});
  });

  it("projects committed canonical rows once and fans out only within the company", async () => {
    const beforeEmail = await db.query<{ transactional: number; workflow: number }>(`
      SELECT
        (SELECT count(*)::int FROM transactional_email_outbox) AS transactional,
        (SELECT count(*)::int FROM workflow_email_outbox) AS workflow
    `);
    const first = await db.query<{ result: { scanned: number; projected: number } }>(
      "SELECT axora_project_integration_events(100,now()) AS result",
    );
    expect(first.rows[0]?.result).toEqual({ scanned: 2, projected: 2 });

    const events = await db.query<{ id: string; companyId: string }>(`
      SELECT id::text,company_id::text AS "companyId"
      FROM integration_events ORDER BY company_id
    `);
    expect(events.rows).toHaveLength(2);
    const deliveries = await db.query<{
      eventCompany: string; subscriptionCompany: string; subscriptionId: string;
    }>(`
      SELECT event.company_id::text AS "eventCompany",
        subscription.company_id::text AS "subscriptionCompany",
        subscription.id::text AS "subscriptionId"
      FROM integration_webhook_deliveries delivery
      JOIN integration_events event ON event.id=delivery.event_id
      JOIN integration_webhook_subscriptions subscription
        ON subscription.id=delivery.subscription_id
      ORDER BY subscription.id
    `);
    expect(deliveries.rows).toEqual([
      {
        eventCompany: ids.companyA,
        subscriptionCompany: ids.companyA,
        subscriptionId: ids.subscriptionA,
      },
      {
        eventCompany: ids.companyB,
        subscriptionCompany: ids.companyB,
        subscriptionId: ids.subscriptionB,
      },
    ]);
    expect(await db.query(`
      SELECT
        (SELECT count(*)::int FROM transactional_email_outbox) AS transactional,
        (SELECT count(*)::int FROM workflow_email_outbox) AS workflow
    `)).toEqual(beforeEmail);
  });

  it("is replay-safe after checkpoint rewind and preserves stable event IDs", async () => {
    await db.query("SELECT axora_project_integration_events(100,now())");
    const before = await db.query<{ ids: string[]; deliveries: number }>(`
      SELECT
        (SELECT array_agg(id::text ORDER BY id) FROM integration_events) AS ids,
        (SELECT count(*)::int FROM integration_webhook_deliveries) AS deliveries
    `);
    await db.query(`
      UPDATE integration_projection_checkpoints
      SET cursor_at='epoch'::timestamptz,
        cursor_id='00000000-0000-0000-0000-000000000000'::uuid
      WHERE source_name='COMPANIES'
    `);
    const replay = await db.query<{ result: { scanned: number; projected: number } }>(
      "SELECT axora_project_integration_events(100,now()) AS result",
    );
    expect(replay.rows[0]?.result).toMatchObject({ scanned: 2, projected: 0 });
    expect(await db.query(`
      SELECT
        (SELECT array_agg(id::text ORDER BY id) FROM integration_events) AS ids,
        (SELECT count(*)::int FROM integration_webhook_deliveries) AS deliveries
    `)).toEqual(before);
  });

  it("fails queued delivery closed after explicit DENY is applied", async () => {
    await db.query("SELECT axora_project_integration_events(100,now())");
    expect((await db.query<{ allowed: boolean }>(`
      SELECT axora_integration_subscription_is_authorized($1,now()) AS allowed
    `, [ids.subscriptionA])).rows[0]?.allowed).toBe(true);
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,starts_at,active,
        reason,changed_by
      ) SELECT $1,permission.id,'DENY','COMPANY',$2,now(),true,
        'Webhook authorization security test',$1
      FROM permissions permission
      WHERE permission.permission_code='integration.connection.manage'
    `, [ids.adminA, ids.companyA]);
    expect((await db.query<{ allowed: boolean }>(`
      SELECT axora_integration_subscription_is_authorized($1,now()) AS allowed
    `, [ids.subscriptionA])).rows[0]?.allowed).toBe(false);
    const claimed = await db.query<{ company_id: string }>(`
      SELECT * FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',10,45,now()
      )
    `);
    expect(claimed.rows.every((row) => row.company_id !== ids.companyA)).toBe(true);
    expect((await db.query<{ status: string; category: string }>(`
      SELECT status,error_category AS category
      FROM integration_webhook_deliveries
      WHERE subscription_id=$1
    `, [ids.subscriptionA])).rows).toEqual([
      { status: "FAILED", category: "AUTHORIZATION_REVOKED" },
    ]);
  });

  it("stops delivery immediately when the authorizer's company membership ends",async()=>{
    await db.query("SELECT axora_project_integration_events(100,now())");
    await db.query(`
      UPDATE company_memberships SET status='ENDED',ended_at=now()
      WHERE user_id=$1 AND company_id=$2
    `,[ids.adminB,ids.companyB]);
    const claimed=await db.query<{company_id:string}>(`
      SELECT * FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',10,45,now()
      )
    `);
    expect(claimed.rows.every((row)=>row.company_id!==ids.companyB)).toBe(true);
    expect((await db.query<{subscription:string;delivery:string;category:string}>(`
      SELECT subscription.status AS subscription,delivery.status AS delivery,
        delivery.error_category AS category
      FROM integration_webhook_subscriptions subscription
      JOIN integration_webhook_deliveries delivery
        ON delivery.subscription_id=subscription.id
      WHERE subscription.id=$1
    `,[ids.subscriptionB])).rows).toEqual([{
      subscription:"PAUSED",delivery:"FAILED",category:"AUTHORIZATION_REVOKED",
    }]);
  });

  it("connection revocation terminalizes delivery without changing its event", async () => {
    await db.query("SELECT axora_project_integration_events(100,now())");
    const event = (await db.query<{ id: string }>(`
      SELECT event_id::text AS id FROM integration_webhook_deliveries
      WHERE subscription_id=$1
    `, [ids.subscriptionA])).rows[0]!.id;
    await db.query(`
      UPDATE integration_connections
      SET status='REVOKED',revoked_at=now(),revoked_by=$2,
        revoke_reason='Webhook security fixture revocation'
      WHERE id=$1
    `, [ids.connectionA, ids.adminA]);
    expect((await db.query<{ status: string }>(`
      SELECT status FROM integration_webhook_deliveries
      WHERE subscription_id=$1
    `, [ids.subscriptionA])).rows).toEqual([{ status: "FAILED" }]);
    expect((await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM integration_events WHERE id=$1
    `, [event])).rows[0]?.count).toBe(1);
  });

  it("records expired leases and dead-letters a crash loop at the attempt cap",async()=>{
    await db.query("SELECT axora_project_integration_events(100,now())");
    await db.query(`
      UPDATE integration_webhook_deliveries
      SET available_at=now()+interval '1 day'
      WHERE subscription_id=$1
    `,[ids.subscriptionB]);
    const claimed=await db.query<{deliveryId:string}>(`
      SELECT delivery_id::text AS "deliveryId"
      FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',1,45,now()
      )
    `);
    const deliveryId=claimed.rows[0]!.deliveryId;
    await db.query(`
      UPDATE integration_webhook_deliveries
      SET cycle_attempt_count=8,lease_expires_at=now()-interval '1 second'
      WHERE id=$1
    `,[deliveryId]);
    expect((await db.query(`
      SELECT * FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',1,45,now()
      )
    `)).rows).toEqual([]);
    expect((await db.query<{
      status:string;category:string;attempts:number;outcome:string;
      credentialVersion:number|null;
    }>(`
      SELECT delivery.status,delivery.error_category AS category,
        count(attempt.id)::int AS attempts,max(attempt.outcome) AS outcome,
        max(attempt.credential_version) AS "credentialVersion"
      FROM integration_webhook_deliveries delivery
      LEFT JOIN integration_webhook_attempts attempt
        ON attempt.delivery_id=delivery.id
      WHERE delivery.id=$1
      GROUP BY delivery.id
    `,[deliveryId])).rows[0]).toEqual({
      status:"DEAD",category:"LEASE_EXPIRED",attempts:1,outcome:"DEAD",
      credentialVersion:1,
    });
  });

  it("leases, retries, dead-letters, and manually retries the same delivery",async()=>{
    await db.query("SELECT axora_project_integration_events(100,now())");
    await db.query(`
      UPDATE integration_webhook_deliveries
      SET available_at=now()+interval '1 day'
      WHERE subscription_id=$1
    `,[ids.subscriptionB]);
    const first=await db.query<{
      delivery_id:string;event_id:string;lease_token:string;
      credential_version:number;
    }>(`
      SELECT delivery_id::text,event_id::text,lease_token::text,credential_version
      FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',1,45,now()
      )
    `);
    const claimed=first.rows[0]!;
    expect(claimed).toBeDefined();
    await db.exec("SAVEPOINT invalid_credential");
    try{
      await expect(db.query(`
        SELECT axora_complete_integration_webhook_delivery(
          'integration-fixture01',$1,$2,'RETRY',500,
          'HTTP_SERVER_ERROR',25,1,$3,now()
        )
      `,[claimed.delivery_id,claimed.lease_token,claimed.credential_version+1]))
        .rejects.toMatchObject({code:"P8601"});
    }finally{
      await db.exec("ROLLBACK TO SAVEPOINT invalid_credential");
      await db.exec("RELEASE SAVEPOINT invalid_credential");
    }
    expect((await db.query<{status:string}>(`
      SELECT axora_complete_integration_webhook_delivery(
        'integration-fixture01',$1,$2,'RETRY',500,
        'HTTP_SERVER_ERROR',25,1,$3,now()
      ) AS status
    `,[claimed.delivery_id,claimed.lease_token,claimed.credential_version])).rows[0]?.status)
      .toBe("RETRY");
    await db.query(`
      UPDATE integration_webhook_deliveries
      SET cycle_attempt_count=7,available_at=now()
      WHERE id=$1
    `,[claimed.delivery_id]);
    const eighth=await db.query<{lease_token:string;credential_version:number}>(`
      SELECT lease_token::text,credential_version
      FROM axora_claim_integration_webhook_deliveries(
        'integration-fixture01',1,45,now()
      )
    `);
    expect((await db.query<{status:string}>(`
      SELECT axora_complete_integration_webhook_delivery(
        'integration-fixture01',$1,$2,'RETRY',500,
        'HTTP_SERVER_ERROR',25,1,$3,now()
      ) AS status
    `,[
      claimed.delivery_id,eighth.rows[0]!.lease_token,
      eighth.rows[0]!.credential_version,
    ])).rows[0]?.status).toBe("DEAD");
    const eventBefore=claimed.event_id;
    await db.query(`
      UPDATE integration_webhook_deliveries
      SET status='RETRY',cycle_attempt_count=0,manual_retry_count=1,
        available_at=now(),completed_at=NULL,response_status=NULL,
        error_category=NULL,last_duration_ms=NULL,updated_at=now()
      WHERE id=$1 AND status='DEAD'
    `,[claimed.delivery_id]);
    expect((await db.query<{
      status:string;eventId:string;manualRetries:number;attempts:number;
    }>(`
      SELECT status,event_id::text AS "eventId",
        manual_retry_count AS "manualRetries",
        (SELECT count(*)::int FROM integration_webhook_attempts
          WHERE delivery_id=delivery.id) AS attempts
      FROM integration_webhook_deliveries delivery WHERE id=$1
    `,[claimed.delivery_id])).rows[0]).toEqual({
      status:"RETRY",eventId:eventBefore,manualRetries:1,attempts:2,
    });
  });

  it("retires expired refresh families for bounded OAuth cleanup",async()=>{
    const grant=(await db.query<{id:string}>(`
      INSERT INTO integration_oauth_grants(
        application_id,connection_id,company_id,user_id,role_assignment_id,
        auth_version_at_grant,scopes,expires_at
      ) VALUES ($1,$2,$3,$4,$5,1,ARRAY['webhooks:manage']::text[],
        now()+interval '1 day')
      RETURNING id::text
    `,[
      ids.application,ids.connectionA,ids.companyA,ids.adminA,ids.assignmentA,
    ])).rows[0]!.id;
    const family=(await db.query<{id:string}>(`
      INSERT INTO integration_oauth_refresh_families(
        application_id,connection_id,company_id,grant_id,user_id,
        created_at,expires_at
      ) VALUES ($1,$2,$3,$4,$5,now()-interval '2 days',
        now()-interval '1 day')
      RETURNING id::text
    `,[ids.application,ids.connectionA,ids.companyA,grant,ids.adminA])).rows[0]!.id;
    await db.query("SELECT axora_cleanup_integration_runtime(now())");
    expect((await db.query<{
      status:string;revoked:boolean;reason:string;
    }>(`
      SELECT status,revoked_at IS NOT NULL AS revoked,revoke_reason AS reason
      FROM integration_oauth_refresh_families WHERE id=$1
    `,[family])).rows[0]).toEqual({
      status:"EXPIRED",revoked:true,reason:"Refresh token family expired",
    });
  });

  it("keeps CAM outside integration management and forces RLS on every new table", async () => {
    const boundary = await db.query<{
      camPermission: number; forcedRls: number; emailForeignKeys: number;
    }>(`
      SELECT
        (SELECT count(*)::int
          FROM role_permissions role_permission
          JOIN roles role ON role.id=role_permission.role_id
          JOIN permissions permission ON permission.id=role_permission.permission_id
          WHERE role.role_key='CUSTOMER_ACCOUNT_MANAGER'
            AND permission.permission_code='integration.connection.manage')
          AS "camPermission",
        (SELECT count(*)::int FROM pg_class relation
          WHERE relation.relnamespace='public'::regnamespace
            AND relation.relname IN (
              'integration_projection_checkpoints','integration_events',
              'integration_webhook_subscriptions','integration_webhook_deliveries',
              'integration_webhook_attempts'
            ) AND relation.relrowsecurity AND relation.relforcerowsecurity)
          AS "forcedRls",
        (SELECT count(*)::int
          FROM pg_constraint constraint_record
          JOIN pg_class source ON source.oid=constraint_record.conrelid
          JOIN pg_class target ON target.oid=constraint_record.confrelid
          WHERE constraint_record.contype='f'
            AND source.relname LIKE 'integration_webhook_%'
            AND target.relname IN (
              'transactional_email_outbox','workflow_email_outbox'
            )) AS "emailForeignKeys"
    `);
    expect(boundary.rows[0]).toEqual({
      camPermission: 0,
      forcedRls: 5,
      emailForeignKeys: 0,
    });
  });
});

describe("migration 129 additive dark launch", () => {
  it("upgrades 128 without mutating existing accounts, finance, or email", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, { through: "128_external_integration_foundation.sql" });
      await applyDemoSeed(db);
      const snapshot = async () => (await db.query(`
        SELECT
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM role_assignments) AS assignments,
          (SELECT count(*)::int FROM requests) AS requests,
          (SELECT count(*)::int FROM invoices) AS invoices,
          (SELECT count(*)::int FROM delivery_jobs) AS deliveries,
          (SELECT count(*)::int FROM payments) AS payments,
          (SELECT count(*)::int FROM company_wallet_ledger_entries) AS wallet,
          (SELECT count(*)::int FROM budget_ledger_entries) AS budgets,
          (SELECT count(*)::int FROM transactional_email_outbox) AS email,
          (SELECT count(*)::int FROM workflow_email_outbox) AS workflow_email
      `)).rows[0];
      const before = await snapshot();
      await db.exec(await readFile(new URL(
        "../database/migrations/129_integration_webhook_platform.sql",
        import.meta.url,
      ), "utf8"));
      expect(await snapshot()).toEqual(before);
      expect((await db.query<{ events: number; deliveries: number }>(`
        SELECT
          (SELECT count(*)::int FROM integration_events) AS events,
          (SELECT count(*)::int FROM integration_webhook_deliveries) AS deliveries
      `)).rows[0]).toEqual({ events: 0, deliveries: 0 });
    } finally {
      await db.close();
    }
  }, 60_000);
});

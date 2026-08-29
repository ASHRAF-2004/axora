import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids={
  company:"f1320000-0000-4000-8000-000000000001",
  companyB:"f1320000-0000-4000-8000-000000000002",
  admin:"f1320000-0000-4000-8000-000000000011",
  assignment:"f1320000-0000-4000-8000-000000000021",
  connection:"f1320000-0000-4000-8000-000000000031",
  installation:"f1320000-0000-4000-8000-000000000041",
  source:"f1320000-0000-4000-8000-000000000051",
  sourceTwo:"f1320000-0000-4000-8000-000000000052",
} as const;
const slackApplication="8a0b0000-0000-4000-8000-000000000004";
const ciphertext=JSON.stringify({
  version:1,nonce:"a".repeat(16),ciphertext:"b".repeat(24),tag:"c".repeat(22),
});

async function setIntegrationContext(db:PGlite) {
  await db.query("SELECT set_config('axora.system_identity','integration-maintenance',true)");
}

describe.sequential("migration 132 native Slack isolation",()=>{
  let db:PGlite;

  beforeAll(async()=>{
    db=new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN; CREATE ROLE axora_integration_worker NOLOGIN");
    await applyMigrations(db);
    await db.exec("BEGIN");
    await setIntegrationContext(db);
    await db.query(`
      INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES ($1,'SLACK-A','Slack tenant A',true,0),
        ($2,'SLACK-B','Slack tenant B',true,0)
    `,[ids.company,ids.companyB]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,'slack-admin@example.test','Slack Admin','not-a-real-hash',
        role.id,$2,false,now(),now(),'COMPANY','ACTIVE',true,1
      FROM roles role WHERE role.role_key='COMPANY_ADMIN'
    `,[ids.admin,ids.company]);
    await db.query(`
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at,created_by
      ) VALUES ($1,$2,'ACTIVE',true,now(),$1)
    `,[ids.admin,ids.company]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
      ) SELECT $1,$2,role.id,'COMPANY',$3,true,$2,now()
      FROM roles role WHERE role.role_key='COMPANY_ADMIN'
    `,[ids.assignment,ids.admin,ids.company]);
    await db.query(`
      INSERT INTO integration_connections(
        id,application_id,company_id,status,connected_by
      ) VALUES ($1,$2,$3,'ACTIVE',$4)
    `,[ids.connection,slackApplication,ids.company,ids.admin]);
    await db.query(`
      INSERT INTO integration_slack_installations(
        id,application_id,connection_id,company_id,workspace_id,
        workspace_name,bot_user_id,granted_scopes,access_token_ciphertext,
        refresh_token_ciphertext,access_token_expires_at,selected_channel_id,
        selected_channel_name,installed_by,authorized_role_assignment_id,
        auth_version_at_install
      ) VALUES (
        $1,$2,$3,$4,'T123456789','Fixture workspace','B123456789',
        ARRAY['channels:read','chat:write'],$5::jsonb,$5::jsonb,
        now()+interval '12 hours','C123456789','procurement',$6,$7,1
      )
    `,[
      ids.installation,slackApplication,ids.connection,ids.company,ciphertext,
      ids.admin,ids.assignment,
    ]);
    await db.exec("COMMIT");
  },60_000);

  beforeEach(async()=>{
    await db.exec("BEGIN");
    await setIntegrationContext(db);
  });
  afterEach(async()=>{await db.exec("ROLLBACK")});
  afterAll(async()=>{await db.close()});

  it("seeds a provider-owned app that cannot issue Axora OAuth state",async()=>{
    expect((await db.query<{
      authorizationMode:string;clientType:string;scopes:string[];
    }>(`
      SELECT authorization_mode AS "authorizationMode",client_type AS "clientType",
        allowed_scopes AS scopes FROM integration_applications WHERE id=$1
    `,[slackApplication])).rows[0]).toEqual({
      authorizationMode:"PROVIDER_OAUTH",clientType:"PUBLIC",scopes:["webhooks:manage"],
    });
    await expect(db.query(`
      INSERT INTO integration_oauth_authorization_requests(
        request_handle_hash,application_id,user_id,role_assignment_id,company_id,
        redirect_uri,client_state,requested_scopes,code_challenge,
        code_challenge_method,expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,ARRAY['webhooks:manage'],$8,'S256',
        now()+interval '5 minutes'
      )
    `,[
      "d".repeat(64),slackApplication,ids.admin,ids.assignment,ids.company,
      "https://axora.management/api/integrations/slack/oauth/callback",
      "state-fixture-value", "e".repeat(43),
    ])).rejects.toThrow(/Provider OAuth applications/i);
  });

  it("keeps every Slack table forced-RLS and outside email storage",async()=>{
    const tables=await db.query<{
      name:string;rls:boolean;forced:boolean;
    }>(`
      SELECT class.relname AS name,class.relrowsecurity AS rls,
        class.relforcerowsecurity AS forced
      FROM pg_class class
      WHERE class.relname LIKE 'integration_slack_%'
        AND class.relkind='r' ORDER BY class.relname
    `);
    expect(tables.rows).toHaveLength(6);
    expect(tables.rows.every((row)=>row.rls&&row.forced)).toBe(true);
    const emailLinks=await db.query<{count:number}>(`
      SELECT count(*)::int AS count
      FROM information_schema.table_constraints constraint_record
      JOIN information_schema.constraint_column_usage usage
        ON usage.constraint_name=constraint_record.constraint_name
       AND usage.constraint_schema=constraint_record.constraint_schema
      WHERE constraint_record.table_schema='public'
        AND constraint_record.table_name LIKE 'integration_slack_%'
        AND usage.table_name IN ('transactional_email_outbox','workflow_email_outbox')
    `);
    expect(emailLinks.rows[0]?.count).toBe(0);
  });

  it("projects one stable event asynchronously only when Slack fanout is enabled",async()=>{
    const before=await db.query<{transactional:number;workflow:number}>(`
      SELECT (SELECT count(*)::int FROM transactional_email_outbox) AS transactional,
        (SELECT count(*)::int FROM workflow_email_outbox) AS workflow
    `);
    await db.query("SELECT set_config('axora.integration_slack_enabled','true',true)");
    const first=await db.query<{inserted:boolean}>(`
      SELECT axora_insert_projected_integration_event(
        'request.approved',$1::uuid,'request',$2::uuid,
        '/api/v1/requests/'||$2::text,'REQUEST_DECISIONS',$3::uuid,1,now(),
        jsonb_build_object('order_code','ORD-FICTIONAL','total','10.00','currency','MYR')
      ) AS inserted
    `,[ids.company,ids.source,ids.source]);
    const replay=await db.query<{inserted:boolean}>(`
      SELECT axora_insert_projected_integration_event(
        'request.approved',$1::uuid,'request',$2::uuid,
        '/api/v1/requests/'||$2::text,'REQUEST_DECISIONS',$3::uuid,1,now(),
        jsonb_build_object('order_code','CHANGED')
      ) AS inserted
    `,[ids.company,ids.source,ids.source]);
    expect(first.rows[0]?.inserted).toBe(true);
    expect(replay.rows[0]?.inserted).toBe(false);
    const rows=await db.query<{eventId:string;status:string}>(`
      SELECT event_id::text AS "eventId",status
      FROM integration_slack_deliveries
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.status).toBe("PENDING");
    expect(await db.query(`
      SELECT (SELECT count(*)::int FROM transactional_email_outbox) AS transactional,
        (SELECT count(*)::int FROM workflow_email_outbox) AS workflow
    `)).toEqual(before);
  });

  it("does not enqueue Slack when its independent projector capability is off",async()=>{
    await db.query("SELECT set_config('axora.integration_slack_enabled','false',true)");
    await db.query(`
      SELECT axora_insert_projected_integration_event(
        'request.approved',$1::uuid,'request',$2::uuid,
        '/api/v1/requests/'||$2::text,'REQUEST_DECISIONS',$2::uuid,1,now(),
        jsonb_build_object('order_code','ORD-OFF')
      )
    `,[ids.company,ids.sourceTwo]);
    expect((await db.query<{count:number}>(`
      SELECT count(*)::int AS count FROM integration_slack_deliveries
    `)).rows[0]?.count).toBe(0);
  });

  it("re-evaluates explicit DENY before delivery and fails queued work closed",async()=>{
    await db.query("SELECT set_config('axora.integration_slack_enabled','true',true)");
    await db.query(`
      SELECT axora_insert_projected_integration_event(
        'request.approved',$1::uuid,'request',$2::uuid,
        '/api/v1/requests/'||$2::text,'REQUEST_DECISIONS',$2::uuid,1,now(),
        jsonb_build_object('order_code','ORD-DENY')
      )
    `,[ids.company,ids.source]);
    expect((await db.query<{allowed:boolean}>(`
      SELECT axora_slack_installation_is_authorized($1,now()) AS allowed
    `,[ids.installation])).rows[0]?.allowed).toBe(true);
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,starts_at,active,
        reason,changed_by
      ) SELECT $1,permission.id,'DENY','COMPANY',$2,now(),true,
        'Slack authorization security test',$1
      FROM permissions permission
      WHERE permission.permission_code='integration.connection.manage'
    `,[ids.admin,ids.company]);
    expect((await db.query<{allowed:boolean}>(`
      SELECT axora_slack_installation_is_authorized($1,now()) AS allowed
    `,[ids.installation])).rows[0]?.allowed).toBe(false);
    const claimed=await db.query(`
      SELECT * FROM axora_claim_integration_slack_deliveries(
        'integration-fixture01',10,45,now()
      )
    `);
    expect(claimed.rows).toHaveLength(0);
    expect((await db.query<{status:string;category:string}>(`
      SELECT status,error_category AS category FROM integration_slack_deliveries
    `)).rows).toEqual([{status:"FAILED",category:"AUTHORIZATION_REVOKED"}]);
    expect((await db.query<{status:string;reason:string}>(`
      SELECT status,pause_reason AS reason FROM integration_slack_installations
      WHERE id=$1
    `,[ids.installation])).rows[0]).toEqual({
      status:"PAUSED",reason:"AUTHORIZATION_REVOKED",
    });
  });

  it("disconnects locally before provider revocation and stops queued work",async()=>{
    await db.query("SELECT set_config('axora.integration_slack_enabled','true',true)");
    await db.query(`
      SELECT axora_insert_projected_integration_event(
        'request.approved',$1::uuid,'request',$2::uuid,
        '/api/v1/requests/'||$2::text,'REQUEST_DECISIONS',$2::uuid,1,now(),
        jsonb_build_object('order_code','ORD-REVOKE')
      )
    `,[ids.company,ids.source]);
    await db.query(`
      UPDATE integration_connections SET status='REVOKED',revoked_at=now(),
        revoked_by=$2,revoke_reason='Fixture disconnect',updated_at=now()
      WHERE id=$1
    `,[ids.connection,ids.admin]);
    expect((await db.query<{
      status:string;channel:string|null;requested:boolean;
    }>(`
      SELECT status,selected_channel_id AS channel,
        revocation_requested_at IS NOT NULL AS requested
      FROM integration_slack_installations WHERE id=$1
    `,[ids.installation])).rows[0]).toEqual({
      status:"REVOKING",channel:null,requested:true,
    });
    expect((await db.query<{status:string;category:string}>(`
      SELECT status,error_category AS category FROM integration_slack_deliveries
    `)).rows).toEqual([{status:"FAILED",category:"INSTALLATION_INACTIVE"}]);
  });

  it("gives the worker only the replacement projector and Slack capabilities",async()=>{
    const privilege=await db.query<{
      oldProjector:boolean;newProjector:boolean;claimSlack:boolean;tableRead:boolean;
    }>(`
      SELECT
        has_function_privilege('axora_integration_worker',
          'public.axora_project_integration_events(integer,timestamptz)','EXECUTE')
          AS "oldProjector",
        has_function_privilege('axora_integration_worker',
          'public.axora_project_integration_events_with_capabilities(integer,timestamptz,boolean,boolean)','EXECUTE')
          AS "newProjector",
        has_function_privilege('axora_integration_worker',
          'public.axora_claim_integration_slack_deliveries(text,integer,integer,timestamptz)','EXECUTE')
          AS "claimSlack",
        has_table_privilege('axora_integration_worker',
          'public.integration_slack_installations','SELECT') AS "tableRead"
    `);
    expect(privilege.rows[0]).toEqual({
      oldProjector:false,newProjector:true,claimSlack:true,tableRead:false,
    });
  });

  it("keeps integration-management authority out of CAM and delivery roles",async()=>{
    const roles=await db.query<{role:string}>(`
      SELECT role.role_key AS role
      FROM role_permissions role_permission
      JOIN roles role ON role.id=role_permission.role_id
      JOIN permissions permission ON permission.id=role_permission.permission_id
      WHERE permission.permission_code='integration.connection.manage'
      ORDER BY role.role_key
    `);
    expect(roles.rows.map((row)=>row.role)).toEqual(["COMPANY_ADMIN","PLATFORM_OWNER"]);
  });
});

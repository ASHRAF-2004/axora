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
  companyA: "f1280000-0000-4000-8000-000000000001",
  companyB: "f1280000-0000-4000-8000-000000000002",
  owner: "f1280000-0000-4000-8000-000000000011",
  adminA: "f1280000-0000-4000-8000-000000000012",
  adminB: "f1280000-0000-4000-8000-000000000013",
  adminAReserve: "f1280000-0000-4000-8000-000000000014",
  ownerAssignment: "f1280000-0000-4000-8000-000000000021",
  adminAAssignment: "f1280000-0000-4000-8000-000000000022",
  adminBAssignment: "f1280000-0000-4000-8000-000000000023",
  adminAReserveAssignment: "f1280000-0000-4000-8000-000000000024",
  application: "f1280000-0000-4000-8000-000000000031",
  connectionA: "f1280000-0000-4000-8000-000000000041",
  connectionB: "f1280000-0000-4000-8000-000000000042",
  grantA: "f1280000-0000-4000-8000-000000000051",
  grantB: "f1280000-0000-4000-8000-000000000052",
  tokenA: "f1280000-0000-4000-8000-000000000061",
  tokenB: "f1280000-0000-4000-8000-000000000062",
} as const;

const tokenHashA = "a".repeat(64);
const tokenHashB = "b".repeat(64);

interface PrincipalRow {
  accessTokenId: string;
  companyId: string;
  userId: string;
}

async function setIntegrationContext(
  db: PGlite,
  identity: "integration-api" | "integration-management" | "integration-maintenance",
) {
  await db.query("SELECT set_config('axora.system_identity',$1,true)", [identity]);
}

async function principalFor(db: PGlite, tokenHash = tokenHashA) {
  await setIntegrationContext(db, "integration-api");
  return (await db.query<PrincipalRow>(`
    SELECT access_token_id::text AS "accessTokenId",
      company_id::text AS "companyId",user_id::text AS "userId"
    FROM public.axora_integration_principal_by_token_hash($1,now())
  `, [tokenHash])).rows;
}

describe.sequential("migration 128 external integration security boundary", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await db.exec("BEGIN");
    await setIntegrationContext(db, "integration-maintenance");
    await db.query(`
      INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES
        ($1,'INTEGRATION-A','Integration tenant A',true,0),
        ($2,'INTEGRATION-B','Integration tenant B',true,0)
    `, [ids.companyA,ids.companyB]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT fixture.id,fixture.email,fixture.name,'not-a-real-hash',role.id,
        fixture.company_id,fixture.is_owner,now(),now(),fixture.account_kind,
        'ACTIVE',true,1
      FROM (VALUES
        ($1::uuid,'owner-128@example.test','Owner 128',NULL::uuid,true,'PLATFORM'),
        ($2::uuid,'admin-a-128@example.test','Admin A 128',$4::uuid,false,'COMPANY'),
        ($3::uuid,'admin-b-128@example.test','Admin B 128',$5::uuid,false,'COMPANY')
      ) fixture(id,email,name,company_id,is_owner,account_kind)
      JOIN roles role ON role.role_key=CASE
        WHEN fixture.is_owner THEN 'PLATFORM_OWNER' ELSE 'COMPANY_ADMIN' END
    `, [ids.owner,ids.adminA,ids.adminB,ids.companyA,ids.companyB]);
    await db.query(`
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at,created_by
      ) VALUES
        ($1,$3,'ACTIVE',true,now(),$5),
        ($2,$4,'ACTIVE',true,now(),$5)
    `, [ids.adminA,ids.adminB,ids.companyA,ids.companyB,ids.owner]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,'reserve-admin-a-128@example.test','Reserve Admin A 128',
        'not-a-real-hash',id,$2,false,now(),now(),'COMPANY','ACTIVE',true,1
      FROM roles WHERE role_key='COMPANY_ADMIN'
    `, [ids.adminAReserve,ids.companyA]);
    await db.query(`
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at,created_by
      ) VALUES ($1,$2,'ACTIVE',true,now(),$3)
    `, [ids.adminAReserve,ids.companyA,ids.owner]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
      ) SELECT fixture.assignment_id,fixture.user_id,role.id,
        fixture.scope_type,fixture.company_id,true,$4,now()
      FROM (VALUES
        ($1::uuid,$4::uuid,'PLATFORM',NULL::uuid,'PLATFORM_OWNER'),
        ($2::uuid,$5::uuid,'COMPANY',$7::uuid,'COMPANY_ADMIN'),
        ($3::uuid,$6::uuid,'COMPANY',$8::uuid,'COMPANY_ADMIN')
      ) fixture(assignment_id,user_id,scope_type,company_id,role_key)
      JOIN roles role ON role.role_key=fixture.role_key
    `, [
      ids.ownerAssignment,ids.adminAAssignment,ids.adminBAssignment,
      ids.owner,ids.adminA,ids.adminB,ids.companyA,ids.companyB,
    ]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
      ) SELECT $1,$2,id,'COMPANY',$3,true,$4,now()
      FROM roles WHERE role_key='COMPANY_ADMIN'
    `, [
      ids.adminAReserveAssignment,ids.adminAReserve,ids.companyA,ids.owner,
    ]);
    await db.query(`
      INSERT INTO user_profiles(
        user_id,display_name,preferred_locale,timezone,profile_completed_at
      ) VALUES
        ($1,'Owner 128','en','Asia/Kuala_Lumpur',now()),
        ($2,'Admin A 128','en','Asia/Kuala_Lumpur',now()),
        ($3,'Admin B 128','en','Asia/Kuala_Lumpur',now())
    `, [ids.owner,ids.adminA,ids.adminB]);
    await db.query(`
      INSERT INTO integration_applications(
        id,client_id,client_secret_hash,client_type,
        token_endpoint_auth_method,slug,name,description,redirect_uris,
        allowed_scopes,created_by
      ) VALUES (
        $1,$2,$3,'CONFIDENTIAL','client_secret_basic','security-fixture',
        'Security fixture','Integration authorization fixture',
        ARRAY['https://client.example.test/oauth/callback'],
        ARRAY['companies:read','requests:read']::text[],$4
      )
    `, [
      ids.application,`axora_client_${"a".repeat(24)}`,"c".repeat(64),ids.owner,
    ]);
    await db.query(`
      INSERT INTO integration_connections(
        id,application_id,company_id,status,connected_by
      ) VALUES
        ($1,$3,$4,'ACTIVE',$6),($2,$3,$5,'ACTIVE',$7)
    `, [
      ids.connectionA,ids.connectionB,ids.application,ids.companyA,ids.companyB,
      ids.adminA,ids.adminB,
    ]);
    await db.query(`
      INSERT INTO integration_oauth_grants(
        id,application_id,connection_id,company_id,user_id,role_assignment_id,
        auth_version_at_grant,scopes,status,granted_at,expires_at
      ) VALUES
        ($1,$3,$4,$6,$8,$10,1,ARRAY['companies:read','requests:read']::text[],
          'ACTIVE',now()-interval '5 minutes',now()+interval '90 days'),
        ($2,$3,$5,$7,$9,$11,1,ARRAY['companies:read']::text[],
          'ACTIVE',now()-interval '5 minutes',now()+interval '90 days')
    `, [
      ids.grantA,ids.grantB,ids.application,ids.connectionA,ids.connectionB,
      ids.companyA,ids.companyB,ids.adminA,ids.adminB,
      ids.adminAAssignment,ids.adminBAssignment,
    ]);
    await db.query(`
      INSERT INTO integration_oauth_access_tokens(
        id,application_id,connection_id,company_id,grant_id,user_id,
        role_assignment_id,auth_version_at_issue,token_hash,audience,scopes,
        created_at,expires_at
      ) VALUES
        ($1,$3,$4,$6,$8,$10,$12,1,$14,
          'https://axora.management/api/v1',ARRAY['companies:read','requests:read']::text[],
          now()-interval '5 minutes',now()+interval '15 minutes'),
        ($2,$3,$5,$7,$9,$11,$13,1,$15,
          'https://axora.management/api/v1',ARRAY['companies:read']::text[],
          now()-interval '5 minutes',now()+interval '15 minutes')
    `, [
      ids.tokenA,ids.tokenB,ids.application,ids.connectionA,ids.connectionB,
      ids.companyA,ids.companyB,ids.grantA,ids.grantB,ids.adminA,ids.adminB,
      ids.adminAAssignment,ids.adminBAssignment,tokenHashA,tokenHashB,
    ]);
    await db.exec("COMMIT");
  }, 60_000);

  beforeEach(async () => { await db.exec("BEGIN"); });

  afterEach(async () => {
    await db.exec("ROLLBACK");
    await db.exec("RESET ROLE");
  });

  afterAll(async () => { await db.close(); });

  it("re-evaluates every live authorization boundary for issued opaque tokens", async () => {
    await expect(principalFor(db)).resolves.toEqual([{
      accessTokenId: ids.tokenA,
      companyId: ids.companyA,
      userId: ids.adminA,
    }]);
    await expect(principalFor(db, tokenHashB)).resolves.toEqual([{
      accessTokenId: ids.tokenB,
      companyId: ids.companyB,
      userId: ids.adminB,
    }]);
    await expect(principalFor(db, "9".repeat(64))).resolves.toEqual([]);

    const expectDeniedThenRestore = async (
      denySql: string,
      denyValues: unknown[],
    ) => {
      await db.exec("SAVEPOINT live_authorization_boundary");
      await db.query(denySql, denyValues);
      await expect(principalFor(db)).resolves.toEqual([]);
      await db.exec("ROLLBACK TO SAVEPOINT live_authorization_boundary");
      await expect(principalFor(db)).resolves.toHaveLength(1);
    };

    await expectDeniedThenRestore(
      "UPDATE integration_oauth_access_tokens SET revoked_at=now() WHERE id=$1",
      [ids.tokenA],
    );
    await expectDeniedThenRestore(
      "UPDATE integration_oauth_access_tokens SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [ids.tokenA],
    );
    await expectDeniedThenRestore(
      "UPDATE users SET active=false,account_status='SUSPENDED' WHERE id=$1",
      [ids.adminA],
    );
    await expectDeniedThenRestore(
      "UPDATE users SET auth_version=2 WHERE id=$1",
      [ids.adminA],
    );
    await expectDeniedThenRestore(
      "UPDATE role_assignments SET active=false,revoked_at=now() WHERE id=$1",
      [ids.adminAAssignment],
    );
    await expectDeniedThenRestore(
      `UPDATE integration_oauth_grants SET status='REVOKED',revoked_at=now(),
        revoke_reason='Security test revocation' WHERE id=$1`,
      [ids.grantA],
    );
    await expectDeniedThenRestore(
      `UPDATE integration_connections SET status='REVOKED',revoked_at=now(),
        revoke_reason='Security test revocation' WHERE id=$1`,
      [ids.connectionA],
    );
    await expectDeniedThenRestore(
      "UPDATE integration_applications SET status='INACTIVE' WHERE id=$1",
      [ids.application],
    );
    await expectDeniedThenRestore(
      "UPDATE company_memberships SET status='ENDED',ended_at=now() WHERE user_id=$1 AND company_id=$2",
      [ids.adminA,ids.companyA],
    );

    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,starts_at,active,
        reason,changed_by
      ) SELECT $1,permission.id,'DENY','COMPANY',$2,now(),true,
        'Integration permission revoked',$3
      FROM permissions permission
      WHERE permission.permission_code='integration.connection.manage'
    `, [ids.adminA,ids.companyA,ids.owner]);
    await expect(principalFor(db)).resolves.toEqual([]);
    await db.query(`DELETE FROM user_permission_overrides
      WHERE user_id=$1 AND company_id=$2`, [ids.adminA,ids.companyA]);
    await expect(principalFor(db)).resolves.toHaveLength(1);

    await db.query(`UPDATE integration_applications
      SET allowed_scopes=ARRAY['companies:read']::text[] WHERE id=$1`, [ids.application]);
    await expect(principalFor(db)).resolves.toEqual([]);
  });

  it("grants only the documented Owner and Company Administrator authorities", async () => {
    const roleMatrix = await db.query<{ roleKey: string; permissions: string[] }>(`
      SELECT role.role_key AS "roleKey",
        array_agg(permission.permission_code ORDER BY permission.permission_code)
          AS permissions
      FROM role_permissions role_permission
      JOIN roles role ON role.id=role_permission.role_id
      JOIN permissions permission ON permission.id=role_permission.permission_id
      WHERE permission.permission_code LIKE 'integration.%'
      GROUP BY role.role_key ORDER BY role.role_key
    `);
    expect(roleMatrix.rows).toEqual([
      { roleKey: "COMPANY_ADMIN", permissions: ["integration.connection.manage"] },
      {
        roleKey: "PLATFORM_OWNER",
        permissions: [
          "integration.application.manage",
          "integration.connection.manage",
          "integration.operations.view",
        ],
      },
    ]);
    const decisions = await db.query<{
      companyOwn: boolean;
      companyForeign: boolean;
      ownerApplication: boolean;
      companyApplicationCeiling: boolean;
      companyOperationsCeiling: boolean;
    }>(`
      SELECT
        axora_snapshot_has_permission(
          axora_live_authorization_snapshot($1,$2,now()),
          'integration.connection.manage','COMPANY',$3,NULL,NULL,NULL
        ) AS "companyOwn",
        axora_snapshot_has_permission(
          axora_live_authorization_snapshot($1,$2,now()),
          'integration.connection.manage','COMPANY',$4,NULL,NULL,NULL
        ) AS "companyForeign",
        axora_snapshot_has_permission(
          axora_live_authorization_snapshot($5,$6,now()),
          'integration.application.manage','PLATFORM',NULL,NULL,NULL,NULL
        ) AS "ownerApplication",
        axora_permission_allowed_for_account_kind(
          'COMPANY','integration.application.manage'
        ) AS "companyApplicationCeiling",
        axora_permission_allowed_for_account_kind(
          'COMPANY','integration.operations.view'
        ) AS "companyOperationsCeiling"
    `, [
      ids.adminA,ids.adminAAssignment,ids.companyA,ids.companyB,
      ids.owner,ids.ownerAssignment,
    ]);
    expect(decisions.rows[0]).toEqual({
      companyOwn: true,
      companyForeign: false,
      ownerApplication: true,
      companyApplicationCeiling: false,
      companyOperationsCeiling: false,
    });
  });

  it("forces named integration RLS context and append-only audit evidence", async () => {
    await db.exec("SET ROLE axora_app");
    const hidden = await db.query<{ count: number }>(
      "SELECT count(*)::int count FROM integration_applications",
    );
    expect(hidden.rows[0]?.count).toBe(0);

    await db.exec("SAVEPOINT denied_write");
    await expect(db.query(`
      INSERT INTO integration_applications(
        client_id,client_secret_hash,client_type,token_endpoint_auth_method,
        slug,name,redirect_uris,allowed_scopes
      ) VALUES ($1,$2,'CONFIDENTIAL','client_secret_basic','denied-fixture',
        'Denied fixture',ARRAY['https://client.example.test/callback'],
        ARRAY['companies:read']::text[])
    `, [`axora_client_${"d".repeat(24)}`,"d".repeat(64)])).rejects.toThrow();
    await db.exec("ROLLBACK TO SAVEPOINT denied_write");

    await setIntegrationContext(db, "integration-management");
    const visible = await db.query<{ count: number }>(
      "SELECT count(*)::int count FROM integration_applications",
    );
    expect(visible.rows[0]?.count).toBe(1);
    await db.query(`
      INSERT INTO integration_api_audit(
        request_id,application_id,route,action,result,http_status,details
      ) VALUES ($1,$2,'/api/v1/me','READ_ME','SUCCESS',200,'{}'::jsonb)
    `, ["f1280000-0000-4000-8000-000000000099",ids.application]);
    const grants = await db.query<{ privilegeType: string }>(`
      SELECT privilege_type AS "privilegeType"
      FROM information_schema.role_table_grants
      WHERE grantee='axora_app' AND table_name='integration_api_audit'
      ORDER BY privilege_type
    `);
    expect(grants.rows).toEqual([
      { privilegeType: "INSERT" },
      { privilegeType: "SELECT" },
    ]);

    await db.exec("RESET ROLE");
    await db.exec("SAVEPOINT immutable_audit");
    await expect(db.query(`UPDATE integration_api_audit
      SET result='ERROR' WHERE request_id=$1`, [
      "f1280000-0000-4000-8000-000000000099",
    ])).rejects.toThrow(/append-only/i);
    await db.exec("ROLLBACK TO SAVEPOINT immutable_audit");

    const auditForeignKeys = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM pg_constraint constraint_record
      JOIN pg_class source_table ON source_table.oid=constraint_record.conrelid
      JOIN pg_namespace source_namespace
        ON source_namespace.oid=source_table.relnamespace
      WHERE constraint_record.contype='f'
        AND source_namespace.nspname='public'
        AND source_table.relname='integration_api_audit'
    `);
    expect(auditForeignKeys.rows[0]?.count).toBe(0);

    await db.query(`
      INSERT INTO integration_api_audit(
        request_id,application_id,connection_id,company_id,grant_id,
        delegating_user_id,route,action,result,http_status,details
      ) VALUES ($1,$2,$3,$4,$5,$6,'/api/v1/requests','LIST_REQUESTS',
        'DENIED',403,'{}'::jsonb)
    `, [
      "f1280000-0000-4000-8000-000000000098",
      "f1280000-0000-4000-8000-000000000091",
      "f1280000-0000-4000-8000-000000000092",
      "f1280000-0000-4000-8000-000000000093",
      "f1280000-0000-4000-8000-000000000094",
      "f1280000-0000-4000-8000-000000000095",
    ]);
    const detachedEvidence = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM integration_api_audit
      WHERE request_id=$1 AND company_id=$2
    `, [
      "f1280000-0000-4000-8000-000000000098",
      "f1280000-0000-4000-8000-000000000093",
    ]);
    expect(detachedEvidence.rows[0]?.count).toBe(1);
  });

  it("classifies company-owned integration state without deleting audit evidence", async () => {
    const ownership = await db.query<{
      tableName: string;
      unprotectedAction: string;
      protectedAction: string;
      inDag: boolean;
    }>(`
      SELECT rule.table_name AS "tableName",
        rule.unprotected_action AS "unprotectedAction",
        rule.protected_action AS "protectedAction",
        EXISTS(
          SELECT 1 FROM company_deletion_ownership_dag dag
          WHERE dag.table_name=rule.table_name
        ) AS "inDag"
      FROM company_deletion_ownership_rules rule
      WHERE rule.table_name IN (
        'integration_api_audit','integration_api_idempotency',
        'integration_connections','integration_oauth_access_tokens',
        'integration_oauth_authorization_codes',
        'integration_oauth_authorization_requests','integration_oauth_grants',
        'integration_oauth_refresh_families','integration_request_drafts'
      )
        AND EXISTS (
          SELECT 1 FROM information_schema.columns column_record
          WHERE column_record.table_schema='public'
            AND column_record.table_name=rule.table_name
            AND column_record.column_name='company_id'
        )
      ORDER BY rule.table_name
    `);
    expect(ownership.rows).toEqual([
      {
        tableName: "integration_api_audit",
        unprotectedAction: "RETAIN_WITH_ACCESS_REVOKED",
        protectedAction: "RETAIN_WITH_ACCESS_REVOKED",
        inDag: false,
      },
      ...[
        "integration_api_idempotency",
        "integration_connections",
        "integration_oauth_access_tokens",
        "integration_oauth_authorization_codes",
        "integration_oauth_authorization_requests",
        "integration_oauth_grants",
        "integration_oauth_refresh_families",
        "integration_request_drafts",
      ].map((tableName) => ({
        tableName,
        unprotectedAction: "CASCADE_DELETE",
        protectedAction: "RETAIN_WITH_ACCESS_REVOKED",
        inDag: true,
      })),
    ].sort((left,right) => left.tableName.localeCompare(right.tableName)));

    const idempotencyUnique = await db.query<{ columns: string[] }>(`
      SELECT array_agg(attribute.attname ORDER BY key_column.ordinality) AS columns
      FROM pg_constraint constraint_record
      CROSS JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY
        AS key_column(attribute_number,ordinality)
      JOIN pg_attribute attribute
        ON attribute.attrelid=constraint_record.conrelid
       AND attribute.attnum=key_column.attribute_number
      WHERE constraint_record.contype='u'
        AND constraint_record.conrelid='public.integration_api_idempotency'::regclass
      GROUP BY constraint_record.oid
    `);
    expect(idempotencyUnique.rows).toEqual([{
      columns: ["connection_id","command","idempotency_key_hash"],
    }]);
  });

  it("rejects cross-application OAuth rows at the database boundary", async () => {
    await setIntegrationContext(db, "integration-maintenance");
    const otherApplication = "f1280000-0000-4000-8000-000000000032";
    await db.query(`
      INSERT INTO integration_applications(
        id,client_id,client_secret_hash,client_type,token_endpoint_auth_method,
        slug,name,redirect_uris,allowed_scopes
      ) VALUES ($1,$2,$3,'CONFIDENTIAL','client_secret_basic','other-fixture',
        'Other fixture',ARRAY['https://other.example.test/callback'],
        ARRAY['companies:read']::text[])
    `, [otherApplication,`axora_client_${"e".repeat(24)}`,"e".repeat(64)]);
    await db.exec("SAVEPOINT wrong_application");
    await expect(db.query(`
      INSERT INTO integration_oauth_grants(
        application_id,connection_id,company_id,user_id,role_assignment_id,
        auth_version_at_grant,scopes,expires_at
      ) VALUES ($1,$2,$3,$4,$5,1,ARRAY['companies:read']::text[],
        now()+interval '1 day')
    `, [
      otherApplication,ids.connectionA,ids.companyA,ids.adminA,
      ids.adminAAssignment,
    ])).rejects.toThrow();
    await db.exec("ROLLBACK TO SAVEPOINT wrong_application");
  });

  it("upgrades 127 additively without changing accounts, email, or financial rows", async () => {
    const upgradeDb = new PGlite();
    try {
      await upgradeDb.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(upgradeDb, {
        through: "127_transactional_email_owner_reconciliation.sql",
      });
      await applyDemoSeed(upgradeDb);
      const companyId = "f1280000-0000-4000-8000-000000000101";
      const userId = "f1280000-0000-4000-8000-000000000102";
      const assignmentId = "f1280000-0000-4000-8000-000000000103";
      await upgradeDb.query(`
        INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
        VALUES ($1,'UPGRADE-128','Upgrade preservation tenant',true,0)
      `, [companyId]);
      await upgradeDb.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,company_id,is_owner,
          account_setup_completed_at,email_verified_at,account_kind,
          account_status,active,auth_version
        ) SELECT $1,'preserved-128@example.test','Preserved 128',
          'not-a-real-hash',id,$2,false,now(),now(),'COMPANY','ACTIVE',true,7
        FROM roles WHERE role_key='COMPANY_ADMIN'
      `, [userId,companyId]);
      await upgradeDb.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES ($1,$2,'ACTIVE',true,now())
      `, [userId,companyId]);
      await upgradeDb.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_at
        ) SELECT $1,$2,id,'COMPANY',$3,true,now()
        FROM roles WHERE role_key='COMPANY_ADMIN'
      `, [assignmentId,userId,companyId]);

      const snapshot = async () => (await upgradeDb.query<{
        users: number;
        assignments: number;
        requests: number;
        invoices: number;
        deliveries: number;
        walletEntries: number;
        emailOutbox: number;
        workflowEmailOutbox: number;
        email: string;
        authVersion: number;
        assignmentActive: boolean;
        emailSchema: string;
      }>(`
        SELECT
          (SELECT count(*)::int FROM users) users,
          (SELECT count(*)::int FROM role_assignments) assignments,
          (SELECT count(*)::int FROM requests) requests,
          (SELECT count(*)::int FROM invoices) invoices,
          (SELECT count(*)::int FROM delivery_jobs) deliveries,
          (SELECT count(*)::int FROM company_wallet_ledger_entries) "walletEntries",
          (SELECT count(*)::int FROM transactional_email_outbox) "emailOutbox",
          (SELECT count(*)::int FROM workflow_email_outbox) "workflowEmailOutbox",
          account.email,account.auth_version::int AS "authVersion",
          assignment.active AS "assignmentActive",
          (
            SELECT string_agg(
              columns.table_name||':'||columns.ordinal_position::text||':'||
              columns.column_name||':'||columns.data_type||':'||columns.is_nullable,
              '|' ORDER BY columns.table_name,columns.ordinal_position
            )
            FROM information_schema.columns columns
            WHERE columns.table_schema='public' AND columns.table_name IN (
              'transactional_email_outbox','workflow_email_outbox'
            )
          ) AS "emailSchema"
        FROM users account
        JOIN role_assignments assignment ON assignment.id=$2
        WHERE account.id=$1
      `, [userId,assignmentId])).rows[0]!;

      const before = await snapshot();
      await upgradeDb.exec(await readFile(new URL(
        "../database/migrations/128_external_integration_foundation.sql",
        import.meta.url,
      ), "utf8"));
      expect(await snapshot()).toEqual(before);
      const isolation = await upgradeDb.query<{
        integrationTables: number;
        emailForeignKeys: number;
      }>(`
        SELECT
          (
            SELECT count(*)::int FROM information_schema.tables
            WHERE table_schema='public' AND table_name LIKE 'integration_%'
          ) AS "integrationTables",
          (
            SELECT count(*)::int
            FROM pg_constraint constraint_record
            JOIN pg_class source_table ON source_table.oid=constraint_record.conrelid
            JOIN pg_class target_table ON target_table.oid=constraint_record.confrelid
            WHERE constraint_record.contype='f'
              AND source_table.relname LIKE 'integration_%'
              AND target_table.relname IN (
                'transactional_email_outbox','workflow_email_outbox'
              )
          ) AS "emailForeignKeys"
      `);
      expect(isolation.rows[0]).toEqual({
        integrationTables: 13,
        emailForeignKeys: 0,
      });
    } finally {
      await upgradeDb.close();
    }
  }, 60_000);
});

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

describe("live delivery tracking migration", () => {
  it("installs private least-privilege tracking capabilities and retention controls", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app");
      await applyMigrations(db);
      const security = await db.query<{
        sessions_rls: boolean;
        points_select: boolean;
        point_execute: boolean;
        history_execute: boolean;
        purge_execute: boolean;
        active_index: string;
        point_trigger: string;
        event_trigger: string;
      }>(`
        SELECT
          (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
            FROM pg_class WHERE relname IN (
              'delivery_tracking_sessions','delivery_tracking_session_events',
              'delivery_tracking_points','delivery_tracking_route_summaries'
            )) AS sessions_rls,
          has_table_privilege(
            'axora_app','delivery_tracking_points','SELECT'
          ) AS points_select,
          has_function_privilege(
            'axora_app',
            'axora_record_delivery_location(uuid,uuid,uuid,uuid,uuid,bigint,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz)',
            'EXECUTE'
          ) AS point_execute,
          has_function_privilege(
            'axora_app',
            'axora_delivery_tracking_history(uuid,uuid,uuid,timestamptz)',
            'EXECUTE'
          ) AS history_execute,
          has_function_privilege(
            'axora_app',
            'axora_purge_expired_delivery_locations(timestamptz,integer)',
            'EXECUTE'
          ) AS purge_execute,
          pg_get_indexdef((SELECT indexrelid FROM pg_index
            WHERE indexrelid='delivery_tracking_one_active_driver_idx'::regclass
          )) AS active_index,
          pg_get_triggerdef((SELECT oid FROM pg_trigger
            WHERE tgname='delivery_tracking_points_immutable')) AS point_trigger,
          pg_get_triggerdef((SELECT oid FROM pg_trigger
            WHERE tgname='delivery_tracking_events_append_only')) AS event_trigger
      `);
      expect(security.rows[0]).toMatchObject({
        sessions_rls: true,
        points_select: false,
        point_execute: true,
        history_execute: true,
        purge_execute: false,
      });
      expect(security.rows[0].active_index).toContain("WHERE (status = 'ACTIVE'::text)");
      expect(security.rows[0].point_trigger).toContain("axora_reject_tracking_point_mutation");
      expect(security.rows[0].event_trigger).toContain("reject_append_only_mutation");
    } finally {
      await db.close();
    }
  }, 30_000);

  it("owns lifecycle, cross-tenant reads, stale ETA, GPS validation and dispute retention in PostgreSQL", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      await applyDemoSeed(db);
      await db.exec(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at
        )
        SELECT '68000000-0000-4000-8000-000000000001',
          'tracking-owner@example.test','Tracking Owner','not-a-real-hash',
          id,true,'PLATFORM','ACTIVE',now()
        FROM roles WHERE role_key='PLATFORM_OWNER';
        ALTER TABLE role_assignments DISABLE TRIGGER USER;
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        )
        SELECT '68000000-0000-4000-8000-000000000002',
          '68000000-0000-4000-8000-000000000001',id,'PLATFORM',true,
          '68000000-0000-4000-8000-000000000001',now()-interval '1 day'
        FROM roles WHERE role_key='PLATFORM_OWNER';
      `);
      const scope = await db.query<{
        request_id: string;
        company_id: string;
        branch_id: string;
      }>(`
        SELECT request.id AS request_id,request.company_id,request.branch_id
        FROM requests request
        ORDER BY request.created_at,request.id
        LIMIT 1
      `);
      const ids = scope.rows[0];
      const otherScope = await db.query<{
        company_id: string;
        branch_id: string;
      }>(`
        SELECT branch.company_id,branch.id AS branch_id
        FROM branches branch
        WHERE branch.company_id<>$1
        ORDER BY branch.created_at,branch.id
        LIMIT 1
      `, [ids.company_id]);
      const otherIds = otherScope.rows[0];
      const ownerIds = {
        id: "68000000-0000-4000-8000-000000000001",
        role_assignment_id: "68000000-0000-4000-8000-000000000002",
      };
      expect(ids).toBeTruthy();
      expect(otherIds).toBeTruthy();

      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at
        )
        SELECT '68100000-0000-4000-8000-000000000001',
          'tracking-agent@example.test','Tracking Agent','not-a-real-hash',
          id,false,'DELIVERY','ACTIVE',now()
        FROM roles WHERE role_key='DELIVERY_AGENT';
      `);
      await db.query(`
        INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
        VALUES (
          '68100000-0000-4000-8000-000000000001','TRACK-AGENT-068',true
        );
      `);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        )
        SELECT '68100000-0000-4000-8000-000000000002',
          '68100000-0000-4000-8000-000000000001',id,'DELIVERY',true,$1,
          now()-interval '1 day'
        FROM roles WHERE role_key='DELIVERY_AGENT';
      `, [ownerIds.id]);
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at,company_id,branch_id
        )
        SELECT '68100000-0000-4000-8000-000000000003',
          'tracking-receiver@example.test','Tracking Receiver',
          'not-a-real-hash',id,false,'COMPANY','ACTIVE',now(),$1,$2
        FROM roles WHERE role_key='RECEIVING_USER';
      `, [ids.company_id, ids.branch_id]);
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES (
          '68100000-0000-4000-8000-000000000003',$1,'ACTIVE',true,now()
        )
      `, [ids.company_id]);
      await db.query(`
        INSERT INTO users(
          id,email,display_name,password_hash,role_id,is_owner,account_kind,
          account_status,email_verified_at,company_id,branch_id
        )
        SELECT '68100000-0000-4000-8000-000000000005',
          'tracking-other-receiver@example.test','Other Tracking Receiver',
          'not-a-real-hash',id,false,'COMPANY','ACTIVE',now(),$1,$2
        FROM roles WHERE role_key='RECEIVING_USER';
      `, [otherIds.company_id, otherIds.branch_id]);
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at
        ) VALUES (
          '68100000-0000-4000-8000-000000000005',$1,'ACTIVE',true,now()
        )
      `, [otherIds.company_id]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,
          active,assigned_by,assigned_at
        )
        SELECT '68100000-0000-4000-8000-000000000004',
          '68100000-0000-4000-8000-000000000003',id,'BRANCH',$1,$2,
          true,$3,now()-interval '1 day'
        FROM roles WHERE role_key='RECEIVING_USER';
      `, [ids.company_id, ids.branch_id, ownerIds.id]);
      await db.query(`
        INSERT INTO role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,
          active,assigned_by,assigned_at
        )
        SELECT '68100000-0000-4000-8000-000000000006',
          '68100000-0000-4000-8000-000000000005',id,'BRANCH',$1,$2,
          true,$3,now()-interval '1 day'
        FROM roles WHERE role_key='RECEIVING_USER';
      `, [otherIds.company_id, otherIds.branch_id, ownerIds.id]);
      await db.exec("ALTER TABLE user_scopes DISABLE TRIGGER USER");
      await db.query(`
        INSERT INTO user_scopes(
          user_id,scope_type,company_id,branch_id,source,source_reference,
          starts_at,active,assigned_by
        ) VALUES
          (
            '68000000-0000-4000-8000-000000000001','PLATFORM',NULL,NULL,
            'ROLE_ASSIGNMENT','68000000-0000-4000-8000-000000000002',
            now()-interval '1 day',true,
            '68000000-0000-4000-8000-000000000001'
          ),
          (
            '68100000-0000-4000-8000-000000000001','DELIVERY',NULL,NULL,
            'ROLE_ASSIGNMENT','68100000-0000-4000-8000-000000000002',
            now()-interval '1 day',true,
            '68000000-0000-4000-8000-000000000001'
          ),
          (
            '68100000-0000-4000-8000-000000000003','BRANCH',$1,$2,
            'ROLE_ASSIGNMENT','68100000-0000-4000-8000-000000000004',
            now()-interval '1 day',true,$3
          ),
          (
            '68100000-0000-4000-8000-000000000005','BRANCH',$4,$5,
            'ROLE_ASSIGNMENT','68100000-0000-4000-8000-000000000006',
            now()-interval '1 day',true,$3
          );
      `, [ids.company_id, ids.branch_id, ownerIds.id,
        otherIds.company_id, otherIds.branch_id]);
      await db.exec("ALTER TABLE user_scopes ENABLE TRIGGER USER");
      await db.exec("ALTER TABLE role_assignments ENABLE TRIGGER USER");
      await db.query(`
        INSERT INTO branch_assignments(
          user_id,company_id,branch_id,status,is_primary,created_at
        ) VALUES (
          '68100000-0000-4000-8000-000000000003',$1,$2,'ACTIVE',true,
          now()-interval '1 day'
        )
        ON CONFLICT(user_id,branch_id) DO UPDATE SET status='ACTIVE';
      `, [ids.company_id, ids.branch_id]);
      await db.query(`
        INSERT INTO branch_assignments(
          user_id,company_id,branch_id,status,is_primary,created_at
        ) VALUES (
          '68100000-0000-4000-8000-000000000005',$1,$2,'ACTIVE',true,
          now()-interval '1 day'
        )
        ON CONFLICT(user_id,branch_id) DO UPDATE SET status='ACTIVE';
      `, [otherIds.company_id, otherIds.branch_id]);
      await db.exec(
        "ALTER TABLE user_permission_overrides DISABLE TRIGGER USER",
      );
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,
          reason,changed_by
        )
        SELECT
          '68000000-0000-4000-8000-000000000001',permission.id,
          'GRANT','PLATFORM',now()-interval '1 day',true,
          'Tracking integration owner capability',
          '68000000-0000-4000-8000-000000000001'
        FROM permissions permission
        WHERE permission.permission_code IN (
          'delivery.manage','delivery.tracking.history'
        )
      `);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,
          reason,changed_by
        )
        SELECT
          '68100000-0000-4000-8000-000000000001',permission.id,
          'GRANT','DELIVERY',now()-interval '1 day',true,
          'Tracking integration driver capability',$1
        FROM permissions permission
        WHERE permission.permission_code='delivery.track'
      `, [ownerIds.id]);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,company_id,branch_id,
          starts_at,active,reason,changed_by
        )
        SELECT
          '68100000-0000-4000-8000-000000000003',permission.id,
          'GRANT','BRANCH',$1,$2,now()-interval '1 day',true,
          'Tracking integration receiving capability',$3
        FROM permissions permission
        WHERE permission.permission_code='receiving.confirm'
      `, [ids.company_id, ids.branch_id, ownerIds.id]);
      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,company_id,branch_id,
          starts_at,active,reason,changed_by
        )
        SELECT
          '68100000-0000-4000-8000-000000000005',permission.id,
          'GRANT','BRANCH',$1,$2,now()-interval '1 day',true,
          'Cross-company tracking isolation capability',$3
        FROM permissions permission
        WHERE permission.permission_code='receiving.confirm'
      `, [otherIds.company_id, otherIds.branch_id, ownerIds.id]);
      await db.exec(
        "ALTER TABLE user_permission_overrides ENABLE TRIGGER USER",
      );
      await db.query(`
        SELECT set_config('axora.user_id',$1,false),
          set_config('axora.role_assignment_id',$2,false)
      `, [ownerIds.id, ownerIds.role_assignment_id]);

      await db.query(`
        INSERT INTO delivery_jobs(
          id,company_id,branch_id,request_id,job_code,status,
          scheduled_window_start,scheduled_window_end,
          delivery_address_snapshot,idempotency_key,created_by
        ) VALUES (
          '68200000-0000-4000-8000-000000000001',$1,$2,$3,
          'DEL-TRACKING-068','ASSIGNED',now(),now()+interval '3 hours',
          'Tracking destination','delivery-tracking-068',$4
        );
      `, [ids.company_id, ids.branch_id, ids.request_id, ownerIds.id]);
      await db.query(`
        INSERT INTO delivery_job_assignments(
          id,company_id,delivery_job_id,driver_user_id,status,assigned_by,
          assigned_at,accepted_at,driver_role_assignment_id,
          supervisor_role_assignment_id,expected_job_version,
          assignment_reason,acceptance_deadline,command_id
        ) VALUES (
          '68300000-0000-4000-8000-000000000001',$1,
          '68200000-0000-4000-8000-000000000001',
          '68100000-0000-4000-8000-000000000001','ACCEPTED',$2,
          now()-interval '10 minutes',now()-interval '9 minutes',
          '68100000-0000-4000-8000-000000000002',$3,1,
          'Tracking lifecycle assignment',now()+interval '1 hour',
          '68300000-0000-4000-8000-000000000002'
        );
      `, [ids.company_id, ownerIds.id, ownerIds.role_assignment_id]);

      const created = await db.query<{ id: string; status: string }>(`
        SELECT id,status
        FROM delivery_tracking_sessions
        WHERE assignment_id='68300000-0000-4000-8000-000000000001'
      `);
      expect(created.rows[0].status).toBe("NOT_STARTED");
      const policyAccess = await db.query<{
        snapshot: boolean;
        base_scope: boolean;
        role_permission: boolean;
        override_permission: boolean;
        permission: boolean;
        assignment_active: boolean;
      }>(`
        WITH auth_snapshot AS (
          SELECT axora_live_authorization_snapshot($1,$2,now()) AS snapshot
        )
        SELECT
          auth_snapshot.snapshot IS NOT NULL AS snapshot,
          axora_snapshot_scope_contains(
            auth_snapshot.snapshot,'PLATFORM',NULL,NULL,NULL,NULL
          ) AS base_scope,
          COALESCE(auth_snapshot.snapshot->'rolePermissions','[]'::jsonb)
            ? 'delivery.manage' AS role_permission,
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              COALESCE(
                auth_snapshot.snapshot->'permissionOverrides','[]'::jsonb
              )
            ) permission_override
            WHERE permission_override->>'permission'='delivery.manage'
              AND permission_override->>'effect'='GRANT'
          ) AS override_permission,
          axora_snapshot_has_permission(
            auth_snapshot.snapshot,'delivery.manage','PLATFORM',
            NULL,NULL,NULL,NULL
          ) AS permission,
          EXISTS (
            SELECT 1
            FROM delivery_tracking_sessions session
            JOIN delivery_job_assignments assignment
              ON assignment.id=session.assignment_id
            WHERE session.id=$3
              AND assignment.status IN ('ASSIGNED','ACCEPTED')
              AND assignment.ended_at IS NULL
          ) AS assignment_active
        FROM auth_snapshot
      `, [ownerIds.id, ownerIds.role_assignment_id, created.rows[0].id]);
      expect(policyAccess.rows[0]).toEqual({
        snapshot: true,
        base_scope: true,
        role_permission: true,
        override_permission: true,
        permission: true,
        assignment_active: true,
      });

      await db.query(`
        SELECT axora_configure_delivery_tracking(
          $1,$2,$3,3.141200,101.690000,'APPROXIMATE',true,
          'AXORA_RELAY',30,'Van','White','AXR 204',
          'Approved tracking policy for integration test',now()
        )
      `, [ownerIds.id, ownerIds.role_assignment_id, created.rows[0].id]);
      await db.exec(`
        SELECT set_config(
          'axora.user_id','68100000-0000-4000-8000-000000000001',false
        );
        SELECT set_config(
          'axora.role_assignment_id',
          '68100000-0000-4000-8000-000000000002',false
        );
        UPDATE delivery_jobs
        SET status='ITEMS_ACQUIRED',status_changed_at=now()-interval '1 minute'
        WHERE id='68200000-0000-4000-8000-000000000001';
        UPDATE delivery_jobs
        SET status='OUT_FOR_DELIVERY',status_changed_at=now()
        WHERE id='68200000-0000-4000-8000-000000000001';
      `);
      const active = await db.query<{ status: string }>(`
        SELECT status FROM delivery_tracking_sessions WHERE id=$1
      `, [created.rows[0].id]);
      expect(active.rows[0].status).toBe("ACTIVE");

      await db.query(`
        SELECT axora_record_delivery_location(
          '68100000-0000-4000-8000-000000000001',
          '68100000-0000-4000-8000-000000000002',$1,
          '68400000-0000-4000-8000-000000000001',
          '68400000-0000-4000-8000-000000000002',1,
          3.139000,101.686900,12,NULL,NULL,now(),now()
        )
      `, [created.rows[0].id]);
      await expect(db.query(`
        SELECT axora_record_delivery_location(
          '68100000-0000-4000-8000-000000000001',
          '68100000-0000-4000-8000-000000000002',$1,
          '68400000-0000-4000-8000-000000000003',
          '68400000-0000-4000-8000-000000000002',2,
          40.712800,-74.006000,12,NULL,NULL,
          now()+interval '1 second',now()+interval '1 second'
        )
      `, [created.rows[0].id])).rejects.toThrow(/movement validation/);

      await db.exec(`
        SELECT set_config(
          'axora.user_id','68100000-0000-4000-8000-000000000003',false
        );
        SELECT set_config(
          'axora.role_assignment_id',
          '68100000-0000-4000-8000-000000000004',false
        );
      `);
      const receiverAccess = await db.query<{
        snapshot: boolean;
        base_scope: boolean;
        permission: boolean;
        receiving_assignment: boolean;
      }>(`
        WITH auth_snapshot AS (
          SELECT axora_live_authorization_snapshot(
            '68100000-0000-4000-8000-000000000003',
            '68100000-0000-4000-8000-000000000004',now()
          ) AS snapshot
        )
        SELECT
          auth_snapshot.snapshot IS NOT NULL AS snapshot,
          axora_snapshot_scope_contains(
            auth_snapshot.snapshot,'BRANCH',$1,$2,NULL,NULL
          ) AS base_scope,
          axora_snapshot_has_permission(
            auth_snapshot.snapshot,'receiving.confirm','BRANCH',
            $1,$2,NULL,NULL
          ) AS permission,
          axora_user_can_receive(
            '68100000-0000-4000-8000-000000000003',$1,$2
          ) AS receiving_assignment
        FROM auth_snapshot
      `, [ids.company_id, ids.branch_id]);
      expect(receiverAccess.rows[0]).toEqual({
        snapshot: true,
        base_scope: true,
        permission: true,
        receiving_assignment: true,
      });
      const company = await db.query<{ value: { sessions: Array<{
        sessionId: string;
        visibilityPrecision: string;
        vehicleRegistration: string;
      }> } }>(`
        SELECT axora_company_delivery_tracking_workspace(
          '68100000-0000-4000-8000-000000000003',
          '68100000-0000-4000-8000-000000000004',now()
        ) AS value
      `);
      expect(company.rows[0].value.sessions).toHaveLength(1);
      expect(company.rows[0].value.sessions[0]).toMatchObject({
        sessionId: created.rows[0].id,
        visibilityPrecision: "APPROXIMATE",
        vehicleRegistration: "AXR 204",
      });

      await db.exec(`
        SELECT set_config(
          'axora.user_id','68100000-0000-4000-8000-000000000005',false
        );
        SELECT set_config(
          'axora.role_assignment_id',
          '68100000-0000-4000-8000-000000000006',false
        );
      `);
      const crossCompany = await db.query<{
        value: { sessions: unknown[] };
      }>(`
        SELECT axora_company_delivery_tracking_workspace(
          '68100000-0000-4000-8000-000000000005',
          '68100000-0000-4000-8000-000000000006',now()
        ) AS value
      `);
      expect(crossCompany.rows[0].value.sessions).toEqual([]);

      await db.query(`
        SELECT set_config('axora.user_id',$1,false),
          set_config('axora.role_assignment_id',$2,false)
      `, [ownerIds.id, ownerIds.role_assignment_id]);
      const unauthorized = await db.query<{ value: { sessions: unknown[] } }>(`
        SELECT axora_company_delivery_tracking_workspace(
          $1,$2,now()
        ) AS value
      `, [ownerIds.id, ownerIds.role_assignment_id]);
      expect(unauthorized.rows[0].value.sessions).toEqual([]);

      await db.exec(`
        SELECT set_config(
          'axora.user_id','68100000-0000-4000-8000-000000000003',false
        );
        SELECT set_config(
          'axora.role_assignment_id',
          '68100000-0000-4000-8000-000000000004',false
        );
      `);
      const stale = await db.query<{ value: { sessions: Array<{
        stale: boolean;
        etaSeconds: number | null;
      }> } }>(`
        SELECT axora_company_delivery_tracking_workspace(
          '68100000-0000-4000-8000-000000000003',
          '68100000-0000-4000-8000-000000000004',
          now()+interval '5 minutes'
        ) AS value
      `);
      expect(stale.rows[0].value.sessions[0]).toMatchObject({
        stale: true,
        etaSeconds: null,
      });

      await db.query(`
        UPDATE delivery_job_assignments
        SET status='REASSIGNED',ended_at=now(),updated_at=now()
        WHERE id='68300000-0000-4000-8000-000000000001'
      `);
      const revoked = await db.query<{ status: string }>(`
        SELECT status FROM delivery_tracking_sessions WHERE id=$1
      `, [created.rows[0].id]);
      expect(revoked.rows[0].status).toBe("REVOKED");
      const endedCompany = await db.query<{ value: { sessions: unknown[] } }>(`
        SELECT axora_company_delivery_tracking_workspace(
          '68100000-0000-4000-8000-000000000003',
          '68100000-0000-4000-8000-000000000004',now()
        ) AS value
      `);
      expect(endedCompany.rows[0].value.sessions).toEqual([]);

      await db.query(`
        SELECT set_config('axora.user_id',$1,false),
          set_config('axora.role_assignment_id',$2,false)
      `, [ownerIds.id, ownerIds.role_assignment_id]);
      const history = await db.query<{ value: { sessions: Array<{
        points: unknown[];
      }> } }>(`
        SELECT axora_delivery_tracking_history(
          $1,$2,'68200000-0000-4000-8000-000000000001',now()
        ) AS value
      `, [ownerIds.id, ownerIds.role_assignment_id]);
      expect(history.rows[0].value.sessions[0].points).toHaveLength(1);
      const expiredHistory = await db.query<{ value: { sessions: Array<{
        points: unknown[];
      }> } }>(`
        SELECT axora_delivery_tracking_history(
          $1,$2,'68200000-0000-4000-8000-000000000001',
          now()+interval '31 days'
        ) AS value
      `, [ownerIds.id, ownerIds.role_assignment_id]);
      expect(expiredHistory.rows[0].value.sessions[0].points).toEqual([]);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("keeps lifecycle and tenant ownership checks inside security-definer functions", async () => {
    const db = new PGlite();
    try {
      await applyMigrations(db);
      const definitions = await db.query<{
        point: string;
        company: string;
        lifecycle: string;
        history: string;
        purge: string;
      }>(`
        SELECT
          pg_get_functiondef(
            'axora_record_delivery_location(uuid,uuid,uuid,uuid,uuid,bigint,numeric,numeric,numeric,numeric,numeric,timestamptz,timestamptz)'::regprocedure
          ) AS point,
          pg_get_functiondef(
            'axora_company_delivery_tracking_workspace(uuid,uuid,timestamptz)'::regprocedure
          ) AS company,
          pg_get_functiondef(
            'axora_delivery_tracking_job_lifecycle()'::regprocedure
          ) AS lifecycle,
          pg_get_functiondef(
            'axora_delivery_tracking_history(uuid,uuid,uuid,timestamptz)'::regprocedure
          ) AS history,
          pg_get_functiondef(
            'axora_purge_expired_delivery_locations(timestamptz,integer)'::regprocedure
          ) AS purge
      `);
      const row = definitions.rows[0];
      expect(row.point).toContain("session.driver_user_id<>p_actor_user_id");
      expect(row.point).toContain("'delivery.track','DELIVERY'");
      expect(row.point).toContain("movement validation");
      expect(row.company).toContain("'receiving.confirm','BRANCH'");
      expect(row.company).toContain("axora_user_can_receive");
      expect(row.company).toContain("session.status IN ('ACTIVE','PAUSED')");
      expect(row.lifecycle).toContain("NEW.status='OUT_FOR_DELIVERY'");
      expect(row.lifecycle).toContain("'COMPLETED','CANCELLED','FAILED','RETURNED'");
      expect(row.history).toContain("delivery.tracking.history");
      expect(row.history).toContain("point.retention_until>p_at");
      expect(row.purge).toContain("FOR UPDATE SKIP LOCKED");
    } finally {
      await db.close();
    }
  }, 30_000);
});

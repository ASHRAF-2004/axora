import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

const ids = {
  company: "10000000-0000-4000-8000-000000000001",
  branch: "20000000-0000-4000-8000-000000000001",
  requestOne: "50000000-0000-4000-8000-000000000001",
  requestTwo: "50000000-0000-4000-8000-000000000002",
  lineOne: "60000000-0000-4000-8000-000000000001",
  lineTwo: "60000000-0000-4000-8000-000000000002",
  supplierOne: "30000000-0000-4000-8000-000000000001",
  supplierTwo: "30000000-0000-4000-8000-000000000002",
  platform: "d6000000-0000-4000-8000-000000000001",
  supplierUserOne: "d6010000-0000-4000-8000-000000000001",
  supplierUserTwo: "d6010000-0000-4000-8000-000000000002",
  companyUser: "d6010000-0000-4000-8000-000000000003",
  driverOne: "d6020000-0000-4000-8000-000000000001",
  driverTwo: "d6020000-0000-4000-8000-000000000002",
  rfqOne: "d6030000-0000-4000-8000-000000000001",
  rfqTwo: "d6030000-0000-4000-8000-000000000002",
  jobOne: "d6040000-0000-4000-8000-000000000001",
  jobTwo: "d6040000-0000-4000-8000-000000000002",
  assignmentOne: "d6050000-0000-4000-8000-000000000001",
  assignmentTwo: "d6050000-0000-4000-8000-000000000002",
  supplierEventOne: "d6060000-0000-4000-8000-000000000001",
  supplierEventTwo: "d6060000-0000-4000-8000-000000000002",
  driverEventOne: "d6060000-0000-4000-8000-000000000003",
  driverEventTwo: "d6060000-0000-4000-8000-000000000004",
};

describe("workflow event supplier and driver isolation", () => {
  let db: PGlite;

  const assumeAppUser = async (userId: string) => {
    await db.exec("SET ROLE axora_app");
    await db.query("SELECT set_config('axora.user_id',$1,false)", [userId]);
  };

  const resetRole = async () => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('axora.user_id','',false)");
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db, { through: "073_production_route_stabilization.sql" });
    await applyDemoSeed(db);
    await db.exec(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status
      ) SELECT '${ids.platform}','workflow-platform@example.test','Workflow platform',
        'not-a-real-hash',id,true,'PLATFORM','ACTIVE'
      FROM roles WHERE role_key='PLATFORM_OWNER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status
      ) SELECT '${ids.supplierUserOne}','workflow-supplier-one@example.test','Supplier one',
        'not-a-real-hash',id,false,'SUPPLIER','ACTIVE'
      FROM roles WHERE role_key='SUPPLIER_USER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status
      ) SELECT '${ids.supplierUserTwo}','workflow-supplier-two@example.test','Supplier two',
        'not-a-real-hash',id,false,'SUPPLIER','ACTIVE'
      FROM roles WHERE role_key='SUPPLIER_USER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status
      ) SELECT '${ids.driverOne}','workflow-driver-one@example.test','Driver one',
        'not-a-real-hash',id,false,'DELIVERY','ACTIVE'
      FROM roles WHERE role_key='DELIVERY_DRIVER';
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,account_kind,account_status
      ) SELECT '${ids.driverTwo}','workflow-driver-two@example.test','Driver two',
        'not-a-real-hash',id,false,'DELIVERY','ACTIVE'
      FROM roles WHERE role_key='DELIVERY_DRIVER';

      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,is_owner,
        account_kind,account_status
      ) SELECT '${ids.companyUser}','workflow-company@example.test','Company actor',
        'not-a-real-hash',id,'${ids.company}',false,'COMPANY','ACTIVE'
      FROM roles WHERE role_key='COMPANY_ADMIN';
      INSERT INTO company_memberships(user_id,company_id,status,joined_at)
      VALUES ('${ids.companyUser}','${ids.company}','ACTIVE',now());
      INSERT INTO role_assignments(user_id,role_id,scope_type,company_id,active)
      SELECT '${ids.companyUser}',id,'COMPANY','${ids.company}',true
      FROM roles WHERE role_key='COMPANY_ADMIN';

      INSERT INTO supplier_memberships(user_id,supplier_id,status)
      VALUES
        ('${ids.supplierUserOne}','${ids.supplierOne}','ACTIVE'),
        ('${ids.supplierUserTwo}','${ids.supplierTwo}','ACTIVE');
      INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
      VALUES
        ('${ids.driverOne}','DRV-WORKFLOW-1',true),
        ('${ids.driverTwo}','DRV-WORKFLOW-2',true);

      INSERT INTO supplier_rfqs(
        id,company_id,request_line_id,supplier_id,rfq_reference,issued_by,
        idempotency_key,respond_by
      ) VALUES
        ('${ids.rfqOne}','${ids.company}','${ids.lineOne}','${ids.supplierOne}',
          'RFQ-WORKFLOW-1','${ids.platform}','rfq:workflow-one',now()+interval '1 day'),
        ('${ids.rfqTwo}','${ids.company}','${ids.lineTwo}','${ids.supplierTwo}',
          'RFQ-WORKFLOW-2','${ids.platform}','rfq:workflow-two',now()+interval '1 day');

      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,
        delivery_address_snapshot,idempotency_key,created_by
      ) VALUES
        ('${ids.jobOne}','${ids.company}','${ids.branch}','${ids.requestOne}',
          'JOB-WORKFLOW-1','Workflow address one','job:workflow-one','${ids.platform}'),
        ('${ids.jobTwo}','${ids.company}','${ids.branch}','${ids.requestTwo}',
          'JOB-WORKFLOW-2','Workflow address two','job:workflow-two','${ids.platform}');
      INSERT INTO delivery_job_assignments(
        id,company_id,delivery_job_id,driver_user_id,status,assigned_by
      ) VALUES
        ('${ids.assignmentOne}','${ids.company}','${ids.jobOne}',
          '${ids.driverOne}','ASSIGNED','${ids.platform}'),
        ('${ids.assignmentTwo}','${ids.company}','${ids.jobTwo}',
          '${ids.driverTwo}','ASSIGNED','${ids.platform}');

      INSERT INTO workflow_events(
        id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES
        ('${ids.supplierEventOne}','${ids.company}','${ids.branch}','${ids.requestOne}',
          'supplier-rfq','${ids.rfqOne}','rfq.issued',1,'${ids.platform}','PLATFORM',
          '${ids.rfqOne}','workflow:rfq-one:issued',now(),'{}'::jsonb),
        ('${ids.supplierEventTwo}','${ids.company}','${ids.branch}','${ids.requestTwo}',
          'supplier-rfq','${ids.rfqTwo}','rfq.issued',1,'${ids.platform}','PLATFORM',
          '${ids.rfqTwo}','workflow:rfq-two:issued',now(),'{}'::jsonb),
        ('${ids.driverEventOne}','${ids.company}','${ids.branch}','${ids.requestOne}',
          'delivery-job','${ids.jobOne}','delivery.assigned',1,'${ids.platform}','PLATFORM',
          '${ids.jobOne}','workflow:job-one:assigned',now(),'{}'::jsonb),
        ('${ids.driverEventTwo}','${ids.company}','${ids.branch}','${ids.requestTwo}',
          'delivery-job','${ids.jobTwo}','delivery.assigned',1,'${ids.platform}','PLATFORM',
          '${ids.jobTwo}','workflow:job-two:assigned',now(),'{}'::jsonb);
    `);
  }, 30_000);

  afterAll(async () => {
    await resetRole();
    await db.close();
  });

  it("shows a supplier only its RFQ events and rejects competitor appends", async () => {
    await assumeAppUser(ids.supplierUserOne);
    const visible = await db.query<{ id: string }>(`
      SELECT id::text FROM workflow_events
      WHERE aggregate_type='supplier-rfq' ORDER BY id
    `);
    expect(visible.rows.map((row) => row.id)).toEqual([ids.supplierEventOne]);

    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES ($1,$2,$3,'supplier-rfq',$4,'quotation.received',2,$5,'SUPPLIER',
        $4,'workflow:rfq-competitor:malicious',now(),'{}'::jsonb)
    `, [ids.company, ids.branch, ids.requestTwo, ids.rfqTwo, ids.supplierUserOne]))
      .rejects.toThrow(/row-level security/i);

    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES ($1,$2,$3,'supplier-rfq',$4,'quotation.received',2,$5,'SUPPLIER',
        $4,'workflow:rfq-own:response',now(),'{}'::jsonb)
    `, [ids.company, ids.branch, ids.requestOne, ids.rfqOne, ids.supplierUserOne]))
      .resolves.not.toThrow();
    await resetRole();
  });

  it("shows a driver only assigned-job events and rejects competitor appends", async () => {
    await assumeAppUser(ids.driverOne);
    const visible = await db.query<{ id: string }>(`
      SELECT id::text FROM workflow_events
      WHERE aggregate_type='delivery-job' ORDER BY id
    `);
    expect(visible.rows.map((row) => row.id)).toEqual([ids.driverEventOne]);

    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES ($1,$2,$3,'delivery-job',$4,'delivery.arrived',2,$5,'DELIVERY',
        $4,'workflow:job-competitor:malicious',now(),'{}'::jsonb)
    `, [ids.company, ids.branch, ids.requestTwo, ids.jobTwo, ids.driverOne]))
      .rejects.toThrow(/row-level security/i);

    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES ($1,$2,$3,'delivery-job',$4,'delivery.arrived',2,$5,'DELIVERY',
        $4,'workflow:job-own:arrived',now(),'{}'::jsonb)
    `, [ids.company, ids.branch, ids.requestOne, ids.jobOne, ids.driverOne]))
      .resolves.not.toThrow();
    await resetRole();
  });

  it("retains platform writes and limits company actors to their assigned tenant", async () => {
    await assumeAppUser(ids.companyUser);
    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES ($1,$2,$3,'request',$3,'request.updated',1,$4,'COMPANY',
        $3,'workflow:company-own:update',now(),'{}'::jsonb)
    `, [ids.company, ids.branch, ids.requestOne, ids.companyUser]))
      .resolves.not.toThrow();

    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES (
        '10000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000006','request',
        '50000000-0000-4000-8000-000000000006','request.updated',1,$1,
        'COMPANY','50000000-0000-4000-8000-000000000006',
        'workflow:company-cross-tenant',now(),'{}'::jsonb
      )
    `, [ids.companyUser])).rejects.toThrow(/tenant|row-level security/i);
    await resetRole();

    await assumeAppUser(ids.platform);
    await expect(db.query(`
      INSERT INTO workflow_events(
        company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
        event_version,actor_user_id,actor_kind,correlation_id,idempotency_key,
        occurred_at,metadata
      ) VALUES (
        '10000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        '50000000-0000-4000-8000-000000000006','request',
        '50000000-0000-4000-8000-000000000006','request.updated',1,$1,
        'PLATFORM','50000000-0000-4000-8000-000000000006',
        'workflow:platform-cross-tenant',now(),'{}'::jsonb
      )
    `, [ids.platform])).resolves.not.toThrow();
    await resetRole();
  });
});

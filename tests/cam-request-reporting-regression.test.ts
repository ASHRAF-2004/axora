import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { applyDemoSeed, applyMigrations } from "./helpers/pglite";

type Actor = { userId: string; assignmentId: string };

const migrationUrl = new URL(
  "../database/migrations/119_cam_received_quantity_authorization.sql",
  import.meta.url,
);
const invoiceMigrationUrl = new URL(
  "../database/migrations/120_cam_customer_invoice_access.sql",
  import.meta.url,
);

const owner: Actor = {
  userId: "a1190000-0000-4000-8000-000000000001",
  assignmentId: "a1190000-0000-4000-8000-000000000002",
};

async function asActor<T>(db: PGlite, actor: Actor, operation: () => Promise<T>) {
  await db.exec("SET ROLE axora_app");
  try {
    await db.query(`
      SELECT set_config('axora.user_id',$1,false),
        set_config('axora.role_assignment_id',$2,false)
    `, [actor.userId, actor.assignmentId]);
    return await operation();
  } finally {
    await db.query(`
      SELECT set_config('axora.user_id','',false),
        set_config('axora.role_assignment_id','',false)
    `);
    await db.exec("RESET ROLE");
  }
}

async function createOwner(db: PGlite) {
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,email_verified_at,account_kind,
      account_status,active,auth_version
    ) SELECT $1,'cam-regression-owner@example.test','CAM regression owner',
      'not-a-real-hash',role.id,true,now(),now(),'PLATFORM','ACTIVE',true,1
    FROM roles role WHERE role.role_key='PLATFORM_OWNER'
  `, [owner.userId]);
  await db.query(`
    INSERT INTO user_profiles(
      user_id,display_name,preferred_locale,timezone,profile_completed_at
    ) VALUES ($1,'CAM regression owner','en','Asia/Kuala_Lumpur',now())
  `, [owner.userId]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,active,assigned_by,assigned_at
    ) SELECT $1,$2,role.id,'PLATFORM',true,$2,now()
    FROM roles role WHERE role.role_key='PLATFORM_OWNER'
  `, [owner.assignmentId, owner.userId]);
}

async function createCompany(db: PGlite, label: string) {
  const companyId = randomUUID();
  const branchId = randomUUID();
  await db.query(`
    INSERT INTO companies(
      id,company_code,name,active,contractual_ceiling,tax_rate,
      estimated_delivery_fee,created_by
    ) VALUES ($1,$2,$3,true,50000,0,0,$4)
  `, [companyId, `CAM-${label}`, `CAM ${label}`, owner.userId]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,
      city,timezone,monthly_budget,active
    ) VALUES ($1,$2,$3,$4,$5,$6,'Kuala Lumpur',
      'Asia/Kuala_Lumpur',100,true)
  `, [
    branchId,
    `CAM-B-${label}`,
    companyId,
    `CAM ${label} branch`,
    `CAM${label}`,
    `Controlled CAM ${label} destination`,
  ]);
  return { companyId, branchId };
}

async function createCam(
  db: PGlite,
  input: {
    label: string;
    scopeType: "PLATFORM" | "COMPANY";
    companyId?: string;
    revoked?: boolean;
    denyRequestView?: boolean;
    denyInvoiceView?: boolean;
  },
): Promise<Actor> {
  const actor = { userId: randomUUID(), assignmentId: randomUUID() };
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,is_owner,
      account_setup_completed_at,email_verified_at,account_kind,
      account_status,active,auth_version
    ) SELECT $1,$2,$3,'not-a-real-hash',role.id,false,
      now(),now(),'PLATFORM','ACTIVE',true,1
    FROM roles role WHERE role.role_key='CLIENT_ACCOUNT_MANAGER'
  `, [
    actor.userId,
    `${input.label}-${actor.userId}@example.test`,
    `CAM ${input.label}`,
  ]);
  await db.query(`
    INSERT INTO user_profiles(
      user_id,display_name,preferred_locale,timezone,profile_completed_at
    ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
  `, [actor.userId, `CAM ${input.label}`]);
  const historicalCompanyScope = input.scopeType === "COMPANY";
  if (historicalCompanyScope) {
    await db.exec("SET session_replication_role = replica");
  }
  try {
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,revoked_at,
        assigned_by,assigned_at
      ) SELECT $1,$2,role.id,$3,$4,$5,
        CASE WHEN $5 THEN NULL ELSE now() END,$6,now()
      FROM roles role WHERE role.role_key='CLIENT_ACCOUNT_MANAGER'
    `, [
      actor.assignmentId,
      actor.userId,
      input.scopeType,
      input.companyId ?? null,
      !input.revoked,
      owner.userId,
    ]);
  } catch (error) {
    throw new Error(`CAM ${input.label} role assignment failed`, { cause: error });
  } finally {
    if (historicalCompanyScope) {
      await db.exec("SET session_replication_role = origin");
    }
  }
  if (input.denyRequestView) {
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,starts_at,active,
        reason,changed_by
      ) SELECT $1,permission.id,'DENY','PLATFORM',now(),true,
        'CAM_REQUEST_ACCESS_BLOCKED',$2
      FROM permissions permission
      WHERE permission.permission_code='request.view'
    `, [actor.userId, owner.userId]);
  }
  if (input.denyInvoiceView) {
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,starts_at,active,
        reason,changed_by
      ) SELECT $1,permission.id,'DENY','PLATFORM',now(),true,
        'CAM_INVOICE_ACCESS_BLOCKED',$2
      FROM permissions permission
      WHERE permission.permission_code='finance.invoice.view'
    `, [actor.userId, owner.userId]);
  }
  return actor;
}

async function createDirectOrder(db: PGlite) {
  const { companyId, branchId } = await createCompany(db, "DIRECT");
  const admin: Actor = { userId: randomUUID(), assignmentId: randomUUID() };
  const productId = randomUUID();
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,is_owner,
      account_setup_completed_at,email_verified_at,account_kind,
      account_status,active,auth_version
    ) SELECT $1,$2,'Direct-order administrator','not-a-real-hash',role.id,
      $3,false,now(),now(),'COMPANY','ACTIVE',true,1
    FROM roles role WHERE role.role_key='COMPANY_ADMIN'
  `, [admin.userId, `direct-admin-${admin.userId}@example.test`, companyId]);
  await db.query(`
    INSERT INTO user_profiles(
      user_id,display_name,preferred_locale,timezone,profile_completed_at
    ) VALUES ($1,'Direct-order administrator','en','Asia/Kuala_Lumpur',now())
  `, [admin.userId]);
  await db.query(`
    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at,created_by
    ) VALUES ($1,$2,'ACTIVE',true,now(),$3)
  `, [admin.userId, companyId, owner.userId]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
    ) SELECT $1,$2,role.id,'COMPANY',$3,true,$4,now()
    FROM roles role WHERE role.role_key='COMPANY_ADMIN'
  `, [admin.assignmentId, admin.userId, companyId, owner.userId]);
  await asActor(db, admin, () => db.query(`
    SELECT axora_save_branch_delivery_location(
      $1,$2,$3,'Controlled direct-order destination',
      3.139000,101.686900,'Controlled instructions',
      'Configure CAM regression fixture',$4,now()
    )
  `, [admin.userId, admin.assignmentId, branchId, randomUUID()]));
  await db.query(`
    INSERT INTO products(
      id,product_code,name,category,subcategory,unit_of_measure,
      default_buy_price,default_sell_price,minimum_order_quantity,
      delivery_sla_days,active,needs_review
    ) VALUES ($1,$2,'CAM regression product','Office Basics','Writing',
      'unit',90.91,100,1,1,true,false)
  `, [productId, `CAM-P-${productId.slice(0, 8)}`]);
  await db.query(`
    INSERT INTO company_wallet_ledger_entries(
      company_id,entry_type,amount_delta,currency,effective_date,
      business_reference,reason,correlation_id,idempotency_key,
      actor_user_id,actor_role_assignment_id,posted_at
    ) VALUES ($1,'TOP_UP',100,'MYR',CURRENT_DATE,$2,
      'Controlled CAM regression fixture',$3,$4,$5,$6,now())
  `, [
    companyId,
    `CAM-TOPUP-${companyId.slice(0, 8)}`,
    randomUUID(),
    `cam-regression-topup-${randomUUID()}`,
    owner.userId,
    owner.assignmentId,
  ]);
  const product = await db.query<{ publicReference: string }>(`
    SELECT public_reference AS "publicReference" FROM products WHERE id=$1
  `, [productId]);
  const read = await asActor(db, admin, () => db.query<{
    cart: { id: string; version: number };
  }>(`
    SELECT axora_procurement_cart_command(
      $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
    ) AS cart
  `, [admin.userId, admin.assignmentId, branchId, randomUUID()]));
  const added = await asActor(db, admin, () => db.query<{
    cart: { id: string; version: number };
  }>(`
    SELECT axora_procurement_cart_command(
      $1,$2,$3,'ADD',$4,1,'',$5,$6,now()
    ) AS cart
  `, [
    admin.userId,
    admin.assignmentId,
    branchId,
    product.rows[0]!.publicReference,
    read.rows[0]!.cart.version,
    randomUUID(),
  ]));
  const placed = await asActor(db, admin, () => db.query<{
    result: { requestId: string; deliveryJobId: string; status: string };
  }>(`
    SELECT axora_company_admin_direct_purchase(
      $1,$2,$3,$4,$5,now()
    ) AS result
  `, [
    admin.userId,
    admin.assignmentId,
    added.rows[0]!.cart.id,
    added.rows[0]!.cart.version,
    randomUUID(),
  ]));
  const result = placed.rows[0]!.result;
  expect(result.status).toBe("SUCCESS");
  await db.exec("SET session_replication_role = replica");
  try {
    await db.query(`
      UPDATE delivery_jobs
      SET status='COMPLETED',status_changed_at=now(),
        tracking_stopped_at=now(),updated_at=now()
      WHERE id=$1
    `, [result.deliveryJobId]);
  } finally {
    await db.exec("SET session_replication_role = origin");
  }
  const line = await db.query<{ lineId: string }>(`
    SELECT id::text AS "lineId" FROM request_lines WHERE request_id=$1
  `, [result.requestId]);
  return {
    companyId,
    branchId,
    requestId: result.requestId,
    lineId: line.rows[0]!.lineId,
  };
}

async function requestProjection(db: PGlite, actor: Actor) {
  return asActor(db, actor, () => db.query<{
    requestId: string;
    receivedQuantity: string;
  }>(`
    SELECT request.id::text AS "requestId",
      axora_received_quantity(line.id)::text AS "receivedQuantity"
    FROM requests request
    JOIN axora_request_access_rows($1,$2,now()) access
      ON access.request_id=request.id
    JOIN request_lines line ON line.request_id=request.id
    WHERE access.resource_active
    ORDER BY request.id,line.id
  `, [actor.userId, actor.assignmentId]));
}

async function dashboardProjection(db: PGlite, actor: Actor) {
  return asActor(db, actor, () => db.query<{ attention: number }>(`
    WITH authorized AS (
      SELECT request.id
      FROM requests request
      JOIN axora_request_access_rows($1,$2,now()) access
        ON access.request_id=request.id
      WHERE access.resource_active
    )
    SELECT count(*) FILTER (
      WHERE axora_received_quantity(line.id)<line.quantity
    )::int AS attention
    FROM authorized
    JOIN request_lines line ON line.request_id=authorized.id
  `, [actor.userId, actor.assignmentId]));
}

describe("CAM request and dashboard receipt authorization regression", () => {
  it("reproduces migration 118, then uses the live assignment permission for the current CAM scope", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db, {
        through: "118_delivery_self_claim_acceptance_window.sql",
      });
      await applyDemoSeed(db);
      await createOwner(db);
      const direct = await createDirectOrder(db);
      const platformCam = await createCam(db, {
        label: "platform",
        scopeType: "PLATFORM",
      });
      const unsupportedCompanyCam = await createCam(db, {
        label: "historical-company-scope",
        scopeType: "COMPANY",
        companyId: direct.companyId,
      });
      const deniedCam = await createCam(db, {
        label: "denied",
        scopeType: "PLATFORM",
        denyRequestView: true,
      });
      const revokedCam = await createCam(db, {
        label: "revoked",
        scopeType: "PLATFORM",
        revoked: true,
      });
      const deniedInvoiceCam = await createCam(db, {
        label: "invoice-denied",
        scopeType: "PLATFORM",
        denyInvoiceView: true,
      });

      const fixtureEvidence = await db.query<{
        ordinaryRequests: number;
        directOrders: number;
        paidInvoices: number;
        completedDeliveries: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM requests
            WHERE purchase_mode='REQUEST') AS "ordinaryRequests",
          (SELECT count(*)::int FROM requests
            WHERE purchase_mode='COMPANY_ADMIN_DIRECT') AS "directOrders",
          (SELECT count(*)::int FROM invoices invoice
            JOIN payments payment ON payment.invoice_id=invoice.id
            WHERE invoice.lifecycle_status='FINALIZED'
              AND payment.payment_status='PAID') AS "paidInvoices",
          (SELECT count(*)::int FROM delivery_jobs
            WHERE status='COMPLETED') AS "completedDeliveries"
      `);
      expect(fixtureEvidence.rows[0]).toMatchObject({
        directOrders: 1,
        completedDeliveries: 1,
      });
      expect(fixtureEvidence.rows[0]!.ordinaryRequests).toBeGreaterThan(0);
      expect(fixtureEvidence.rows[0]!.paidInvoices).toBeGreaterThan(0);

      const accessibleBefore = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM axora_request_access_rows($1,$2,now())
      `, [platformCam.userId, platformCam.assignmentId]);
      expect(accessibleBefore.rows[0]!.count).toBeGreaterThan(0);
      await expect(requestProjection(db, platformCam)).rejects.toMatchObject({
        code: "42501",
        message: "Received quantity is unavailable",
      });
      await expect(dashboardProjection(db, platformCam)).rejects.toMatchObject({
        code: "42501",
        message: "Received quantity is unavailable",
      });

      await db.exec(await readFile(migrationUrl, "utf8"));

      const platformRequests = await requestProjection(db, platformCam);
      expect(platformRequests.rows.some(
        (row) => row.requestId === direct.requestId,
      )).toBe(true);
      await expect(dashboardProjection(db, platformCam)).resolves.toMatchObject({
        rows: [{ attention: expect.any(Number) }],
      });

      expect((await db.query(`
        SELECT request_id
        FROM axora_operation_request_access_rows(
          $1,$2,'finance.invoice.view',now()
        )
      `, [platformCam.userId, platformCam.assignmentId])).rows).toEqual([]);

      await db.exec(await readFile(invoiceMigrationUrl, "utf8"));

      const camInvoiceRequests = await db.query<{ requestId: string }>(`
        SELECT request_id::text AS "requestId"
        FROM axora_operation_request_access_rows(
          $1,$2,'finance.invoice.view',now()
        )
      `, [platformCam.userId, platformCam.assignmentId]);
      expect(camInvoiceRequests.rows.some(
        (row) => row.requestId === direct.requestId,
      )).toBe(true);
      expect((await db.query(`
        SELECT request_id
        FROM axora_operation_request_access_rows(
          $1,$2,'finance.invoice.view',now()
        )
      `, [deniedInvoiceCam.userId, deniedInvoiceCam.assignmentId])).rows)
        .toEqual([]);
      expect((await db.query(`
        SELECT request_id
        FROM axora_operation_request_access_rows(
          $1,$2,'finance.invoice.view',now()
        )
      `, [revokedCam.userId, revokedCam.assignmentId])).rows).toEqual([]);

      const companySnapshot = await db.query<{
        snapshot: unknown;
        scopeValid: boolean;
        resourceActive: boolean;
        targetReady: boolean;
      }>(`
        SELECT axora_live_authorization_snapshot($1,$2,now()) AS snapshot,
          axora_role_scope_contract_is_valid(
            account.account_kind,account.is_owner,role.role_key,
            assignment.scope_type,assignment.company_id,assignment.branch_id,
            assignment.department_id,assignment.supplier_id
          ) AS "scopeValid",
          axora_role_scope_resource_is_active(
            assignment.scope_type,assignment.company_id,assignment.branch_id,
            assignment.department_id,assignment.supplier_id
          ) AS "resourceActive",
          axora_role_assignment_target_is_ready(
            assignment.user_id,assignment.role_id,assignment.scope_type,
            assignment.company_id,assignment.branch_id,
            assignment.department_id,assignment.supplier_id
          ) AS "targetReady"
        FROM role_assignments assignment
        JOIN users account ON account.id=assignment.user_id
        JOIN roles role ON role.id=assignment.role_id
        WHERE assignment.id=$2 AND assignment.user_id=$1
      `, [unsupportedCompanyCam.userId, unsupportedCompanyCam.assignmentId]);
      expect(companySnapshot.rows[0]).toMatchObject({
        scopeValid: false,
        resourceActive: true,
        targetReady: false,
      });
      expect(companySnapshot.rows[0]!.snapshot).toBeNull();
      expect((await requestProjection(db, unsupportedCompanyCam)).rows)
        .toEqual([]);
      await expect(asActor(db, unsupportedCompanyCam, () => db.query(`
        SELECT axora_received_quantity($1)
      `, ["60000000-0000-4000-8000-000000000001"]))).rejects.toMatchObject({
        code: "42501",
      });

      expect((await requestProjection(db, deniedCam)).rows).toEqual([]);
      expect((await dashboardProjection(db, deniedCam)).rows).toEqual([
        { attention: 0 },
      ]);
      await expect(asActor(db, deniedCam, () => db.query(`
        SELECT axora_received_quantity($1)
      `, [direct.lineId]))).rejects.toMatchObject({ code: "42501" });

      expect((await requestProjection(db, revokedCam)).rows).toEqual([]);
      expect((await dashboardProjection(db, revokedCam)).rows).toEqual([
        { attention: 0 },
      ]);
      await expect(asActor(db, revokedCam, () => db.query(`
        SELECT axora_received_quantity($1)
      `, [direct.lineId]))).rejects.toMatchObject({ code: "42501" });

      const security = await db.query<{
        securityDefiner: boolean;
        safeSearchPath: boolean;
        publicExecute: boolean;
        appExecute: boolean;
        assignmentBound: boolean;
        permissionBound: boolean;
      }>(`
        SELECT procedure.prosecdef AS "securityDefiner",
          procedure.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']
            AS "safeSearchPath",
          has_function_privilege(
            'public','axora_received_quantity(uuid)','EXECUTE'
          ) AS "publicExecute",
          has_function_privilege(
            'axora_app','axora_received_quantity(uuid)','EXECUTE'
          ) AS "appExecute",
          position('axora_context_role_assignment_id' IN procedure.prosrc)>0
            AS "assignmentBound",
          position('axora_request_permission_is_effective' IN procedure.prosrc)>0
            AS "permissionBound"
        FROM pg_proc procedure
        WHERE procedure.oid='axora_received_quantity(uuid)'::regprocedure
      `);
      expect(security.rows[0]).toEqual({
        securityDefiner: true,
        safeSearchPath: true,
        publicExecute: false,
        appExecute: true,
        assignmentBound: true,
        permissionBound: true,
      });
    } finally {
      await db.close();
    }
  }, 60_000);

  it("returns a clean zero-row state for a valid platform CAM", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await createOwner(db);
      await createCompany(db, "EMPTY-A");
      await createCompany(db, "EMPTY-B");
      const platformCam = await createCam(db, {
        label: "empty-platform",
        scopeType: "PLATFORM",
      });

      expect((await requestProjection(db, platformCam)).rows).toEqual([]);
      expect((await dashboardProjection(db, platformCam)).rows).toEqual([
        { attention: 0 },
      ]);
    } finally {
      await db.close();
    }
  }, 45_000);

  it("keeps CAM internal cost and margin private despite historical grants", async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(db);
      await applyDemoSeed(db);
      await createOwner(db);
      const direct = await createDirectOrder(db);
      const cam = await createCam(db, {
        label: "commercial-ceiling",
        scopeType: "PLATFORM",
      });
      await db.query(`
        INSERT INTO company_assignments(
          company_id,manager_user_id,assignment_type,status,coverage_starts_at,
          assigned_by,assigned_at,assignment_reason,assignment_source
        ) VALUES ($1,$2,'PRIMARY','ACTIVE',now(),$3,now(),
          'Explicit CAM commercial-ceiling fixture ownership','OWNER_ASSIGNED')
      `, [direct.companyId,cam.userId,owner.userId]);
      const forbidden = [
        "commercial.cost.view",
        "commercial.markup.view",
        "commercial.platform_margin.view",
        "commercial.pricing.manage",
      ];

      await db.query(`
        INSERT INTO user_permission_overrides(
          user_id,permission_id,effect,scope_type,starts_at,active,
          reason,changed_by
        )
        SELECT $1,permission.id,'GRANT','PLATFORM',now(),true,
          'Historical broad CAM grant',$2
        FROM permissions permission
        WHERE permission.permission_code=ANY($3::text[])
      `, [cam.userId, owner.userId, forbidden]);

      const decisions = await db.query<{
        permission: string;
        baseAllowed: boolean;
        effectiveAllowed: boolean;
      }>(`
        WITH snapshot AS (
          SELECT axora_live_authorization_snapshot($1,$2,now()) AS value
        )
        SELECT permission_code AS permission,
          axora_snapshot_has_permission_base(
            snapshot.value,permission_code,'PLATFORM',NULL,NULL,NULL,NULL
          ) AS "baseAllowed",
          axora_snapshot_has_permission(
            snapshot.value,permission_code,'PLATFORM',NULL,NULL,NULL,NULL
          ) AS "effectiveAllowed"
        FROM snapshot,unnest($3::text[]) permission_code
        ORDER BY permission_code
      `, [cam.userId, cam.assignmentId, forbidden]);
      expect(decisions.rows).toHaveLength(forbidden.length);
      expect(decisions.rows.every((row) => (
        row.baseAllowed === false && row.effectiveAllowed === false
      ))).toBe(true);

      const requestAccess = await db.query<{ canViewCommercial: boolean }>(`
        SELECT can_view_commercial AS "canViewCommercial"
        FROM axora_request_access_rows($1,$2,now())
        WHERE request_id=$3
      `, [cam.userId, cam.assignmentId, direct.requestId]);
      expect(requestAccess.rows).toEqual([{ canViewCommercial: false }]);

      const ownerCost = await db.query<{ allowed: boolean }>(`
        WITH snapshot AS (
          SELECT axora_live_authorization_snapshot($1,$2,now()) AS value
        )
        SELECT axora_snapshot_has_permission_base(
          snapshot.value,'commercial.cost.view','PLATFORM',NULL,NULL,NULL,NULL
        ) AS allowed
        FROM snapshot
      `, [owner.userId, owner.assignmentId]);
      expect(ownerCost.rows).toEqual([{ allowed: true }]);

      await expect(db.query(`
        SELECT axora_replace_user_permission_set(
          $1,$2,$3,$4,
          ARRAY['request.view','commercial.cost.view']::text[],
          'Attempt forbidden CAM permission replacement',now()
        )
      `, [owner.userId, owner.assignmentId, cam.userId, cam.assignmentId]))
        .rejects.toMatchObject({
          message: "A selected permission exceeds the target role ceiling",
        });

      await expect(db.query(`
        SELECT * FROM axora_set_user_permission_override(
          $1,$2,$3,$4,'commercial.platform_margin.view','GRANT',
          'PLATFORM',NULL,NULL,NULL,NULL,now(),NULL,
          'Attempt forbidden CAM permission grant'
        )
      `, [owner.userId, owner.assignmentId, cam.userId, cam.assignmentId]))
        .rejects.toMatchObject({
          message: "The selected permission exceeds the target role ceiling",
        });

      const retainedAuditRows = await db.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM user_permission_overrides override_row
        JOIN permissions permission ON permission.id=override_row.permission_id
        WHERE override_row.user_id=$1 AND override_row.active
          AND override_row.effect='GRANT'
          AND permission.permission_code=ANY($2::text[])
      `, [cam.userId, forbidden]);
      expect(retainedAuditRows.rows).toEqual([{ count: forbidden.length }]);
    } finally {
      await db.close();
    }
  }, 60_000);
});

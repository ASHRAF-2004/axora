import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { applyMigrations } from "./helpers/pglite";

type Actor = { userId: string; assignmentId: string };
type Cart = { id: string; version: number; items: Array<{ unitPrice: string; quantity: number }> };
type DirectResult = {
  status: string;
  commandId: string;
  cartId: string;
  consumedCartVersion?: number;
  requestId?: string;
  orderReference?: string;
  invoiceId?: string;
  paymentId?: string;
  deliveryJobId?: string;
  amount?: string;
  currency?: string;
  requiredAmount?: string;
  availableAmount?: string;
  currentCartVersion?: number;
  cart?: Cart;
  created: boolean;
};

const owner: Actor = {
  userId: "75000000-0000-4000-8000-000000000001",
  assignmentId: "75000000-0000-4000-8000-000000000002",
};

describe.sequential("Company Administrator atomic direct purchase migration", () => {
  let db: PGlite;
  let fixtureSequence = 0;

  async function asApp<T>(operation: () => Promise<T>) {
    await db.exec("SET ROLE axora_app");
    try {
      return await operation();
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  async function createActor(input: {
    role: "COMPANY_ADMIN" | "BRANCH_ADMIN" | "REQUESTER" | "DELIVERY_GUY";
    accountKind: "COMPANY" | "DELIVERY";
    scopeType: "COMPANY" | "BRANCH" | "DELIVERY";
    companyId?: string;
    branchId?: string;
    activeAssignment?: boolean;
    label: string;
  }): Promise<Actor> {
    const userId = randomUUID();
    const assignmentId = randomUUID();
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,$2,$3,'not-a-real-hash',role.id,$4,$5,false,
        now(),now(),$6,'ACTIVE',true,1
      FROM roles role WHERE role.role_key=$7
    `, [
      userId,`${input.label}-${userId}@example.test`,input.label,
      input.companyId ?? null,input.branchId ?? null,input.accountKind,input.role,
    ]);
    await db.query(`
      INSERT INTO user_profiles(
        user_id,display_name,preferred_locale,timezone,profile_completed_at
      ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
    `, [userId,input.label]);
    if (input.companyId) {
      await db.query(`
        INSERT INTO company_memberships(
          user_id,company_id,status,is_primary,joined_at,created_by
        ) VALUES ($1,$2,'ACTIVE',true,now(),$3)
      `, [userId,input.companyId,owner.userId]);
    }
    if (input.companyId && input.branchId) {
      await db.query(`
        INSERT INTO branch_assignments(
          user_id,company_id,branch_id,status,is_primary,created_by
        ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
      `, [userId,input.companyId,input.branchId,owner.userId]);
    }
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,branch_id,active,
        revoked_at,assigned_by,assigned_at
      ) SELECT $1,$2,role.id,$3,$4,$5,$6,
        CASE WHEN $6 THEN NULL ELSE now() END,$7,now()
      FROM roles role WHERE role.role_key=$8
    `, [
      assignmentId,userId,input.scopeType,input.companyId ?? null,
      input.branchId ?? null,input.activeAssignment !== false,
      owner.userId,input.role,
    ]);
    if (input.role === "DELIVERY_GUY") {
      await db.query(`
        INSERT INTO delivery_agent_profiles(user_id,agent_code,active)
        VALUES ($1,$2,true)
      `, [userId,`DP-${userId.slice(0, 8)}`]);
    }
    return { userId,assignmentId };
  }

  async function createFixture(input: {
    budget: string;
    wallet: string;
    price: string;
    location?: boolean;
    quantity?: number;
  }) {
    fixtureSequence += 1;
    const label = `direct-${fixtureSequence}`;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const productId = randomUUID();
    await db.query(`
      INSERT INTO companies(
        id,company_code,name,active,contractual_ceiling,tax_rate,
        estimated_delivery_fee,created_by
      ) VALUES ($1,$2,$3,true,50000,0,0,$4)
    `, [companyId,`DP-${fixtureSequence}`,`Direct purchase ${fixtureSequence}`,owner.userId]);
    await db.query(`
      INSERT INTO branches(
        id,branch_code_id,company_id,name,branch_code,delivery_address,
        city,timezone,monthly_budget,active
      ) VALUES ($1,$2,$3,$4,$5,$6,'Kuala Lumpur','Asia/Kuala_Lumpur',$7,true)
    `, [
      branchId,`DP-B-${fixtureSequence}`,companyId,`Direct branch ${fixtureSequence}`,
      `DP${fixtureSequence}`,`Controlled destination ${fixtureSequence}`,input.budget,
    ]);
    const admin = await createActor({
      role: "COMPANY_ADMIN",accountKind: "COMPANY",scopeType: "COMPANY",
      companyId,label: `${label}-admin`,
    });
    if (input.location !== false) {
      await asApp(() => db.query(`
        SELECT axora_save_branch_delivery_location(
          $1,$2,$3,$4,3.139000,101.686900,'Controlled instructions',
          'Configure controlled direct-purchase location',$5,now()
        )
      `, [
        admin.userId,admin.assignmentId,branchId,
        `Canonical destination ${fixtureSequence}`,randomUUID(),
      ]));
    }
    await db.query(`
      INSERT INTO products(
        id,product_code,name,category,subcategory,unit_of_measure,
        default_buy_price,default_sell_price,minimum_order_quantity,
        delivery_sla_days,active,needs_review
      ) VALUES ($1,$2,$3,'Office Basics','Writing','unit',
        round($4::numeric/1.10,2),$4,1,1,true,false)
    `, [productId,`DP-P-${fixtureSequence}`,`Direct product ${fixtureSequence}`,input.price]);
    if (input.wallet !== "0.00") {
      await db.query(`
        INSERT INTO company_wallet_ledger_entries(
          company_id,entry_type,amount_delta,currency,effective_date,
          business_reference,reason,correlation_id,idempotency_key,
          actor_user_id,actor_role_assignment_id,posted_at
        ) VALUES ($1,'TOP_UP',$2,'MYR',CURRENT_DATE,$3,
          'Controlled direct-purchase Wallet fixture',$4,$5,$6,$7,now())
      `, [
        companyId,input.wallet,`DP-TOPUP-${fixtureSequence}`,randomUUID(),
        `direct-fixture-topup-${randomUUID()}`,owner.userId,owner.assignmentId,
      ]);
    }
    const publicReference = (await db.query<{ ref: string }>(`
      SELECT public_reference AS ref FROM products WHERE id=$1
    `, [productId])).rows[0]!.ref;
    const read = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [admin.userId,admin.assignmentId,branchId,randomUUID()]));
    const added = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,$5,'',$6,$7,now()
      ) AS cart
    `, [
      admin.userId,admin.assignmentId,branchId,publicReference,
      input.quantity ?? 1,read.rows[0]!.cart.version,randomUUID(),
    ]));
    return {
      label,companyId,branchId,productId,publicReference,admin,
      cart: added.rows[0]!.cart,
    };
  }

  async function direct(
    actor: Actor,
    cart: Pick<Cart, "id" | "version">,
    commandId = randomUUID(),
  ) {
    const result = await asApp(() => db.query<{ result: DirectResult }>(`
      SELECT axora_company_admin_direct_purchase(
        $1,$2,$3,$4,$5,now()
      ) AS result
    `, [actor.userId,actor.assignmentId,cart.id,cart.version,commandId]));
    return result.rows[0]!.result;
  }

  async function balances(companyId: string, branchId: string) {
    const result = await db.query<{
      wallet: string;
      allocated: string;
      reserved: string;
      spent: string;
      available: string;
    }>(`
      SELECT wallet.available_balance::text AS wallet,
        budget.allocated::text AS allocated,budget.reserved::text AS reserved,
        budget.spent::text AS spent,budget.available::text AS available
      FROM v_company_wallet_balances wallet
      JOIN budget_accounts account ON account.company_id=wallet.company_id
        AND account.branch_id=$2 AND account.level_type='BRANCH' AND account.active
      JOIN budget_periods period ON period.budget_account_id=account.id
        AND period.status='ACTIVE'
      JOIN v_budget_period_balances budget ON budget.budget_period_id=period.id
      WHERE wallet.company_id=$1
    `, [companyId,branchId]);
    return result.rows[0]!;
  }

  async function artifactCounts(companyId: string) {
    const result = await db.query<{
      orders: number;
      payments: number;
      invoices: number;
      jobs: number;
      debits: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM requests request
          WHERE request.company_id=$1 AND request.purchase_mode='COMPANY_ADMIN_DIRECT') AS orders,
        (SELECT count(*)::int FROM payments payment JOIN invoices invoice
          ON invoice.id=payment.invoice_id WHERE invoice.company_id=$1) AS payments,
        (SELECT count(*)::int FROM invoices invoice
          WHERE invoice.company_id=$1 AND invoice.direction='CUSTOMER') AS invoices,
        (SELECT count(*)::int FROM delivery_jobs job WHERE job.company_id=$1) AS jobs,
        (SELECT count(*)::int FROM company_wallet_ledger_entries entry
          WHERE entry.company_id=$1 AND entry.entry_type='PAYMENT') AS debits
    `, [companyId]);
    return result.rows[0]!;
  }

  async function durableSideEffects(requestId: string, commandId: string) {
    const result = await db.query<{
      documentJobs: number;
      generatedDocuments: number;
      invoiceEmails: number;
      deliveryLines: number;
      deliveryQuantity: number;
      workflowEvents: number;
      notifications: number;
      notificationRecipients: number;
      accountabilityEvents: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM document_generation_jobs job
          WHERE job.request_id=$1 AND job.document_type='FINAL_INVOICE') AS "documentJobs",
        (SELECT count(*)::int FROM generated_documents document
          WHERE document.request_id=$1 AND document.document_type='FINAL_INVOICE') AS "generatedDocuments",
        (SELECT count(*)::int FROM transactional_email_outbox outbox
          JOIN invoices invoice ON invoice.id=outbox.invoice_id
          WHERE invoice.request_id=$1 AND outbox.message_kind='INVOICE_FINALIZED') AS "invoiceEmails",
        (SELECT count(*)::int FROM delivery_job_lines line
          JOIN delivery_jobs job ON job.id=line.delivery_job_id
          WHERE job.request_id=$1) AS "deliveryLines",
        (SELECT COALESCE(sum(line.quantity_to_deliver),0)::int
          FROM delivery_job_lines line
          JOIN delivery_jobs job ON job.id=line.delivery_job_id
          WHERE job.request_id=$1) AS "deliveryQuantity",
        (SELECT count(*)::int FROM workflow_events event
          WHERE event.request_id=$1
            AND event.idempotency_key='direct-purchase-payment:'||$2) AS "workflowEvents",
        (SELECT count(*)::int FROM in_app_notifications notification
          JOIN workflow_events event ON event.id=notification.workflow_event_id
          WHERE event.request_id=$1
            AND event.idempotency_key='direct-purchase-payment:'||$2) AS notifications,
        (SELECT count(DISTINCT notification.recipient_user_id)::int
          FROM in_app_notifications notification
          JOIN workflow_events event ON event.id=notification.workflow_event_id
          WHERE event.request_id=$1
            AND event.idempotency_key='direct-purchase-payment:'||$2) AS "notificationRecipients",
        (SELECT count(*)::int FROM payment_accountability_events event
          WHERE event.request_id=$1) AS "accountabilityEvents"
    `, [requestId,commandId]);
    return result.rows[0]!;
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,'direct-owner@example.test','Direct fixture owner',
        'not-a-real-hash',role.id,true,now(),now(),'PLATFORM','ACTIVE',true,1
      FROM roles role WHERE role.role_key='PLATFORM_OWNER'
    `, [owner.userId]);
    await db.query(`
      INSERT INTO user_profiles(
        user_id,display_name,preferred_locale,timezone,profile_completed_at
      ) VALUES ($1,'Direct fixture owner','en','Asia/Kuala_Lumpur',now())
    `, [owner.userId]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,active,assigned_by,assigned_at
      ) SELECT $1,$2,role.id,'PLATFORM',true,$2,now()
      FROM roles role WHERE role.role_key='PLATFORM_OWNER'
    `, [owner.assignmentId,owner.userId]);
  }, 45_000);

  afterAll(async () => { await db.close(); });

  it("upgrades 114 additively with a narrowly assigned capability and private replay evidence", async () => {
    const upgrade = new PGlite();
    try {
      await upgrade.exec("CREATE ROLE axora_app NOLOGIN");
      await applyMigrations(upgrade, {
        through: "114_company_admin_shopping_cart_contract.sql",
      });
      expect((await upgrade.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM permissions
        WHERE permission_code='procurement.direct_purchase'
      `)).rows[0]!.count).toBe(0);
      await upgrade.exec(await readFile(
        new URL("../database/migrations/115_company_admin_direct_purchase.sql", import.meta.url),
        "utf8",
      ));
      const security = await upgrade.query<{
        roles: string[];
        rls: boolean;
        forced: boolean;
        tableAccess: boolean;
        publicCommand: boolean;
        internalCommand: boolean;
        platformAllowed: boolean;
      }>(`
        SELECT ARRAY(SELECT role.role_key FROM role_permissions role_permission
          JOIN roles role ON role.id=role_permission.role_id
          JOIN permissions permission ON permission.id=role_permission.permission_id
          WHERE permission.permission_code='procurement.direct_purchase'
          ORDER BY role.role_key) AS roles,
          relation.relrowsecurity AS rls,relation.relforcerowsecurity AS forced,
          has_table_privilege('axora_app','company_admin_direct_purchase_commands','SELECT') AS "tableAccess",
          has_function_privilege('axora_app',
            'axora_company_admin_direct_purchase(uuid,uuid,uuid,integer,uuid,timestamptz)',
            'EXECUTE') AS "publicCommand",
          has_function_privilege('axora_app',
            'axora_company_admin_direct_purchase_internal(uuid,uuid,uuid,integer,uuid,timestamptz,text)',
            'EXECUTE') AS "internalCommand",
          axora_permission_allowed_for_account_kind(
            'PLATFORM','procurement.direct_purchase') AS "platformAllowed"
        FROM pg_class relation
        WHERE relation.oid='company_admin_direct_purchase_commands'::regclass
      `);
      expect(security.rows[0]).toEqual({
        roles: ["COMPANY_ADMIN"],rls: true,forced: true,tableAccess: false,
        publicCommand: true,internalCommand: false,platformAllowed: false,
      });
      const copies = await upgrade.query<{
        en: { title: string; body: string };
        ar: { title: string; body: string };
        ms: { title: string; body: string };
      }>(`
        SELECT axora_finance_event_copy(
          'direct_purchase.completed','en','AX-ORDER-1') AS en,
          axora_finance_event_copy(
            'direct_purchase.completed','ar','AX-ORDER-1') AS ar,
          axora_finance_event_copy(
            'direct_purchase.completed','ms','AX-ORDER-1') AS ms
      `);
      expect(copies.rows[0]).toEqual({
        en: {
          title: "Order placed",
          body: "Order AX-ORDER-1 was paid from the Company Wallet.",
        },
        ar: {
          title: "تم تقديم الطلب",
          body: "تم دفع قيمة الطلب AX-ORDER-1 من محفظة الشركة.",
        },
        ms: {
          title: "Pesanan dibuat",
          body: "Pesanan AX-ORDER-1 telah dibayar daripada Dompet Syarikat.",
        },
      });
    } finally {
      await upgrade.close();
    }
  }, 45_000);

  it("commits one exact order, budget spend, Wallet debit, payment, invoice, job and Cart consumption", async () => {
    const fixture = await createFixture({ budget: "100.00",wallet: "100.00",price: "100.00" });
    const workspace = await asApp(() => db.query<{ payload: Record<string, unknown> }>(`
      SELECT axora_company_admin_direct_purchase_workspace(
        $1,$2,$3,$4,now()
      ) AS payload
    `, [
      fixture.admin.userId,fixture.admin.assignmentId,
      fixture.cart.id,fixture.cart.version,
    ]));
    expect(workspace.rows[0]!.payload).toMatchObject({
      cartId: fixture.cart.id,cartVersion: fixture.cart.version,
      orderTotal: "100.00",budgetAvailable: "100.00",walletAvailable: "100.00",
      budgetReady: true,locationReady: true,priceChanged: false,
    });
    expect(JSON.stringify(workspace.rows[0]!.payload)).not.toMatch(
      /buying|baseCost|margin|supplier|latitude|longitude/i,
    );

    const commandId = randomUUID();
    const placed = await direct(fixture.admin,fixture.cart,commandId);
    expect(placed).toMatchObject({
      status: "SUCCESS",commandId,cartId: fixture.cart.id,
      consumedCartVersion: fixture.cart.version + 1,amount: "100.00",
      currency: "MYR",created: true,
    });
    expect(placed.requestId).toBeTruthy();
    expect(placed.invoiceId).toBeTruthy();
    expect(placed.paymentId).toBeTruthy();
    expect(placed.deliveryJobId).toBeTruthy();

    const evidence = await db.query<{
      purchaseMode: string;
      approvalState: string;
      orderTotal: string;
      decisionAmount: string;
      decisionAction: string;
      selfApproval: boolean;
      walletDebit: string;
      paymentAmount: string;
      invoiceAmount: string;
      jobStatus: string;
      destination: string;
      latitude: string;
      longitude: string;
      cartStatus: string;
      cartVersion: number;
      legacyApprovals: number;
    }>(`
      SELECT request.purchase_mode AS "purchaseMode",
        request.approval_state AS "approvalState",
        axora_request_total_internal(request.id)::text AS "orderTotal",
        decision.amount::text AS "decisionAmount",
        decision.action AS "decisionAction",decision.self_approval AS "selfApproval",
        (-wallet.amount_delta)::text AS "walletDebit",
        payment.amount::text AS "paymentAmount",invoice.amount::text AS "invoiceAmount",
        job.status AS "jobStatus",job.delivery_address_snapshot AS destination,
        job.destination_latitude::text AS latitude,
        job.destination_longitude::text AS longitude,
        cart.status AS "cartStatus",cart.cart_version::int AS "cartVersion",
        (SELECT count(*)::int FROM approvals approval
          WHERE approval.request_id=request.id) AS "legacyApprovals"
      FROM requests request
      JOIN request_approval_decisions decision ON decision.request_id=request.id
        AND decision.action='DIRECT_PURCHASE'
      JOIN company_wallet_ledger_entries wallet ON wallet.request_id=request.id
        AND wallet.entry_type='PAYMENT'
      JOIN invoices invoice ON invoice.request_id=request.id
        AND invoice.direction='CUSTOMER'
      JOIN payments payment ON payment.invoice_id=invoice.id
        AND payment.payment_status='PAID'
      JOIN delivery_jobs job ON job.request_id=request.id
      JOIN procurement_carts cart ON cart.submitted_request_id=request.id
      WHERE request.id=$1
    `, [placed.requestId]);
    expect(evidence.rows[0]).toEqual({
      purchaseMode: "COMPANY_ADMIN_DIRECT",approvalState: "AWAITING_FULFILMENT",
      orderTotal: "100.00",decisionAmount: "100.00",decisionAction: "DIRECT_PURCHASE",
      selfApproval: false,walletDebit: "100.00",paymentAmount: "100.00",
      invoiceAmount: "100.00",jobStatus: "AWAITING_ASSIGNMENT",
      destination: `Canonical destination ${fixtureSequence}`,
      latitude: "3.139000",longitude: "101.686900",cartStatus: "SUBMITTED",
      cartVersion: fixture.cart.version + 1,legacyApprovals: 0,
    });
    expect(await balances(fixture.companyId,fixture.branchId)).toEqual({
      wallet: "0.00",allocated: "100.00",reserved: "0.00",
      spent: "100.00",available: "0.00",
    });
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 1,payments: 1,invoices: 1,jobs: 1,debits: 1,
    });

    const replay = await direct(fixture.admin,fixture.cart,commandId);
    expect(replay).toMatchObject({
      status: "ALREADY_PROCESSED",requestId: placed.requestId,
      invoiceId: placed.invoiceId,paymentId: placed.paymentId,
      deliveryJobId: placed.deliveryJobId,created: false,
    });
    const foreignReconciliation = await asApp(() => db.query<{
      result: { status: string; commandId: string };
    }>(`
      SELECT axora_company_admin_direct_purchase_result($1,$2,$3,now()) AS result
    `, [owner.userId,owner.assignmentId,commandId]));
    expect(foreignReconciliation.rows[0]!.result).toEqual({
      status: "NOT_FOUND",commandId,
    });
    await expect(direct(
      fixture.admin,{ id: fixture.cart.id,version: fixture.cart.version + 1 },commandId,
    )).rejects.toMatchObject({ code: "42501" });
    const raced = await direct(fixture.admin,fixture.cart,randomUUID());
    expect(raced).toMatchObject({
      status: "CART_ALREADY_PURCHASED",requestId: placed.requestId,created: false,
    });
    const deletionImpact = await asApp(() => db.query<{
      payload: {
        companyAdminDirectPurchaseCommands: number;
        protectedEvidence: number;
        hardDeleteEligible: boolean;
      };
    }>(`
      SELECT axora_company_deletion_impact_v2($1,$2,$3,now()) AS payload
    `, [owner.userId,owner.assignmentId,fixture.companyId]));
    expect(deletionImpact.rows[0]!.payload).toMatchObject({
      companyAdminDirectPurchaseCommands: 2,
      hardDeleteEligible: false,
    });
    expect(deletionImpact.rows[0]!.payload.protectedEvidence).toBeGreaterThan(0);
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 1,payments: 1,invoices: 1,jobs: 1,debits: 1,
    });
    expect(await durableSideEffects(placed.requestId!,commandId)).toEqual({
      documentJobs: 1,generatedDocuments: 0,invoiceEmails: 0,
      deliveryLines: 1,deliveryQuantity: 1,workflowEvents: 1,
      notifications: 2,notificationRecipients: 2,accountabilityEvents: 4,
    });
    const directNotification = await db.query<{ title: string; body: string }>(`
      SELECT notification.title,notification.body
      FROM in_app_notifications notification
      JOIN workflow_events event ON event.id=notification.workflow_event_id
      WHERE event.request_id=$1 AND event.event_key='direct_purchase.completed'
        AND notification.recipient_user_id=$2
    `, [placed.requestId,fixture.admin.userId]);
    expect(directNotification.rows).toEqual([{
      title: "Order placed",
      body: `Order ${placed.orderReference} was paid from the Company Wallet.`,
    }]);

    const approvalWorkspace = await asApp(() => db.query<{
      payload: { requests: Array<{ id: string }> };
    }>(`
      SELECT axora_request_approval_workspace_v2($1,$2,now()) AS payload
    `, [fixture.admin.userId,fixture.admin.assignmentId]));
    expect(approvalWorkspace.rows[0]!.payload.requests.map((item) => item.id))
      .not.toContain(placed.requestId);

    await asApp(() => db.query(`
      SELECT axora_save_branch_delivery_location(
        $1,$2,$3,'Replacement canonical destination',3.140000,101.687000,
        'Replacement instructions','Change location after order',$4,now()
      )
    `, [fixture.admin.userId,fixture.admin.assignmentId,fixture.branchId,randomUUID()]));
    const immutableDestination = await db.query<{
      destination: string;
      latitude: string;
      longitude: string;
    }>(`
      SELECT delivery_address_snapshot AS destination,
        destination_latitude::text AS latitude,
        destination_longitude::text AS longitude
      FROM delivery_jobs WHERE id=$1
    `, [placed.deliveryJobId]);
    expect(immutableDestination.rows[0]).toEqual({
      destination: `Canonical destination ${fixtureSequence}`,
      latitude: "3.139000",longitude: "101.686900",
    });
    const freshCart = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [fixture.admin.userId,fixture.admin.assignmentId,fixture.branchId,randomUUID()]));
    expect(freshCart.rows[0]!.cart).toMatchObject({ version: 1,items: [] });
  }, 30_000);

  it.each([
    ["INSUFFICIENT_BUDGET","99.99","500.00"],
    ["INSUFFICIENT_WALLET","500.00","99.99"],
  ] as const)("returns %s without any partial financial state", async (status,budget,wallet) => {
    const fixture = await createFixture({ budget,wallet,price: "100.00" });
    const before = await balances(fixture.companyId,fixture.branchId);
    const result = await direct(fixture.admin,fixture.cart);
    expect(result).toMatchObject({
      status,requiredAmount: "100.00",availableAmount: "99.99",
      currency: "MYR",created: false,
    });
    expect(await balances(fixture.companyId,fixture.branchId)).toEqual(before);
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });
    const cart = await db.query<{ status: string; version: number }>(`
      SELECT status,cart_version::int AS version FROM procurement_carts WHERE id=$1
    `, [fixture.cart.id]);
    expect(cart.rows[0]).toEqual({ status: "ACTIVE",version: fixture.cart.version });
  }, 30_000);

  it("reconciles a committed result after the same actor is safely reauthorized", async () => {
    const fixture = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    const commandId = randomUUID();
    const placed = await direct(fixture.admin,fixture.cart,commandId);
    expect(placed.status).toBe("SUCCESS");
    await createActor({
      role: "COMPANY_ADMIN",accountKind: "COMPANY",scopeType: "COMPANY",
      companyId: fixture.companyId,label: "direct-reauthorization-guard-admin",
    });
    await db.query(`
      UPDATE role_assignments SET active=false,revoked_at=now()
      WHERE id=$1
    `, [fixture.admin.assignmentId]);
    const replacementAssignmentId = randomUUID();
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
      ) SELECT $1,$2,role.id,'COMPANY',$3,true,$4,now()
      FROM roles role WHERE role.role_key='COMPANY_ADMIN'
    `, [
      replacementAssignmentId,fixture.admin.userId,fixture.companyId,owner.userId,
    ]);
    const replacement = {
      userId: fixture.admin.userId,
      assignmentId: replacementAssignmentId,
    };
    const reconciled = await asApp(() => db.query<{
      result: DirectResult;
    }>(`
      SELECT axora_company_admin_direct_purchase_result($1,$2,$3,now()) AS result
    `, [replacement.userId,replacement.assignmentId,commandId]));
    expect(reconciled.rows[0]!.result).toMatchObject({
      status: "ALREADY_PROCESSED",requestId: placed.requestId,
      invoiceId: placed.invoiceId,paymentId: placed.paymentId,
      deliveryJobId: placed.deliveryJobId,created: false,
    });
    await expect(direct(replacement,fixture.cart,commandId))
      .rejects.toMatchObject({ code: "42501" });
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 1,payments: 1,invoices: 1,jobs: 1,debits: 1,
    });
  }, 30_000);

  it("requires price review and a new confirmation before charging a changed amount", async () => {
    const fixture = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    await db.query(`
      UPDATE products SET default_buy_price=round(120::numeric/1.10,2),
        default_sell_price=120 WHERE id=$1
    `, [fixture.productId]);
    const changed = await direct(fixture.admin,fixture.cart);
    expect(changed).toMatchObject({
      status: "PRICE_CHANGED",currentCartVersion: fixture.cart.version + 1,
      created: false,
    });
    expect(changed.cart?.items[0]).toMatchObject({ unitPrice: "120.00",quantity: 1 });
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });
    expect(await balances(fixture.companyId,fixture.branchId)).toEqual({
      wallet: "500.00",allocated: "500.00",reserved: "0.00",
      spent: "0.00",available: "500.00",
    });
    const confirmed = await direct(fixture.admin,{
      id: fixture.cart.id,version: changed.currentCartVersion!,
    });
    expect(confirmed).toMatchObject({ status: "SUCCESS",amount: "120.00" });
  }, 30_000);

  it("rejects a changed Cart version before any financial mutation", async () => {
    const fixture = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    const changed = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'SET',$4,2,'',$5,$6,now()
      ) AS cart
    `, [
      fixture.admin.userId,fixture.admin.assignmentId,fixture.branchId,
      fixture.publicReference,fixture.cart.version,randomUUID(),
    ]));
    const stale = await direct(fixture.admin,fixture.cart);
    expect(stale).toMatchObject({
      status: "STALE_CART",currentCartVersion: changed.rows[0]!.cart.version,
      created: false,
    });
    expect(stale.cart?.items[0]).toMatchObject({ quantity: 2 });
    expect(await balances(fixture.companyId,fixture.branchId)).toEqual({
      wallet: "500.00",allocated: "500.00",reserved: "0.00",
      spent: "0.00",available: "500.00",
    });
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });
  }, 30_000);

  it("keeps missing-location and inactive-product failures local with the Cart intact", async () => {
    const noLocation = await createFixture({
      budget: "500.00",wallet: "500.00",price: "100.00",location: false,
    });
    expect(await direct(noLocation.admin,noLocation.cart)).toMatchObject({
      status: "BRANCH_LOCATION_REQUIRED",created: false,
    });
    expect(await artifactCounts(noLocation.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });

    const inactiveProduct = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    await db.query("UPDATE products SET active=false WHERE id=$1", [inactiveProduct.productId]);
    expect(await direct(inactiveProduct.admin,inactiveProduct.cart)).toMatchObject({
      status: "PRODUCT_UNAVAILABLE",created: false,
    });
    expect(await artifactCounts(inactiveProduct.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });
  }, 30_000);

  it("rejects a quantity that no longer satisfies the live supplier rule", async () => {
    const fixture = await createFixture({
      budget: "500.00",wallet: "500.00",price: "100.00",quantity: 1,
    });
    const supplierId = randomUUID();
    await db.query(`
      INSERT INTO suppliers(id,supplier_code,name,active)
      VALUES ($1,$2,$3,true)
    `, [
      supplierId,`DP-S-${fixtureSequence}`,
      `Direct quantity supplier ${fixtureSequence}`,
    ]);
    await db.query(`
      INSERT INTO product_suppliers(
        product_id,supplier_id,preferred,indicative_buy_price,supplier_moq,
        order_increment,pack_size,pack_unit,quantity_rule_reason,active
      ) VALUES ($1,$2,true,90.91,2,1,1,'unit',
        'Controlled quantity rule changed after Cart review',true)
    `, [fixture.productId,supplierId]);

    const opening = await balances(fixture.companyId,fixture.branchId);
    expect(await direct(fixture.admin,fixture.cart)).toMatchObject({
      status: "PRODUCT_UNAVAILABLE",created: false,
    });
    expect(await balances(fixture.companyId,fixture.branchId)).toEqual(opening);
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });
    const cart = await db.query<{ status: string; version: number }>(`
      SELECT status,cart_version::int AS version
      FROM procurement_carts WHERE id=$1
    `, [fixture.cart.id]);
    expect(cart.rows[0]).toEqual({ status: "ACTIVE",version: fixture.cart.version });
  }, 30_000);

  it("denies lower roles, Platform Owner, foreign tenancy, revoked authority, explicit DENY and inactive scopes", async () => {
    const fixture = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    const branchAdmin = await createActor({
      role: "BRANCH_ADMIN",accountKind: "COMPANY",scopeType: "BRANCH",
      companyId: fixture.companyId,branchId: fixture.branchId,label: "direct-branch-admin",
    });
    const requester = await createActor({
      role: "REQUESTER",accountKind: "COMPANY",scopeType: "BRANCH",
      companyId: fixture.companyId,branchId: fixture.branchId,label: "direct-requester",
    });
    const delivery = await createActor({
      role: "DELIVERY_GUY",accountKind: "DELIVERY",scopeType: "DELIVERY",
      label: "direct-delivery-agent",
    });
    for (const actor of [branchAdmin,requester,delivery,owner]) {
      await expect(direct(actor,fixture.cart)).rejects.toMatchObject({ code: "42501" });
    }
    await expect(db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,branch_id,
        active,reason,changed_by
      ) VALUES ($1,(SELECT id FROM permissions
        WHERE permission_code='procurement.direct_purchase'),
        'GRANT','BRANCH',$2,$3,true,'Forbidden direct purchase promotion',$4)
    `, [branchAdmin.userId,fixture.companyId,fixture.branchId,owner.userId]))
      .rejects.toMatchObject({ code: "42501" });

    const foreign = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    await expect(direct(fixture.admin,foreign.cart)).rejects.toMatchObject({ code: "42501" });

    const denied = await createActor({
      role: "COMPANY_ADMIN",accountKind: "COMPANY",scopeType: "COMPANY",
      companyId: fixture.companyId,label: "direct-explicit-deny",
    });
    const read = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [denied.userId,denied.assignmentId,fixture.branchId,randomUUID()]));
    const added = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,1,'',$5,$6,now()
      ) AS cart
    `, [
      denied.userId,denied.assignmentId,fixture.branchId,fixture.publicReference,
      read.rows[0]!.cart.version,randomUUID(),
    ]));
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,active,reason,changed_by
      ) VALUES ($1,(SELECT id FROM permissions
        WHERE permission_code='procurement.direct_purchase'),
        'DENY','COMPANY',$2,true,'Direct purchase explicitly denied',$3)
    `, [denied.userId,fixture.companyId,owner.userId]);
    await expect(direct(denied,added.rows[0]!.cart)).rejects.toMatchObject({ code: "42501" });

    const revoked = await createActor({
      role: "COMPANY_ADMIN",accountKind: "COMPANY",scopeType: "COMPANY",
      companyId: fixture.companyId,label: "direct-revoked-admin",
    });
    const revokedRead = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [revoked.userId,revoked.assignmentId,fixture.branchId,randomUUID()]));
    const revokedCart = await asApp(() => db.query<{ cart: Cart }>(`
      SELECT axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,1,'',$5,$6,now()
      ) AS cart
    `, [
      revoked.userId,revoked.assignmentId,fixture.branchId,fixture.publicReference,
      revokedRead.rows[0]!.cart.version,randomUUID(),
    ]));
    await db.query(`
      UPDATE role_assignments SET active=false,revoked_at=now()
      WHERE id=$1
    `, [revoked.assignmentId]);
    await expect(direct(revoked,revokedCart.rows[0]!.cart)).rejects.toMatchObject({ code: "42501" });

    await db.query(`
      UPDATE branches SET active=false,deactivated_at=now(),
        deactivated_by=$2,deactivation_reason='Controlled inactive branch test'
      WHERE id=$1
    `, [fixture.branchId,owner.userId]);
    await expect(direct(fixture.admin,fixture.cart)).rejects.toMatchObject({ code: "42501" });
    expect(await artifactCounts(fixture.companyId)).toEqual({
      orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
    });

    const inactiveCompany = await createFixture({ budget: "500.00",wallet: "500.00",price: "100.00" });
    await db.query(`
      UPDATE companies SET active=false,portal_access_enabled=false,
        lifecycle_status='INACTIVE',verification_status='INACTIVE'
      WHERE id=$1
    `, [inactiveCompany.companyId]);
    await expect(direct(inactiveCompany.admin,inactiveCompany.cart))
      .rejects.toMatchObject({ code: "42501" });
    await expect(direct(fixture.admin,{ id: randomUUID(),version: 1 }))
      .rejects.toMatchObject({ code: "42501" });
  }, 30_000);

  it("rolls every injected major-boundary failure back inside PostgreSQL", async () => {
    const fixture = await createFixture({ budget: "1000.00",wallet: "1000.00",price: "100.00" });
    const opening = await balances(fixture.companyId,fixture.branchId);
    const failurePoints = [
      "AFTER_DIRECT_ORDER","AFTER_BUDGET_RESERVATION","BEFORE_INVOICE",
      "AFTER_DELIVERY_JOB","AFTER_BUDGET_FINALIZATION","AFTER_WALLET_DEBIT",
      "BEFORE_CART_CONSUMPTION","AFTER_CART_CONSUMPTION",
    ];
    for (const failurePoint of failurePoints) {
      await expect(db.query(`
        SELECT axora_company_admin_direct_purchase_internal(
          $1,$2,$3,$4,$5,now(),$6
        )
      `, [
        fixture.admin.userId,fixture.admin.assignmentId,fixture.cart.id,
        fixture.cart.version,randomUUID(),failurePoint,
      ])).rejects.toThrow(/Injected direct-purchase failure/);
      expect(await balances(fixture.companyId,fixture.branchId)).toEqual(opening);
      expect(await artifactCounts(fixture.companyId)).toEqual({
        orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,
      });
      const cart = await db.query<{ status: string; version: number }>(`
        SELECT status,cart_version::int AS version
        FROM procurement_carts WHERE id=$1
      `, [fixture.cart.id]);
      expect(cart.rows[0]).toEqual({ status: "ACTIVE",version: fixture.cart.version });
    }
    expect(await direct(fixture.admin,fixture.cart)).toMatchObject({
      status: "SUCCESS",amount: "100.00",
    });
  }, 30_000);

  it("snapshots the live commercial offer rather than a stale product convenience price", async () => {
    const fixture = await createFixture({
      budget: "500.00",wallet: "500.00",price: "100.00",
    });
    await db.query(`
      INSERT INTO commercial_pricing_rules(
        rule_key,version,currency,markup_percentage,rounding_scale,
        tax_treatment,delivery_treatment,source,effective_from,reason,created_by
      ) VALUES (
        'STANDARD_MARKUP',2,'MYR',20,2,'EXCLUDED','EXCLUDED',
        'PLATFORM_RULE',now()-interval '1 second',
        'Controlled direct-purchase canonical offer test',$1
      )
    `, [owner.userId]);
    const changed = await direct(fixture.admin,fixture.cart);
    expect(changed).toMatchObject({
      status: "PRICE_CHANGED",currentCartVersion: fixture.cart.version + 1,
    });
    expect(changed.cart?.items[0]).toMatchObject({ unitPrice: "109.09" });
    const purchased = await direct(fixture.admin,{
      id: fixture.cart.id,version: changed.currentCartVersion!,
    });
    expect(purchased).toMatchObject({ status: "SUCCESS",amount: "109.09" });
    const evidence = await db.query<{
      linePrice: string;
      conveniencePrice: string;
      invoiceAmount: string;
    }>(`
      SELECT line.unit_sell_price::text AS "linePrice",
        product.default_sell_price::text AS "conveniencePrice",
        invoice.amount::text AS "invoiceAmount"
      FROM requests request
      JOIN request_lines line ON line.request_id=request.id
      JOIN products product ON product.id=line.product_id
      JOIN invoices invoice ON invoice.request_id=request.id
      WHERE request.id=$1
    `, [purchased.requestId]);
    expect(evidence.rows[0]).toEqual({
      linePrice: "109.09",conveniencePrice: "100.00",invoiceAmount: "109.09",
    });
  }, 30_000);
});

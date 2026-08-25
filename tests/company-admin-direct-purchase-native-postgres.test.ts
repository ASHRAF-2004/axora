import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

type Actor = { userId: string; assignmentId: string };
type Cart = { id: string; version: number };
type Fixture = {
  companyId: string;
  branchId: string;
  admin: Actor;
  cart: Cart;
};
type DirectResult = {
  status: string;
  commandId: string;
  requestId?: string;
  invoiceId?: string;
  paymentId?: string;
  deliveryJobId?: string;
  amount?: string;
  created: boolean;
};

nativeDescribe.sequential("Company Administrator direct-purchase native concurrency", () => {
  let admin: Client;
  let app: Client;
  let appConfig: ClientConfig;
  let owner: Actor;
  let fixtureSequence = 0;

  async function connectedAppClient() {
    const client = new Client(appConfig);
    await client.connect();
    return client;
  }

  async function createFixture(): Promise<Fixture> {
    fixtureSequence += 1;
    const companyId = randomUUID();
    const branchId = randomUUID();
    const adminActor = { userId: randomUUID(),assignmentId: randomUUID() };
    const productId = randomUUID();
    const label = `native-direct-${fixtureSequence}`;
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Create ${label} concurrency fixture`,
      ]);
      await admin.query(`
        INSERT INTO public.companies(
          id,company_code,name,active,contractual_ceiling,tax_rate,
          estimated_delivery_fee,created_by
        ) VALUES ($1,$2,$3,true,50000,0,0,$4)
      `, [companyId,`NDP-${fixtureSequence}`,`Native direct ${fixtureSequence}`,owner.userId]);
      await admin.query(`
        INSERT INTO public.branches(
          id,branch_code_id,company_id,name,branch_code,delivery_address,
          city,timezone,monthly_budget,active
        ) VALUES ($1,$2,$3,$4,$5,$6,'Kuala Lumpur',
          'Asia/Kuala_Lumpur',1000,true)
      `, [
        branchId,`NDP-B-${fixtureSequence}`,companyId,
        `Native direct branch ${fixtureSequence}`,`NDP${fixtureSequence}`,
        `Native controlled destination ${fixtureSequence}`,
      ]);
      await admin.query(`
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,company_id,
          is_owner,account_setup_completed_at,email_verified_at,account_kind,
          account_status,active,auth_version
        ) SELECT $1,$2,$3,'not-a-real-hash',role.id,$4,false,
          now(),now(),'COMPANY','ACTIVE',true,1
        FROM public.roles role WHERE role.role_key='COMPANY_ADMIN'
      `, [
        adminActor.userId,`${label}-${adminActor.userId}@example.test`,
        `Native direct administrator ${fixtureSequence}`,companyId,
      ]);
      await admin.query(`
        INSERT INTO public.user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
      `, [adminActor.userId,`Native direct administrator ${fixtureSequence}`]);
      await admin.query(`
        INSERT INTO public.company_memberships(
          user_id,company_id,status,is_primary,joined_at,created_by
        ) VALUES ($1,$2,'ACTIVE',true,now(),$3)
      `, [adminActor.userId,companyId,owner.userId]);
      await admin.query(`
        INSERT INTO public.role_assignments(
          id,user_id,role_id,scope_type,company_id,active,assigned_by,assigned_at
        ) SELECT $1,$2,role.id,'COMPANY',$3,true,$4,now()
        FROM public.roles role WHERE role.role_key='COMPANY_ADMIN'
      `, [adminActor.assignmentId,adminActor.userId,companyId,owner.userId]);
      await admin.query(`
        INSERT INTO public.products(
          id,product_code,name,category,subcategory,unit_of_measure,
          default_buy_price,default_sell_price,minimum_order_quantity,
          delivery_sla_days,active,needs_review
        ) VALUES ($1,$2,$3,'Office Basics','Writing','unit',90.91,100,1,1,true,false)
      `, [productId,`NDP-P-${fixtureSequence}`,`Native direct product ${fixtureSequence}`]);
      await admin.query(`
        INSERT INTO public.company_wallet_ledger_entries(
          company_id,entry_type,amount_delta,currency,effective_date,
          business_reference,reason,correlation_id,idempotency_key,
          actor_user_id,actor_role_assignment_id,posted_at
        ) VALUES ($1,'TOP_UP',1000,'MYR',CURRENT_DATE,$2,
          'Native controlled direct-purchase fixture',$3,$4,$5,$6,now())
      `, [
        companyId,`NDP-TOPUP-${fixtureSequence}`,randomUUID(),
        `native-direct-topup-${randomUUID()}`,owner.userId,owner.assignmentId,
      ]);
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }

    await app.query(`
      SELECT public.axora_save_branch_delivery_location(
        $1,$2,$3,$4,3.139000,101.686900,'Native controlled instructions',
        'Configure native direct-purchase destination',$5,now()
      )
    `, [
      adminActor.userId,adminActor.assignmentId,branchId,
      `Native canonical destination ${fixtureSequence}`,randomUUID(),
    ]);
    const product = await admin.query<{ ref: string }>(`
      SELECT public_reference AS ref FROM public.products WHERE id=$1
    `, [productId]);
    const read = await app.query<{ cart: Cart }>(`
      SELECT public.axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      ) AS cart
    `, [adminActor.userId,adminActor.assignmentId,branchId,randomUUID()]);
    const added = await app.query<{ cart: Cart }>(`
      SELECT public.axora_procurement_cart_command(
        $1,$2,$3,'ADD',$4,1,'',$5,$6,now()
      ) AS cart
    `, [
      adminActor.userId,adminActor.assignmentId,branchId,product.rows[0]!.ref,
      read.rows[0]!.cart.version,randomUUID(),
    ]);
    return { companyId,branchId,admin: adminActor,cart: added.rows[0]!.cart };
  }

  async function callDirect(
    client: Client,
    fixture: Fixture,
    commandId: string,
  ) {
    const result = await client.query<{ result: DirectResult }>(`
      SELECT public.axora_company_admin_direct_purchase(
        $1,$2,$3,$4,$5,now()
      ) AS result
    `, [
      fixture.admin.userId,fixture.admin.assignmentId,fixture.cart.id,
      fixture.cart.version,commandId,
    ]);
    return result.rows[0]!.result;
  }

  async function evidence(companyId: string) {
    const result = await admin.query<{
      orders: number;
      payments: number;
      invoices: number;
      jobs: number;
      debits: number;
      commands: number;
      successfulCommands: number;
      documentJobs: number;
      deliveryLines: number;
      workflowEvents: number;
      notifications: number;
      notificationRecipients: number;
      orderTotal: string | null;
      budgetSpend: string | null;
      walletDebit: string | null;
      paymentAmount: string | null;
      invoiceAmount: string | null;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.requests request
          WHERE request.company_id=$1 AND request.purchase_mode='COMPANY_ADMIN_DIRECT') AS orders,
        (SELECT count(*)::int FROM public.payments payment JOIN public.invoices invoice
          ON invoice.id=payment.invoice_id WHERE invoice.company_id=$1) AS payments,
        (SELECT count(*)::int FROM public.invoices invoice
          WHERE invoice.company_id=$1 AND invoice.direction='CUSTOMER') AS invoices,
        (SELECT count(*)::int FROM public.delivery_jobs job WHERE job.company_id=$1) AS jobs,
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries entry
          WHERE entry.company_id=$1 AND entry.entry_type='PAYMENT') AS debits,
        (SELECT count(*)::int FROM public.company_admin_direct_purchase_commands command
          WHERE command.company_id=$1) AS commands,
        (SELECT count(*)::int FROM public.company_admin_direct_purchase_commands command
          WHERE command.company_id=$1 AND command.result_status='SUCCESS') AS "successfulCommands",
        (SELECT count(*)::int FROM public.document_generation_jobs job
          WHERE job.company_id=$1 AND job.document_type='FINAL_INVOICE') AS "documentJobs",
        (SELECT count(*)::int FROM public.delivery_job_lines line
          WHERE line.company_id=$1) AS "deliveryLines",
        (SELECT count(*)::int FROM public.workflow_events event
          WHERE event.company_id=$1 AND event.event_key='direct_purchase.completed'
            AND event.idempotency_key LIKE 'direct-purchase-payment:%') AS "workflowEvents",
        (SELECT count(*)::int FROM public.in_app_notifications notification
          JOIN public.workflow_events event ON event.id=notification.workflow_event_id
          WHERE event.company_id=$1
            AND event.event_key='direct_purchase.completed'
            AND event.idempotency_key LIKE 'direct-purchase-payment:%') AS notifications,
        (SELECT count(DISTINCT notification.recipient_user_id)::int
          FROM public.in_app_notifications notification
          JOIN public.workflow_events event ON event.id=notification.workflow_event_id
          WHERE event.company_id=$1 AND event.event_key='direct_purchase.completed'
            AND event.idempotency_key LIKE 'direct-purchase-payment:%') AS "notificationRecipients",
        (SELECT public.axora_request_total_internal(request.id)::text
          FROM public.requests request WHERE request.company_id=$1
            AND request.purchase_mode='COMPANY_ADMIN_DIRECT' LIMIT 1) AS "orderTotal",
        (SELECT sum(entry.spent_delta)::text FROM public.budget_ledger_entries entry
          WHERE entry.company_id=$1 AND entry.entry_type='FINAL_SPEND') AS "budgetSpend",
        (SELECT (-entry.amount_delta)::text FROM public.company_wallet_ledger_entries entry
          WHERE entry.company_id=$1 AND entry.entry_type='PAYMENT' LIMIT 1) AS "walletDebit",
        (SELECT payment.amount::text FROM public.payments payment
          JOIN public.invoices invoice ON invoice.id=payment.invoice_id
          WHERE invoice.company_id=$1 LIMIT 1) AS "paymentAmount",
        (SELECT invoice.amount::text FROM public.invoices invoice
          WHERE invoice.company_id=$1 AND invoice.direction='CUSTOMER' LIMIT 1) AS "invoiceAmount"
    `, [companyId]);
    return result.rows[0]!;
  }

  beforeAll(async () => {
    const host = requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST");
    const port = Number(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"));
    const database = requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE");
    admin = new Client({
      host,port,database,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
      ssl: false,
    });
    appConfig = {
      host,port,database,
      user: requiredEnvironment("DB_USER"),
      password: requiredEnvironment("DB_PASSWORD"),
      ssl: false,
    };
    app = new Client(appConfig);
    await Promise.all([admin.connect(),app.connect()]);
    owner = { userId: randomUUID(),assignmentId: randomUUID() };
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        "Create direct-purchase native Platform Owner fixture",
      ]);
      await admin.query(`
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,is_owner,
          account_setup_completed_at,email_verified_at,account_kind,
          account_status,active,auth_version
        ) SELECT $1,$2,'Direct purchase native owner','not-a-real-hash',
          role.id,true,now(),now(),'PLATFORM','ACTIVE',true,1
        FROM public.roles role WHERE role.role_key='PLATFORM_OWNER'
      `, [owner.userId,`native-direct-owner-${owner.userId}@example.test`]);
      await admin.query(`
        INSERT INTO public.user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,'Direct purchase native owner','en','Asia/Kuala_Lumpur',now())
      `, [owner.userId]);
      await admin.query(`
        INSERT INTO public.role_assignments(
          id,user_id,role_id,scope_type,active,assigned_by,assigned_at
        ) SELECT $1,$2,role.id,'PLATFORM',true,$2,now()
        FROM public.roles role WHERE role.role_key='PLATFORM_OWNER'
      `, [owner.assignmentId,owner.userId]);
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    await admin.query(`
      CREATE OR REPLACE FUNCTION public.axora_test_direct_purchase_boundary_failure()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('axora.test_direct_purchase_failure',true)=TG_ARGV[0] THEN
          RAISE EXCEPTION 'Injected direct-purchase failure at %',TG_ARGV[0];
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER a_test_direct_purchase_after_invoice
      AFTER INSERT ON public.invoices
      FOR EACH ROW EXECUTE FUNCTION
        public.axora_test_direct_purchase_boundary_failure('AFTER_INVOICE');
      CREATE TRIGGER a1_test_direct_purchase_after_payment
      AFTER INSERT ON public.payments
      FOR EACH ROW EXECUTE FUNCTION
        public.axora_test_direct_purchase_boundary_failure('AFTER_PAYMENT');
      CREATE TRIGGER a2_test_direct_purchase_before_delivery_job
      AFTER INSERT ON public.payments
      FOR EACH ROW EXECUTE FUNCTION
        public.axora_test_direct_purchase_boundary_failure('BEFORE_DELIVERY_JOB');
    `);
  }, 30_000);

  afterAll(async () => {
    try {
      await admin?.query(`
        DROP TRIGGER IF EXISTS a_test_direct_purchase_after_invoice
          ON public.invoices;
        DROP TRIGGER IF EXISTS a1_test_direct_purchase_after_payment
          ON public.payments;
        DROP TRIGGER IF EXISTS a2_test_direct_purchase_before_delivery_job
          ON public.payments;
        DROP FUNCTION IF EXISTS public.axora_test_direct_purchase_boundary_failure();
      `);
    } finally {
      await Promise.all([admin?.end(),app?.end()]);
    }
  });

  it("serializes ten calls with one command ID into one financial result", async () => {
    const fixture = await createFixture();
    const commandId = randomUUID();
    const clients = await Promise.all(Array.from({ length: 10 }, connectedAppClient));
    let results: DirectResult[];
    try {
      results = await Promise.all(clients.map((client) => (
        callDirect(client,fixture,commandId)
      )));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
    expect(results.filter((result) => result.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((result) => result.status === "ALREADY_PROCESSED"))
      .toHaveLength(9);
    expect(new Set(results.map((result) => result.requestId))).toHaveLength(1);
    expect(new Set(results.map((result) => result.invoiceId))).toHaveLength(1);
    expect(new Set(results.map((result) => result.deliveryJobId))).toHaveLength(1);
    const sameCommandEvidence = await evidence(fixture.companyId);
    expect(sameCommandEvidence.notifications).toBeGreaterThan(0);
    expect(sameCommandEvidence.notifications)
      .toBe(sameCommandEvidence.notificationRecipients);
    expect(sameCommandEvidence).toMatchObject({
      orders: 1,payments: 1,invoices: 1,jobs: 1,debits: 1,commands: 1,
      successfulCommands: 1,documentJobs: 1,deliveryLines: 1,
      workflowEvents: 1,
      orderTotal: "100.00",budgetSpend: "100.00",walletDebit: "100.00",
      paymentAmount: "100.00",invoiceAmount: "100.00",
    });
  }, 60_000);

  it("serializes ten different command IDs against one Cart into one purchase", async () => {
    const fixture = await createFixture();
    const clients = await Promise.all(Array.from({ length: 10 }, connectedAppClient));
    let results: DirectResult[];
    try {
      results = await Promise.all(clients.map((client) => (
        callDirect(client,fixture,randomUUID())
      )));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
    expect(results.filter((result) => result.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((result) => result.status === "CART_ALREADY_PURCHASED"))
      .toHaveLength(9);
    expect(new Set(results.map((result) => result.requestId))).toHaveLength(1);
    expect(new Set(results.map((result) => result.paymentId))).toHaveLength(1);
    const differentCommandEvidence = await evidence(fixture.companyId);
    expect(differentCommandEvidence.notifications).toBeGreaterThan(0);
    expect(differentCommandEvidence.notifications)
      .toBe(differentCommandEvidence.notificationRecipients);
    expect(differentCommandEvidence).toMatchObject({
      orders: 1,payments: 1,invoices: 1,jobs: 1,debits: 1,commands: 10,
      successfulCommands: 1,documentJobs: 1,deliveryLines: 1,
      workflowEvents: 1,
      orderTotal: "100.00",budgetSpend: "100.00",walletDebit: "100.00",
      paymentAmount: "100.00",invoiceAmount: "100.00",
    });
  }, 60_000);

  it("rolls back injected boundaries in native PostgreSQL", async () => {
    const fixture = await createFixture();
    const boundaries = [
      ["AFTER_DIRECT_ORDER","AFTER_DIRECT_ORDER"],
      ["AFTER_BUDGET_RESERVATION","AFTER_BUDGET_RESERVATION"],
      ["BEFORE_INVOICE","BEFORE_INVOICE"],
      ["AFTER_INVOICE",null],
      ["AFTER_PAYMENT",null],
      ["BEFORE_DELIVERY_JOB",null],
      ["AFTER_DELIVERY_JOB","AFTER_DELIVERY_JOB"],
      ["AFTER_BUDGET_FINALIZATION","AFTER_BUDGET_FINALIZATION"],
      ["AFTER_WALLET_DEBIT","AFTER_WALLET_DEBIT"],
      ["BEFORE_CART_CONSUMPTION","BEFORE_CART_CONSUMPTION"],
      ["AFTER_CART_CONSUMPTION","AFTER_CART_CONSUMPTION"],
    ] as const;
    for (const [boundary,failurePoint] of boundaries) {
      await admin.query("BEGIN");
      try {
        await admin.query(
          "SELECT set_config('axora.test_direct_purchase_failure',$1,true)",
          [boundary],
        );
        await expect(admin.query(`
          SELECT public.axora_company_admin_direct_purchase_internal(
            $1,$2,$3,$4,$5,now(),$6
          )
        `, [
          fixture.admin.userId,fixture.admin.assignmentId,fixture.cart.id,
          fixture.cart.version,randomUUID(),failurePoint,
        ])).rejects.toThrow(/Injected direct-purchase failure/);
      } finally {
        await admin.query("ROLLBACK");
      }
      expect(await evidence(fixture.companyId)).toEqual({
        orders: 0,payments: 0,invoices: 0,jobs: 0,debits: 0,commands: 0,
        successfulCommands: 0,documentJobs: 0,deliveryLines: 0,
        workflowEvents: 0,notifications: 0,notificationRecipients: 0,
        orderTotal: null,budgetSpend: null,walletDebit: null,
        paymentAmount: null,invoiceAmount: null,
      });
      const balances = await admin.query<{ wallet: string; available: string }>(`
        SELECT wallet.available_balance::text AS wallet,
          budget.available::text AS available
        FROM public.v_company_wallet_balances wallet
        JOIN public.budget_accounts account ON account.company_id=wallet.company_id
          AND account.branch_id=$2 AND account.level_type='BRANCH'
        JOIN public.budget_periods period ON period.budget_account_id=account.id
          AND period.status='ACTIVE'
        JOIN public.v_budget_period_balances budget
          ON budget.budget_period_id=period.id
        WHERE wallet.company_id=$1
      `, [fixture.companyId,fixture.branchId]);
      expect(balances.rows[0]).toEqual({ wallet: "1000.00",available: "1000.00" });
    }
  }, 60_000);
});

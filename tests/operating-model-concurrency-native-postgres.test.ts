import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { commandProcurementCart } from "@/lib/procurement-cart";
import { createAuthorizedRequest } from "@/lib/request-writer";

const nativeDescribe = process.env.AXORA_NATIVE_POSTGRES_INTEGRATION === "true"
  ? describe
  : describe.skip;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for native PostgreSQL integration.`);
  return value;
}

type Actor = {
  userId: string;
  assignmentId: string;
};

type RequestFixture = {
  requestId: string;
  revision: number;
  budgetAccountId: string;
  budgetPeriodId: string;
};

type ScopedActorInput = {
  label: string;
  role: "PLATFORM_OWNER" | "CLIENT_ACCOUNT_MANAGER" | "COMPANY_ADMIN"
    | "REQUESTER" | "BRANCH_APPROVER" | "DELIVERY_GUY";
  accountKind: "PLATFORM" | "COMPANY" | "DELIVERY";
  scopeType: "PLATFORM" | "COMPANY" | "BRANCH" | "DELIVERY";
  companyId?: string;
  branchId?: string;
  isOwner?: boolean;
};

nativeDescribe("Prompt 7 native PostgreSQL concurrency", () => {
  let admin: Client | undefined;
  let app: Client | undefined;
  let appConfig: ClientConfig;
  let owner: Actor;
  let managerA: Actor;
  let managerB: Actor;
  let companyAdmin: Actor;
  let otherCompanyAdmin: Actor;
  let requester: Actor;
  let approvers: Actor[];
  let drivers: Actor[];
  let financeCompanyId: string;
  let financeBranchId: string;
  let otherCompanyId: string;
  let productId: string;

  async function connectedAppClient() {
    const client = new Client(appConfig);
    await client.connect();
    return client;
  }

  async function withAppClient<T>(operation: (client: Client) => Promise<T>) {
    const client = await connectedAppClient();
    try {
      return await operation(client);
    } finally {
      await client.end();
    }
  }

  async function waitUntilBlockedBy(
    blockedBackendPid: number,
    blockerBackendPid: number,
  ) {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const blocked = await admin.query<{ blocked: boolean }>(`
        SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked
      `, [blockedBackendPid,blockerBackendPid]);
      if (blocked.rows[0]?.blocked) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("The expected PostgreSQL lock wait was not observed.");
  }

  async function createActor(input: ScopedActorInput): Promise<Actor> {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const userId = randomUUID();
    const assignmentId = randomUUID();
    const email = `prompt7-${input.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${userId}@example.test`;
    await admin.query("BEGIN");
    try {
      await admin.query("SELECT set_config('axora.change_reason',$1,true)", [
        `Prompt 7 ${input.label} native fixture`,
      ]);
      await admin.query(`
        INSERT INTO public.users(
          id,email,display_name,password_hash,role_id,active,is_owner,
          company_id,branch_id,account_setup_completed_at,email_verified_at,
          auth_version,account_kind,account_status
        ) SELECT
          $1,$2,$3,'not-a-real-hash',role.id,true,$4,$5,$6,now(),now(),1,$7,'ACTIVE'
        FROM public.roles role WHERE role.role_key=$8
      `, [
        userId,email,`Prompt 7 ${input.label}`,input.isOwner === true,
        input.companyId ?? null,input.branchId ?? null,input.accountKind,input.role,
      ]);
      await admin.query(`
        INSERT INTO public.user_profiles(
          user_id,display_name,preferred_locale,timezone,profile_completed_at
        ) VALUES ($1,$2,'en','Asia/Kuala_Lumpur',now())
      `, [userId,`Prompt 7 ${input.label}`]);
      if (input.companyId) {
        await admin.query(`
          INSERT INTO public.company_memberships(
            user_id,company_id,status,is_primary,joined_at,created_by
          ) VALUES ($1,$2,'ACTIVE',true,now(),$3)
        `, [userId,input.companyId,owner?.userId ?? userId]);
      }
      if (input.companyId && input.branchId) {
        await admin.query(`
          INSERT INTO public.branch_assignments(
            user_id,company_id,branch_id,status,is_primary,created_by
          ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
        `, [userId,input.companyId,input.branchId,owner?.userId ?? userId]);
      }
      await admin.query(`
        INSERT INTO public.role_assignments(
          id,user_id,role_id,scope_type,company_id,branch_id,department_id,
          supplier_id,active,assigned_by,assigned_at
        ) SELECT $1,$2,role.id,$3,$4,$5,NULL,NULL,true,$6,now()
        FROM public.roles role WHERE role.role_key=$7
      `, [
        assignmentId,userId,input.scopeType,input.companyId ?? null,
        input.branchId ?? null,owner?.userId ?? userId,input.role,
      ]);
      if (input.role === "DELIVERY_GUY") {
        await admin.query(`
          INSERT INTO public.delivery_agent_profiles(user_id,agent_code,active)
          VALUES ($1,$2,true)
        `, [userId,`P7-${userId.slice(0, 8)}`]);
      }
      await admin.query("COMMIT");
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    return { userId,assignmentId };
  }

  async function visibleCompanyIds(actor: Actor) {
    if (!app) throw new Error("Native PostgreSQL application fixture is unavailable.");
    const result = await app.query<{
      snapshot: { companies?: Array<{ id: string }> } | null;
    }>(
      "SELECT public.axora_company_lifecycle_workspace($1,$2,now()) AS snapshot",
      [actor.userId,actor.assignmentId],
    );
    return result.rows[0]?.snapshot?.companies?.map((company) => company.id) ?? [];
  }

  async function createRequest(amount: string, label: string): Promise<RequestFixture> {
    if (!admin || !app) throw new Error("Native PostgreSQL fixture is unavailable.");
    if (!/^[1-9][0-9]*\.[0-9]{2}$/.test(amount)) {
      throw new Error("Native money fixtures must use positive two-decimal strings.");
    }
    const requestResult = await admin.query<{ id: string }>(`
      INSERT INTO public.requests(
        order_code,request_date,request_type_id,company_id,branch_id,
        department,requested_by,requester_contact,needed_by_date,urgency_id,
        status_id,notes,created_by,estimated_delivery_fee,tax_rate,tax_amount,
        client_submission_key
      ) VALUES (
        $1,CURRENT_DATE,public.lookup_id('request_type','Standard'),$2,$3,
        'Operations','Prompt 7 requester','requester-prompt7@example.test',
        CURRENT_DATE+7,public.lookup_id('urgency','Normal'),
        public.lookup_id('request_status','New Request'),$4,$5,
        $6::numeric-110.00,0,0,
        gen_random_uuid()
      ) RETURNING id::text
    `, [
      `P7-${label}-${randomUUID().slice(0, 8)}`,financeCompanyId,financeBranchId,
      `Prompt 7 ${label} request`,requester.userId,amount,
    ]);
    const requestId = requestResult.rows[0]?.id;
    if (!requestId) throw new Error("Prompt 7 request fixture was not created.");
    await admin.query(`
      INSERT INTO public.request_lines(
        request_line_code,request_id,product_id,product_name_snapshot,
        category_snapshot,subcategory_snapshot,quantity,unit_of_measure,
        supplier_confirmation_status_id,unit_buy_price,unit_sell_price
      ) SELECT public.next_request_line_code(),$1,product.id,product.name,
        product.category,product.subcategory,1,product.unit_of_measure,
        public.lookup_id('supplier_confirmation','Pending'),0,0
      FROM public.products product WHERE product.id=$2
    `, [requestId,productId]);
    await app.query(
      "SELECT public.axora_initialize_request_approval($1,$2,$3,$4,now())",
      [requester.userId,requester.assignmentId,requestId,`initialize-${requestId}`],
    );
    const state = await admin.query<{
      revision: number;
      amount: string;
      budgetAccountId: string;
      budgetPeriodId: string;
    }>(`
      SELECT request.approval_revision::int AS revision,
        snapshot.amount::text AS amount,
        request.budget_account_id::text AS "budgetAccountId",
        request.budget_period_id::text AS "budgetPeriodId"
      FROM public.requests request
      JOIN public.request_approval_snapshots snapshot
        ON snapshot.request_id=request.id
       AND snapshot.request_version=request.request_version
      WHERE request.id=$1
    `, [requestId]);
    expect(state.rows[0]?.amount).toBe(amount);
    return {
      requestId,
      revision: state.rows[0]!.revision,
      budgetAccountId: state.rows[0]!.budgetAccountId,
      budgetPeriodId: state.rows[0]!.budgetPeriodId,
    };
  }

  beforeAll(async () => {
    const port = Number.parseInt(requiredEnvironment("AXORA_NATIVE_POSTGRES_PORT"), 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("AXORA_NATIVE_POSTGRES_PORT is invalid.");
    }
    const baseConfig = {
      host: requiredEnvironment("AXORA_NATIVE_POSTGRES_HOST"),
      port,
      database: requiredEnvironment("AXORA_NATIVE_POSTGRES_DATABASE"),
      ssl: false,
    } satisfies ClientConfig;
    admin = new Client({
      ...baseConfig,
      user: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_USER"),
      password: requiredEnvironment("AXORA_NATIVE_POSTGRES_ADMIN_PASSWORD"),
    });
    appConfig = {
      ...baseConfig,
      user: requiredEnvironment("DB_USER"),
      password: requiredEnvironment("DB_PASSWORD"),
    };
    app = new Client(appConfig);
    await admin.connect();
    await app.connect();

    owner = await createActor({
      label: "Owner",role: "PLATFORM_OWNER",accountKind: "PLATFORM",
      scopeType: "PLATFORM",isOwner: true,
    });
    managerA = await createActor({
      label: "Manager A",role: "CLIENT_ACCOUNT_MANAGER",accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    });
    managerB = await createActor({
      label: "Manager B",role: "CLIENT_ACCOUNT_MANAGER",accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    });

    financeCompanyId = randomUUID();
    financeBranchId = randomUUID();
    await admin.query(`
      INSERT INTO public.companies(
        id,company_code,name,legal_name,registration_number,industry,
        active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
      ) VALUES (
        $1,$2,'Prompt 7 finance company','Prompt 7 finance company','','Operations',
        true,'ACTIVE',true,$3::numeric,$4
      )
    `, [
      financeCompanyId,`P7-FIN-${financeCompanyId.slice(0, 8)}`,
      "50000.00",owner.userId,
    ]);
    await admin.query(`
      INSERT INTO public.branches(
        id,branch_code_id,company_id,name,branch_code,delivery_address,city,
        timezone,monthly_budget,active
      ) VALUES (
        $1,$2,$3,'Prompt 7 finance branch',$2,'Original delivery address',
        'Kuala Lumpur','Asia/Kuala_Lumpur',$4::numeric,true
      )
    `, [
      financeBranchId,`P7-BR-${financeBranchId.slice(0, 8)}`,
      financeCompanyId,"8000.00",
    ]);

    companyAdmin = await createActor({
      label: "Company Admin",role: "COMPANY_ADMIN",accountKind: "COMPANY",
      scopeType: "COMPANY",companyId: financeCompanyId,
    });
    otherCompanyId = randomUUID();
    await admin.query(`
      INSERT INTO public.companies(
        id,company_code,name,legal_name,registration_number,industry,
        active,lifecycle_status,portal_access_enabled,contractual_ceiling,created_by
      ) VALUES (
        $1,$2,'Prompt 7 other company','Prompt 7 other company','','Operations',
        true,'ACTIVE',true,$3::numeric,$4
      )
    `, [
      otherCompanyId,`P7-OTHER-${otherCompanyId.slice(0, 8)}`,
      "50000.00",owner.userId,
    ]);
    otherCompanyAdmin = await createActor({
      label: "Other Company Admin",role: "COMPANY_ADMIN",accountKind: "COMPANY",
      scopeType: "COMPANY",companyId: otherCompanyId,
    });
    requester = await createActor({
      label: "Requester",role: "REQUESTER",accountKind: "COMPANY",
      scopeType: "BRANCH",companyId: financeCompanyId,branchId: financeBranchId,
    });
    approvers = [];
    for (let index = 0; index < 10; index += 1) {
      approvers.push(await createActor({
        label: `Approver ${index + 1}`,role: "BRANCH_APPROVER",accountKind: "COMPANY",
        scopeType: "BRANCH",companyId: financeCompanyId,branchId: financeBranchId,
      }));
    }
    drivers = [];
    for (let index = 0; index < 10; index += 1) {
      drivers.push(await createActor({
        label: `Delivery Agent ${index + 1}`,role: "DELIVERY_GUY",
        accountKind: "DELIVERY",scopeType: "DELIVERY",
      }));
    }
    await admin.query(`
      INSERT INTO public.approval_limits(
        role_id,permission_id,scope_type,company_id,branch_id,currency,
        maximum_amount,allow_self_approval,starts_at,active,reason,changed_by
      ) SELECT role.id,permission.id,'BRANCH',$1,$2,'MYR',$3::numeric,false,
        now()-interval '1 minute',true,'Prompt 7 native approval authority',$4
      FROM public.roles role
      JOIN public.permissions permission
        ON permission.permission_code='request.approve.other'
      WHERE role.role_key='BRANCH_APPROVER'
    `, [financeCompanyId,financeBranchId,"50000.00",owner.userId]);
    const product = await admin.query<{ id: string }>(`
      INSERT INTO public.products(
        product_code,name,category,subcategory,unit_of_measure,
        default_buy_price,default_sell_price,minimum_order_quantity,active
      ) VALUES ($1,'Prompt 7 native product','Operations','Concurrency','unit',
        $2::numeric,$3::numeric,1,true) RETURNING id::text
    `, [`P7-PROD-${randomUUID().slice(0, 8)}`,"100.00","110.00"]);
    productId = product.rows[0]!.id;

    await app.query(`
      SELECT public.axora_save_branch_delivery_location(
        $1,$2,$3,'Original canonical destination',3.139000,101.686900,
        'Use the loading entrance','Configure canonical delivery coordinates',
        $4,now()
      )
    `, [companyAdmin.userId,companyAdmin.assignmentId,financeBranchId,randomUUID()]);
    await app.query(`
      SELECT public.axora_assign_company_manager(
        $1,$2,$3,$4,'PRIMARY',NULL,NULL,
        'Explicit finance-company CAM coverage for isolation testing',now()
      )
    `, [owner.userId,owner.assignmentId,financeCompanyId,managerA.userId]);
  }, 60_000);

  afterAll(async () => {
    await app?.end();
    await admin?.end();
  });

  it("keeps Owner global and serializes CAM handover into one visible portfolio", async () => {
    if (!app || !admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const created = await app.query<{
      snapshot: { companyId: string };
    }>(`
      SELECT public.axora_create_company_direct(
        $1,$2,'Prompt 7 direct company','Prompt 7 direct company Sdn Bhd',
        'Technology','Direct Owner-created company for native handover testing',
        'https://example.test','Primary contact','Monthly','Native concurrency fixture',now()
      ) AS snapshot
    `, [owner.userId,owner.assignmentId]);
    const companyId = created.rows[0]!.snapshot.companyId;
    expect(await visibleCompanyIds(owner)).toContain(companyId);
    expect(await visibleCompanyIds(managerA)).not.toContain(companyId);
    expect(await visibleCompanyIds(managerB)).not.toContain(companyId);

    await app.query(`
      SELECT public.axora_assign_company_manager(
        $1,$2,$3,$4,'PRIMARY',NULL,NULL,'Initial explicit CAM handover',now()
      )
    `, [owner.userId,owner.assignmentId,companyId,managerA.userId]);
    expect(await visibleCompanyIds(managerA)).toContain(companyId);
    expect(await visibleCompanyIds(managerB)).not.toContain(companyId);

    const handovers = await Promise.allSettled([
      withAppClient((client) => client.query(`
        SELECT public.axora_assign_company_manager(
          $1,$2,$3,$4,'PRIMARY',NULL,NULL,'Concurrent reassignment to manager B',now()
        )
      `, [owner.userId,owner.assignmentId,companyId,managerB.userId])),
      withAppClient((client) => client.query(`
        SELECT public.axora_assign_company_manager(
          $1,$2,$3,$4,'PRIMARY',NULL,NULL,'Concurrent reassignment to manager A',now()
        )
      `, [owner.userId,owner.assignmentId,companyId,managerA.userId])),
    ]);
    expect(handovers.some((result) => result.status === "fulfilled")).toBe(true);
    const active = await admin.query<{ managerId: string; count: number }>(`
      SELECT min(manager_user_id::text) AS "managerId",count(*)::int AS count
      FROM public.company_assignments
      WHERE company_id=$1 AND assignment_type='PRIMARY' AND status='ACTIVE'
    `, [companyId]);
    expect(active.rows[0]!.count).toBe(1);
    expect([managerA.userId,managerB.userId]).toContain(active.rows[0]!.managerId);
    const managerAVisible = (await visibleCompanyIds(managerA)).includes(companyId);
    const managerBVisible = (await visibleCompanyIds(managerB)).includes(companyId);
    expect(managerAVisible).toBe(active.rows[0]!.managerId === managerA.userId);
    expect(managerBVisible).toBe(active.rows[0]!.managerId === managerB.userId);
    expect(await visibleCompanyIds(owner)).toContain(companyId);
  }, 60_000);

  it("atomically owns CAM-created companies across replay and concurrent commands", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const createAsManagerA = (client: Client, commandId: string, name: string) => (
      client.query<{ snapshot: { companyId: string; created: boolean } }>(`
        SELECT public.axora_create_company_direct(
          $1,$2,$3,$4,$4,'Operations','Native CAM ownership concurrency',
          '','CAM A contact','Monthly',NULL,now()
        ) AS snapshot
      `, [managerA.userId,managerA.assignmentId,commandId,name])
    );

    const replayCommand = randomUUID();
    const replayResults = await Promise.all([
      withAppClient((client) => createAsManagerA(
        client,replayCommand,"Native replay CAM company",
      )),
      withAppClient((client) => createAsManagerA(
        client,replayCommand,"Native replay CAM company",
      )),
    ]);
    const replayCompanyIds = replayResults.map(
      (result) => result.rows[0]!.snapshot.companyId,
    );
    expect(new Set(replayCompanyIds).size).toBe(1);
    expect(replayResults.map((result) => result.rows[0]!.snapshot.created).sort())
      .toEqual([false,true]);

    const concurrentCommands = [randomUUID(),randomUUID()];
    const concurrentResults = await Promise.all(concurrentCommands.map(
      (commandId,index) => withAppClient((client) => createAsManagerA(
        client,commandId,`Native concurrent CAM company ${index + 1}`,
      )),
    ));
    const concurrentCompanyIds = concurrentResults.map(
      (result) => result.rows[0]!.snapshot.companyId,
    );
    expect(new Set(concurrentCompanyIds).size).toBe(2);

    const ownership = await admin.query<{
      companyId: string; managerId: string; activePrimary: number; source: string;
    }>(`
      SELECT company.id::text AS "companyId",
        min(assignment.manager_user_id::text) AS "managerId",
        count(assignment.id)::int AS "activePrimary",
        min(assignment.assignment_source) AS source
      FROM public.companies company
      LEFT JOIN public.company_assignments assignment
        ON assignment.company_id=company.id
       AND assignment.assignment_type='PRIMARY'
       AND assignment.status='ACTIVE'
      WHERE company.id=ANY($1::uuid[])
      GROUP BY company.id
      ORDER BY company.id
    `, [[...replayCompanyIds,...concurrentCompanyIds]]);
    expect(ownership.rows).toHaveLength(3);
    for (const row of ownership.rows) {
      expect(row.managerId).toBe(managerA.userId);
      expect(row.activePrimary).toBe(1);
      expect(row.source).toBe("CREATED_BY_CAM");
    }
  }, 60_000);

  it("creates one request from ten retried canonical-cart submissions", async () => {
    if (!admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const actor: AuthenticatedSessionUser = {
      id: requester.userId,
      email: "requester-prompt8@example.test",
      name: "Prompt 8 requester",
      role: "REQUESTER",
      accountKind: "COMPANY",
      scopeType: "BRANCH",
      companyId: financeCompanyId,
      branchId: financeBranchId,
      roleAssignmentId: requester.assignmentId,
      isOwner: false,
      authVersion: 1,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
    };
    const product = await admin.query<{ publicRef: string }>(`
      SELECT public_reference AS "publicRef" FROM public.products WHERE id=$1
    `, [productId]);
    const empty = await commandProcurementCart(actor, {
      branchId: financeBranchId, operation: "READ",
    });
    const cart = await commandProcurementCart(actor, {
      branchId: financeBranchId, operation: "ADD",
      productRef: product.rows[0]!.publicRef, quantity: 1,
      expectedVersion: empty.version,
    });
    const submissionKey = randomUUID();
    const metadata = {
      companyId: "forged-company-is-ignored",
      branchId: financeBranchId,
      requestType: "Standard" as const,
      department: "Operations",
      neededByDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      urgency: "Normal" as const,
      notes: "Ten-way canonical cart submission",
      lines: [{ productId: "forged-product-is-ignored", quantity: 999_999 }],
    };
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, () => (
      createAuthorizedRequest(metadata, actor, submissionKey, {
        id: cart.id, version: cart.version,
      })
    )));
    const fulfilledIds = attempts.flatMap((attempt) => (
      attempt.status === "fulfilled" ? [attempt.value] : []
    ));
    expect(fulfilledIds.length).toBeGreaterThanOrEqual(1);
    expect(new Set(fulfilledIds).size).toBe(1);
    for (const rejected of attempts.filter((attempt) => attempt.status === "rejected")) {
      expect(String((rejected as PromiseRejectedResult).reason)).toMatch(/cart|changed|submitted/i);
    }
    const evidence = await admin.query<{
      requests: number; lines: number; quantity: number; reservations: number;
      companyId: string; branchId: string; carts: number;
    }>(`
      SELECT count(DISTINCT request.id)::int AS requests,
        count(DISTINCT line.id)::int AS lines,
        max(line.quantity)::int AS quantity,
        count(DISTINCT reservation.id)::int AS reservations,
        min(request.company_id::text) AS "companyId",
        min(request.branch_id::text) AS "branchId",
        count(DISTINCT cart.id)::int AS carts
      FROM public.requests request
      JOIN public.request_lines line ON line.request_id=request.id
      JOIN public.budget_reservations reservation ON reservation.request_id=request.id
      JOIN public.procurement_carts cart ON cart.submitted_request_id=request.id
      WHERE request.created_by=$1 AND request.client_submission_key=$2
    `, [requester.userId, submissionKey]);
    expect(evidence.rows[0]).toEqual({
      requests: 1, lines: 1, quantity: 1, reservations: 1,
      companyId: financeCompanyId, branchId: financeBranchId, carts: 1,
    });

    await expect(app!.query(`
      SELECT public.axora_procurement_cart_command(
        $1,$2,$3,'READ',NULL,NULL,'',NULL,$4,now()
      )
    `, [otherCompanyAdmin.userId,otherCompanyAdmin.assignmentId,
      financeBranchId,randomUUID()])).rejects.toMatchObject({ code: "42501" });

    const [cancelClient,rejectClient] = await Promise.all([
      connectedAppClient(), connectedAppClient(),
    ]);
    let terminalAttempts: PromiseSettledResult<unknown>[];
    try {
      terminalAttempts = await Promise.allSettled([
        cancelClient.query(`
          SELECT public.axora_decide_request_approval(
            $1,$2,$3,1,'CANCEL','',NULL,
            'Concurrent requester cancellation releases once',$4,now()
          )
        `, [requester.userId,requester.assignmentId,fulfilledIds[0],randomUUID()]),
        rejectClient.query(`
          SELECT public.axora_decide_request_approval(
            $1,$2,$3,1,'REJECT','',NULL,
            'Concurrent approver rejection releases once',$4,now()
          )
        `, [approvers[0]!.userId,approvers[0]!.assignmentId,
          fulfilledIds[0],randomUUID()]),
      ]);
    } finally {
      await Promise.all([cancelClient.end(),rejectClient.end()]);
    }
    expect(terminalAttempts.filter((attempt) => attempt.status === "fulfilled"))
      .toHaveLength(1);
    const releaseEvidence = await admin.query<{
      state: string; decisions: number; releaseEvents: number;
      releaseEntries: number; reservationStatus: string;
    }>(`
      SELECT request.approval_state AS state,
        (SELECT count(*)::int FROM public.request_approval_decisions decision
          WHERE decision.request_id=request.id
            AND decision.action IN ('CANCEL','REJECT')) AS decisions,
        (SELECT count(*)::int FROM public.budget_reservation_events event
          WHERE event.reservation_id=reservation.id
            AND event.event_type='RELEASED') AS "releaseEvents",
        (SELECT count(*)::int FROM public.budget_ledger_entries entry
          WHERE entry.reservation_id=reservation.id
            AND entry.entry_type='RELEASE') AS "releaseEntries",
        reservation.status AS "reservationStatus"
      FROM public.requests request
      JOIN public.budget_reservations reservation ON reservation.request_id=request.id
      WHERE request.id=$1
    `, [fulfilledIds[0]]);
    expect(releaseEvidence.rows[0]).toEqual({
      state: expect.stringMatching(/^(CANCELLED|REJECTED)$/), decisions: 1,
      releaseEvents: 1, releaseEntries: 1, reservationStatus: "RELEASED",
    });

    await app!.query(`
      SELECT public.axora_set_category_policy(
        $1,$2,'BRANCH',$3,$4,NULL,true,ARRAY[]::text[],0,
        'Temporarily forbid this branch catalogue for race-safe verification',
        $5,now()
      )
    `, [companyAdmin.userId,companyAdmin.assignmentId,financeCompanyId,
      financeBranchId,randomUUID()]);
    const forbiddenCart = await commandProcurementCart(actor, {
      branchId: financeBranchId, operation: "READ",
    });
    await expect(commandProcurementCart(actor, {
      branchId: financeBranchId, operation: "ADD",
      productRef: product.rows[0]!.publicRef, quantity: 1,
      expectedVersion: forbiddenCart.version,
    })).rejects.toMatchObject({ code: "P8204" });
    await app!.query(`
      SELECT public.axora_set_category_policy(
        $1,$2,'BRANCH',$3,$4,NULL,false,ARRAY[]::text[],1,
        'Restore inherited catalogue policy after race-safe verification',
        $5,now()
      )
    `, [companyAdmin.userId,companyAdmin.assignmentId,financeCompanyId,
      financeBranchId,randomUUID()]);
  }, 60_000);

  it("credits once, pays once under ten-way contention, and self-claims once", async () => {
    if (!app || !admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const requestCommand = randomUUID();
    const requested = await app.query<{
      payload: { requestId: string; created: boolean };
    }>(`
      SELECT public.axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'P7-NATIVE-TOPUP','Native PostgreSQL concurrency funding',
        $5,now()
      ) AS payload
    `, [
      companyAdmin.userId,companyAdmin.assignmentId,financeCompanyId,
      "5000.00",requestCommand,
    ]);
    expect(requested.rows[0]!.payload.created).toBe(true);
    const topUpRequestId = requested.rows[0]!.payload.requestId;
    const requestedReplay = await app.query<{
      payload: { requestId: string; created: boolean; amount: string; status: string };
    }>(`
      SELECT public.axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'P7-NATIVE-TOPUP','Native PostgreSQL concurrency funding',
        $5,now()
      ) AS payload
    `, [
      companyAdmin.userId,companyAdmin.assignmentId,financeCompanyId,
      "5000.00",requestCommand,
    ]);
    expect(requestedReplay.rows[0]!.payload).toMatchObject({
      requestId: topUpRequestId,created: false,amount: "5000.00",status: "REQUESTED",
    });
    await expect(app.query(`
      SELECT public.axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'P7-NATIVE-TOPUP-ALTERED',
        'Native PostgreSQL concurrency funding',$5,now()
      )
    `, [
      companyAdmin.userId,companyAdmin.assignmentId,financeCompanyId,
      "5000.01",requestCommand,
    ])).rejects.toThrow(/top-up request is unavailable/i);

    const recordCommands = [randomUUID(),randomUUID()];
    const recordResults = await Promise.all(recordCommands.map((commandId) => (
      withAppClient((client) => client.query<{
        payload: { created: boolean; ledgerEntryId: string };
      }>(`
        SELECT public.axora_record_company_wallet_top_up(
          $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'P7-NATIVE-RECEIVED',
          'Externally confirmed native concurrency funds',$6,now()
        ) AS payload
      `, [
        owner.userId,owner.assignmentId,financeCompanyId,topUpRequestId,
        "5000.00",commandId,
      ]))
    )));
    expect(recordResults.filter((result) => result.rows[0]!.payload.created)).toHaveLength(1);
    expect(new Set(recordResults.map((result) => result.rows[0]!.payload.ledgerEntryId)).size)
      .toBe(1);
    const winningRecordIndex = recordResults.findIndex((result) => (
      result.rows[0]!.payload.created
    ));
    expect(winningRecordIndex).toBeGreaterThanOrEqual(0);
    const winningRecordCommand = recordCommands[winningRecordIndex]!;
    const ledgerEntryId = recordResults[winningRecordIndex]!.rows[0]!.payload.ledgerEntryId;
    const replay = await app.query<{ payload: { ledgerEntryId: string } }>(`
      SELECT public.axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'P7-NATIVE-RECEIVED',
        'Externally confirmed native concurrency funds',$6,now()
      ) AS payload
    `, [
      owner.userId,owner.assignmentId,financeCompanyId,topUpRequestId,
      "5000.00",recordCommands[0],
    ]);
    expect(replay.rows[0]!.payload.ledgerEntryId)
      .toBe(recordResults[0]!.rows[0]!.payload.ledgerEntryId);
    await expect(app.query(`
      SELECT public.axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'P7-NATIVE-ALTERED',
        'Altered payload must not inherit the prior result',$6,now()
      )
    `, [
      owner.userId,owner.assignmentId,financeCompanyId,topUpRequestId,
      "5000.01",recordCommands[0],
    ])).rejects.toThrow(/received top-up is unavailable/i);

    const credited = await admin.query<{
      credits: number;
      balance: string;
      requestStatus: string;
      statusVersion: number;
      requestedAmount: string;
      requestCommandId: string;
      ledgerEntryId: string;
      amountDelta: string;
      ledgerReference: string;
      ledgerReason: string;
      ledgerCommandKey: string;
      ledgerActorUserId: string;
      ledgerActorAssignmentId: string;
      topUpEvents: number;
      requestedEvents: number;
      recordedEvents: number;
      alreadyRecordedEvents: number;
      distinctEventCommands: number;
      minPayloadHashLength: number;
      maxPayloadHashLength: number;
      workflowEvents: number;
      workflowEventKeys: string[];
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries
          WHERE company_id=$1 AND entry_type='TOP_UP') AS credits,
        (SELECT available_balance::text FROM public.v_company_wallet_balances
          WHERE company_id=$1) AS balance,
        request.status AS "requestStatus",
        request.status_version::int AS "statusVersion",
        request.requested_amount::text AS "requestedAmount",
        request.command_id::text AS "requestCommandId",
        ledger.id::text AS "ledgerEntryId",
        ledger.amount_delta::text AS "amountDelta",
        ledger.business_reference AS "ledgerReference",
        ledger.reason AS "ledgerReason",
        ledger.idempotency_key AS "ledgerCommandKey",
        ledger.actor_user_id::text AS "ledgerActorUserId",
        ledger.actor_role_assignment_id::text AS "ledgerActorAssignmentId",
        (SELECT count(*)::int FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id) AS "topUpEvents",
        (SELECT count(*)::int FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id AND event.event_type='REQUESTED')
          AS "requestedEvents",
        (SELECT count(*)::int FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id AND event.event_type='RECORDED')
          AS "recordedEvents",
        (SELECT count(*)::int FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id AND event.event_type='ALREADY_RECORDED')
          AS "alreadyRecordedEvents",
        (SELECT count(DISTINCT event.command_id)::int
          FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id) AS "distinctEventCommands",
        (SELECT min(char_length(event.payload_hash))::int
          FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id) AS "minPayloadHashLength",
        (SELECT max(char_length(event.payload_hash))::int
          FROM public.company_wallet_top_up_events event
          WHERE event.top_up_request_id=request.id) AS "maxPayloadHashLength",
        (SELECT count(*)::int FROM public.workflow_events event
          WHERE event.company_id=$1 AND event.aggregate_type='company-wallet-top-up'
            AND event.aggregate_id=request.id) AS "workflowEvents",
        (SELECT array_agg(event.event_key ORDER BY event.event_version)
          FROM public.workflow_events event
          WHERE event.company_id=$1 AND event.aggregate_type='company-wallet-top-up'
            AND event.aggregate_id=request.id) AS "workflowEventKeys"
      FROM public.company_wallet_top_up_requests request
      JOIN public.company_wallet_ledger_entries ledger
        ON ledger.top_up_request_id=request.id AND ledger.entry_type='TOP_UP'
      WHERE request.id=$2
    `, [financeCompanyId,topUpRequestId]);
    expect(credited.rows[0]).toEqual({
      credits: 1,
      balance: "5000.00",
      requestStatus: "RECEIVED",
      statusVersion: 2,
      requestedAmount: "5000.00",
      requestCommandId: requestCommand,
      ledgerEntryId,
      amountDelta: "5000.00",
      ledgerReference: "P7-NATIVE-RECEIVED",
      ledgerReason: "Externally confirmed native concurrency funds",
      ledgerCommandKey: `top-up:${winningRecordCommand}`,
      ledgerActorUserId: owner.userId,
      ledgerActorAssignmentId: owner.assignmentId,
      topUpEvents: 3,
      requestedEvents: 1,
      recordedEvents: 1,
      alreadyRecordedEvents: 1,
      distinctEventCommands: 3,
      minPayloadHashLength: 64,
      maxPayloadHashLength: 64,
      workflowEvents: 2,
      workflowEventKeys: ["wallet.top_up.requested","wallet.top_up.recorded"],
    });

    const request = await createRequest("1000.00","APPROVE-PAY");
    const commandIds = approvers.map(() => randomUUID());
    const clients = await Promise.all(approvers.map(() => connectedAppClient()));
    let outcomes: Array<{
      status: string;
      invoiceId: string;
      created: boolean;
      amount: string;
      currency: string;
      commandId: string;
      requestId: string;
      correlationId: string;
      approvalDecisionId: string;
      budgetDecisionId: string;
    }>;
    try {
      outcomes = await Promise.all(clients.map((client,index) => client.query<{
        payload: {
          status: string;
          invoiceId: string;
          created: boolean;
          amount: string;
          currency: string;
          commandId: string;
          requestId: string;
          correlationId: string;
          approvalDecisionId: string;
          budgetDecisionId: string;
        };
      }>(`
        SELECT public.axora_approve_and_pay(
          $1,$2,$3,$4,'Concurrent authorized Approve and Pay',$5,now()
        ) AS payload
      `, [
        approvers[index]!.userId,approvers[index]!.assignmentId,
        request.requestId,request.revision,commandIds[index],
      ]).then((result) => result.rows[0]!.payload)));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
    expect(outcomes.filter((outcome) => outcome.status === "SUCCESS")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "ALREADY_PROCESSED"))
      .toHaveLength(9);
    expect(new Set(outcomes.map((outcome) => outcome.invoiceId)).size).toBe(1);
    const winningIndex = outcomes.findIndex((outcome) => outcome.status === "SUCCESS");
    const winningOutcome = outcomes[winningIndex]!;
    expect(winningOutcome).toMatchObject({
      status: "SUCCESS",created: true,amount: "1000.00",currency: "MYR",
      commandId: commandIds[winningIndex],requestId: request.requestId,
    });
    for (const outcome of outcomes.filter((item) => item.status === "ALREADY_PROCESSED")) {
      expect(outcome).toMatchObject({
        created: false,amount: "1000.00",currency: "MYR",requestId: request.requestId,
      });
    }
    const lostResponseRetry = await app.query<{ payload: typeof winningOutcome }>(`
      SELECT public.axora_approve_and_pay(
        $1,$2,$3,$4,'Concurrent authorized Approve and Pay',$5,now()
      ) AS payload
    `, [
      approvers[winningIndex]!.userId,approvers[winningIndex]!.assignmentId,
      request.requestId,request.revision,commandIds[winningIndex],
    ]);
    expect(lostResponseRetry.rows[0]!.payload).toEqual(winningOutcome);
    await expect(app.query(`
      SELECT public.axora_approve_and_pay(
        $1,$2,$3,$4,'Altered reason must not inherit a paid result',$5,now()
      )
    `, [
      approvers[winningIndex]!.userId,approvers[winningIndex]!.assignmentId,
      request.requestId,request.revision,commandIds[winningIndex],
    ])).rejects.toThrow(/Approve & Pay is unavailable/i);

    const financialEvidence = await admin.query<{
      walletPayments: number;
      budgetFinalizations: number;
      invoices: number;
      payments: number;
      approvalDecisions: number;
      documentJobs: number;
      deliveryJobs: number;
      balance: string;
      requestState: string;
      requestRevision: number;
      walletAmount: string;
      walletCurrency: string;
      walletReason: string;
      walletIdempotencyKey: string;
      walletActorUserId: string;
      walletActorAssignmentId: string;
      budgetAmount: string;
      budgetAvailableDelta: string;
      budgetReservedDelta: string;
      budgetSpentDelta: string;
      budgetReasonCode: string;
      budgetIdempotencyKey: string;
      reservationStatus: string;
      reservedAmount: string;
      remainingReserved: string;
      reservationSpent: string;
      finalizeDecisions: number;
      approveCommands: number;
      successfulCommands: number;
      alreadyProcessedCommands: number;
      distinctCommands: number;
      commandPayloadHashMin: number;
      commandPayloadHashMax: number;
      paymentEvents: number;
      paymentEventKey: string;
      paymentEventActor: string;
      paymentEventRequiredPermission: string;
      paymentEventAmount: string;
      invoiceAmount: string;
      invoiceCurrency: string;
      invoiceStatus: string;
      invoiceCheckoutKey: string;
      paymentAmount: string;
      paymentStatus: string;
      paymentMethod: string;
      paymentActor: string;
      approvalActor: string;
      approvalActorAssignment: string;
      approvalAmount: string;
      approvalLimit: string;
      approvalKey: string;
      approvalStateBefore: string;
      approvalStateAfter: string;
      approvalDecisionId: string;
      finalizationActor: string;
      finalizationAmount: string;
      finalizationKey: string;
      finalizationStateBefore: string;
      finalizationStateAfter: string;
      finalizationDecisionId: string;
      accountabilityEvents: number;
      accountabilityEventTypes: string[];
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries
          WHERE request_id=$1 AND entry_type='PAYMENT') AS "walletPayments",
        (SELECT count(*)::int FROM public.budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND') AS "budgetFinalizations",
        (SELECT count(*)::int FROM public.invoices
          WHERE request_id=$1 AND direction='CUSTOMER') AS invoices,
        (SELECT count(*)::int FROM public.payments payment
          JOIN public.invoices invoice ON invoice.id=payment.invoice_id
          WHERE invoice.request_id=$1 AND payment.payment_status='PAID') AS payments,
        (SELECT count(*)::int FROM public.request_approval_decisions
          WHERE request_id=$1 AND action='APPROVE') AS "approvalDecisions",
        (SELECT count(*)::int FROM public.request_approval_decisions
          WHERE request_id=$1 AND action='FINALIZE') AS "finalizeDecisions",
        (SELECT count(*)::int FROM public.document_generation_jobs
          WHERE request_id=$1 AND document_type='FINAL_INVOICE') AS "documentJobs",
        (SELECT count(*)::int FROM public.delivery_jobs
          WHERE request_id=$1) AS "deliveryJobs",
        (SELECT available_balance::text FROM public.v_company_wallet_balances
          WHERE company_id=$2) AS balance,
        request.approval_state AS "requestState",
        request.approval_revision::int AS "requestRevision",
        wallet.amount_delta::text AS "walletAmount",
        wallet.currency AS "walletCurrency",
        wallet.reason AS "walletReason",
        wallet.idempotency_key AS "walletIdempotencyKey",
        wallet.actor_user_id::text AS "walletActorUserId",
        wallet.actor_role_assignment_id::text AS "walletActorAssignmentId",
        budget.amount::text AS "budgetAmount",
        budget.available_delta::text AS "budgetAvailableDelta",
        budget.reserved_delta::text AS "budgetReservedDelta",
        budget.spent_delta::text AS "budgetSpentDelta",
        budget.reason_code AS "budgetReasonCode",
        budget.idempotency_key AS "budgetIdempotencyKey",
        reservation.status AS "reservationStatus",
        reservation.reserved_amount::text AS "reservedAmount",
        reservation.remaining_reserved::text AS "remainingReserved",
        reservation.spent_amount::text AS "reservationSpent",
        (SELECT count(*)::int FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id) AS "approveCommands",
        (SELECT count(*)::int FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id AND command.result->>'status'='SUCCESS')
          AS "successfulCommands",
        (SELECT count(*)::int FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id
            AND command.result->>'status'='ALREADY_PROCESSED')
          AS "alreadyProcessedCommands",
        (SELECT count(DISTINCT command.command_id)::int
          FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id) AS "distinctCommands",
        (SELECT min(char_length(command.payload_hash))::int
          FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id) AS "commandPayloadHashMin",
        (SELECT max(char_length(command.payload_hash))::int
          FROM public.approve_and_pay_commands command
          WHERE command.request_id=request.id) AS "commandPayloadHashMax",
        (SELECT count(*)::int FROM public.workflow_events event
          WHERE event.company_id=request.company_id AND event.request_id=request.id
            AND event.event_key='wallet.payment.recorded') AS "paymentEvents",
        payment_event.event_key AS "paymentEventKey",
        payment_event.actor_user_id::text AS "paymentEventActor",
        payment_event.metadata->>'requiredPermission' AS "paymentEventRequiredPermission",
        payment_event.metadata->>'amount' AS "paymentEventAmount",
        invoice.amount::text AS "invoiceAmount",
        invoice.currency AS "invoiceCurrency",
        invoice.lifecycle_status AS "invoiceStatus",
        invoice.checkout_idempotency_key AS "invoiceCheckoutKey",
        payment.amount::text AS "paymentAmount",
        payment.payment_status AS "paymentStatus",
        payment.method AS "paymentMethod",
        payment.recorded_by::text AS "paymentActor",
        approval_decision.actor_user_id::text AS "approvalActor",
        approval_decision.actor_role_assignment_id::text AS "approvalActorAssignment",
        approval_decision.amount::text AS "approvalAmount",
        approval_decision.approval_limit::text AS "approvalLimit",
        approval_decision.idempotency_key AS "approvalKey",
        approval_decision.state_before AS "approvalStateBefore",
        approval_decision.state_after AS "approvalStateAfter",
        approval_decision.id::text AS "approvalDecisionId",
        finalization.actor_user_id::text AS "finalizationActor",
        finalization.amount::text AS "finalizationAmount",
        finalization.idempotency_key AS "finalizationKey",
        finalization.state_before AS "finalizationStateBefore",
        finalization.state_after AS "finalizationStateAfter",
        finalization.id::text AS "finalizationDecisionId",
        (SELECT count(*)::int FROM public.payment_accountability_events event
          WHERE event.request_id=request.id) AS "accountabilityEvents",
        (SELECT array_agg(event.event_type ORDER BY event.event_type)
          FROM public.payment_accountability_events event
          WHERE event.request_id=request.id) AS "accountabilityEventTypes"
      FROM public.requests request
      JOIN public.company_wallet_ledger_entries wallet
        ON wallet.request_id=request.id AND wallet.entry_type='PAYMENT'
      JOIN public.budget_ledger_entries budget
        ON budget.request_id=request.id AND budget.entry_type='FINAL_SPEND'
      JOIN public.budget_reservations reservation
        ON reservation.request_id=request.id
      JOIN public.invoices invoice
        ON invoice.request_id=request.id AND invoice.direction='CUSTOMER'
      JOIN public.payments payment
        ON payment.invoice_id=invoice.id AND payment.payment_status='PAID'
      JOIN public.request_approval_decisions approval_decision
        ON approval_decision.request_id=request.id AND approval_decision.action='APPROVE'
      JOIN public.request_approval_decisions finalization
        ON finalization.request_id=request.id AND finalization.action='FINALIZE'
      JOIN public.workflow_events payment_event
        ON payment_event.company_id=request.company_id
       AND payment_event.request_id=request.id
       AND payment_event.event_key='wallet.payment.recorded'
      WHERE request.id=$1
    `, [request.requestId,financeCompanyId]);
    expect(financialEvidence.rows[0]).toEqual({
      walletPayments: 1,budgetFinalizations: 1,invoices: 1,payments: 1,
      approvalDecisions: 1,finalizeDecisions: 1,documentJobs: 1,deliveryJobs: 1,
      balance: "4000.00",
      requestState: "AWAITING_FULFILMENT",
      requestRevision: 3,
      walletAmount: "-1000.00",
      walletCurrency: "MYR",
      walletReason: "Concurrent authorized Approve and Pay",
      walletIdempotencyKey: `approve-pay:${commandIds[winningIndex]}:wallet`,
      walletActorUserId: approvers[winningIndex]!.userId,
      walletActorAssignmentId: approvers[winningIndex]!.assignmentId,
      budgetAmount: "1000.00",
      budgetAvailableDelta: "0.00",
      budgetReservedDelta: "-1000.00",
      budgetSpentDelta: "1000.00",
      budgetReasonCode: "REQUEST_FINAL_SPEND",
      budgetIdempotencyKey: `approve-pay:${commandIds[winningIndex]}:budget-spend`,
      reservationStatus: "SPENT",
      reservedAmount: "1000.00",
      remainingReserved: "0.00",
      reservationSpent: "1000.00",
      approveCommands: 10,
      successfulCommands: 1,
      alreadyProcessedCommands: 9,
      distinctCommands: 10,
      commandPayloadHashMin: 64,
      commandPayloadHashMax: 64,
      paymentEvents: 1,
      paymentEventKey: "wallet.payment.recorded",
      paymentEventActor: approvers[winningIndex]!.userId,
      paymentEventRequiredPermission: "finance.invoice.view",
      paymentEventAmount: "1000.00",
      invoiceAmount: "1000.00",
      invoiceCurrency: "MYR",
      invoiceStatus: "FINALIZED",
      invoiceCheckoutKey: `approve-pay:${commandIds[winningIndex]}:payment`,
      paymentAmount: "1000.00",
      paymentStatus: "PAID",
      paymentMethod: "OFFLINE",
      paymentActor: approvers[winningIndex]!.userId,
      approvalActor: approvers[winningIndex]!.userId,
      approvalActorAssignment: approvers[winningIndex]!.assignmentId,
      approvalAmount: "1000.00",
      approvalLimit: "50000.00",
      approvalKey: `approve-pay:${commandIds[winningIndex]}:approval`,
      approvalStateBefore: "PENDING_COMPANY",
      approvalStateAfter: "APPROVED",
      approvalDecisionId: winningOutcome.approvalDecisionId,
      finalizationActor: approvers[winningIndex]!.userId,
      finalizationAmount: "1000.00",
      finalizationKey: `approve-pay:${commandIds[winningIndex]}:budget`,
      finalizationStateBefore: "APPROVED",
      finalizationStateAfter: "AWAITING_FULFILMENT",
      finalizationDecisionId: winningOutcome.budgetDecisionId,
      accountabilityEvents: 4,
      accountabilityEventTypes: [
        "CHECKOUT_COMPLETED","INVOICE_DOCUMENT_QUEUED",
        "INVOICE_FINALIZED","PAYMENT_RECORDED",
      ],
    });

    const job = await admin.query<{
      id: string; latitude: string; longitude: string;
    }>(`
      SELECT id::text,destination_latitude::text AS latitude,
        destination_longitude::text AS longitude
      FROM public.delivery_jobs WHERE request_id=$1
    `, [request.requestId]);
    expect(job.rows[0]).toMatchObject({ latitude: "3.139000",longitude: "101.686900" });
    await app.query(`
      SELECT public.axora_save_branch_delivery_location(
        $1,$2,$3,'Updated canonical destination',3.150000,101.700000,
        'Use the new loading entrance','Move the canonical branch destination',
        $4,now()
      )
    `, [companyAdmin.userId,companyAdmin.assignmentId,financeBranchId,randomUUID()]);
    const immutableDestination = await admin.query<{
      latitude: string; longitude: string; label: string;
    }>(`
      SELECT destination_latitude::text AS latitude,
        destination_longitude::text AS longitude,
        delivery_address_snapshot AS label
      FROM public.delivery_jobs WHERE id=$1
    `, [job.rows[0]!.id]);
    expect(immutableDestination.rows[0]).toEqual({
      latitude: "3.139000",longitude: "101.686900",
      label: "Original canonical destination",
    });
    await admin.query(`
      UPDATE public.delivery_jobs
      SET acceptance_deadline=now()-interval '1 day'
      WHERE id=$1
    `, [job.rows[0]!.id]);
    const claimCommands = drivers.map(() => randomUUID());
    const claims = await Promise.allSettled(drivers.map((driver,index) => (
      withAppClient((client) => client.query(`
        SELECT public.axora_claim_available_delivery_job($1,$2,$3,$4,now())
      `, [driver.userId,driver.assignmentId,job.rows[0]!.id,claimCommands[index]]))
    )));
    expect(claims.filter((claim) => claim.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((claim) => claim.status === "rejected")).toHaveLength(9);
    for (const rejected of claims.filter((claim) => claim.status === "rejected")) {
      expect(rejected.status === "rejected" ? String(rejected.reason) : "")
        .toMatch(/already claimed/i);
    }
    const assignmentEvidence = await admin.query<{
      assignments: number;
      status: string;
      assignmentId: string;
      driverUserId: string;
      driverRoleAssignmentId: string;
      workflowVersion: number;
      assignmentStatus: string;
      assignmentCommandId: string;
      assignedBy: string;
      totalAssignments: number;
      fulfilmentAssignments: number;
      fulfilmentActor: string;
      freshAcceptanceWindow: boolean;
      matchingAcceptanceDeadlines: boolean;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.delivery_job_assignments
          WHERE delivery_job_id=$1 AND ended_at IS NULL) AS assignments,
        job.status,
        assignment.id::text AS "assignmentId",
        assignment.driver_user_id::text AS "driverUserId",
        assignment.driver_role_assignment_id::text AS "driverRoleAssignmentId",
        job.workflow_version::int AS "workflowVersion",
        assignment.status AS "assignmentStatus",
        assignment.command_id::text AS "assignmentCommandId",
        assignment.assigned_by::text AS "assignedBy",
        (SELECT count(*)::int FROM public.delivery_job_assignments item
          WHERE item.delivery_job_id=job.id) AS "totalAssignments",
        (SELECT count(*)::int FROM public.fulfilment_purchase_assignments item
          WHERE item.request_id=job.request_id AND item.status='ASSIGNED')
          AS "fulfilmentAssignments",
        (SELECT item.assigned_user_id::text
          FROM public.fulfilment_purchase_assignments item
          WHERE item.request_id=job.request_id AND item.status='ASSIGNED'
          ORDER BY item.assigned_at DESC LIMIT 1) AS "fulfilmentActor",
        assignment.acceptance_deadline>=assignment.assigned_at+interval '119 minutes'
          AS "freshAcceptanceWindow",
        assignment.acceptance_deadline IS NOT DISTINCT FROM job.acceptance_deadline
          AS "matchingAcceptanceDeadlines"
      FROM public.delivery_jobs job
      JOIN public.delivery_job_assignments assignment
        ON assignment.delivery_job_id=job.id
       AND assignment.ended_at IS NULL
      WHERE job.id=$1
    `, [job.rows[0]!.id]);
    expect(assignmentEvidence.rows[0]).toMatchObject({
      assignments: 1,
      status: "ASSIGNED",
      assignmentStatus: "ASSIGNED",
      workflowVersion: 2,
      totalAssignments: 1,
      fulfilmentAssignments: 1,
      freshAcceptanceWindow: true,
      matchingAcceptanceDeadlines: true,
    });

    const activeAssignment = assignmentEvidence.rows[0]!;
    const winningDriver = drivers.find((driver) => (
      driver.userId === activeAssignment.driverUserId
      && driver.assignmentId === activeAssignment.driverRoleAssignmentId
    ));
    if (!winningDriver) throw new Error("The winning delivery agent was not resolved.");
    const winningClaimIndex = drivers.findIndex((driver) => (
      driver.userId === winningDriver.userId
    ));
    const winningClaimCommand = claimCommands[winningClaimIndex]!;
    expect(activeAssignment).toMatchObject({
      assignmentCommandId: winningClaimCommand,
      assignedBy: winningDriver.userId,
      fulfilmentActor: winningDriver.userId,
    });
    const trackingDestination = await admin.query<{
      latitude: string; longitude: string; status: string;
    }>(`
      SELECT destination_latitude::text AS latitude,
        destination_longitude::text AS longitude,status
      FROM public.delivery_tracking_sessions WHERE assignment_id=$1
    `, [activeAssignment.assignmentId]);
    expect(trackingDestination.rows[0]).toEqual({
      latitude: "3.139000",longitude: "101.686900",status: "NOT_STARTED",
    });
    const claimReplays = await Promise.all(Array.from({ length: 10 }, () => (
      withAppClient((client) => client.query<{
        payload: { assignmentId: string; jobId: string; status: string; created: boolean };
      }>(`
        SELECT public.axora_claim_available_delivery_job($1,$2,$3,$4,now()) AS payload
      `, [
        winningDriver.userId,winningDriver.assignmentId,
        job.rows[0]!.id,winningClaimCommand,
      ]))
    )));
    for (const replay of claimReplays) {
      expect(replay.rows[0]!.payload).toEqual({
        assignmentId: activeAssignment.assignmentId,
        jobId: job.rows[0]!.id,
        status: "ASSIGNED",
        created: false,
      });
    }
    const reconciledClaim = await app.query<{
      payload: { assignmentId: string; jobId: string; status: string; created: boolean } | null;
    }>(`
      SELECT public.axora_driver_claim_result($1,$2,$3,$4,now()) AS payload
    `, [
      winningDriver.userId,winningDriver.assignmentId,
      job.rows[0]!.id,winningClaimCommand,
    ]);
    expect(reconciledClaim.rows[0]!.payload).toEqual({
      assignmentId: activeAssignment.assignmentId,
      jobId: job.rows[0]!.id,
      status: "ASSIGNED",
      created: false,
    });
    const foreignClaimResult = await app.query<{ payload: unknown | null }>(`
      SELECT public.axora_driver_claim_result($1,$2,$3,$4,now()) AS payload
    `, [
      drivers.find((driver) => driver.userId !== winningDriver.userId)!.userId,
      drivers.find((driver) => driver.userId !== winningDriver.userId)!.assignmentId,
      job.rows[0]!.id,winningClaimCommand,
    ]);
    expect(foreignClaimResult.rows[0]!.payload).toBeNull();
    await expect(withAppClient((client) => client.query(`
      SELECT public.axora_claim_available_delivery_job($1,$2,$3,$4,now())
    `, [
      winningDriver.userId,winningDriver.assignmentId,randomUUID(),winningClaimCommand,
    ]))).rejects.toMatchObject({
      code: "P7302",
      message: "AXORA_DELIVERY_CLAIM_COMMAND_CONFLICT",
    });
    await expect(withAppClient((client) => client.query(`
      SELECT public.axora_claim_available_delivery_job($1,$2,$3,$4,now())
    `, [
      winningDriver.userId,randomUUID(),job.rows[0]!.id,winningClaimCommand,
    ]))).rejects.toMatchObject({
      code: "P7302",
      message: "AXORA_DELIVERY_CLAIM_COMMAND_CONFLICT",
    });
    const losingDriver = drivers.find((driver) => driver.userId !== winningDriver.userId)!;
    const deliveryDefaults = await admin.query<{ permissionCode: string }>(`
      SELECT permission.permission_code AS "permissionCode"
      FROM public.role_permissions role_permission
      JOIN public.roles role ON role.id=role_permission.role_id
      JOIN public.permissions permission ON permission.id=role_permission.permission_id
      WHERE role.role_key='DELIVERY_GUY'
      ORDER BY permission.permission_code
    `);
    expect(deliveryDefaults.rows.map((row) => row.permissionCode)).toEqual([
      "delivery.accept","delivery.assignment.update","delivery.claim",
      "delivery.complete","delivery.portal.view","delivery.receipt.upload",
      "delivery.shop","delivery.track",
    ]);
    await admin.query(`
      INSERT INTO public.user_permission_overrides(
        user_id,permission_id,effect,scope_type,starts_at,active,reason,changed_by
      ) SELECT $1,permission.id,'DENY','DELIVERY',now()-interval '1 minute',true,
        'Prove explicit delivery restriction remains authoritative',$2
      FROM public.permissions permission
      WHERE permission.permission_code='delivery.complete'
    `, [losingDriver.userId,owner.userId]);
    const deniedDeliveryPermission = await admin.query<{ allowed: boolean }>(`
      SELECT public.axora_snapshot_has_permission(
        public.axora_live_authorization_snapshot($1,$2,now()),
        'delivery.complete','DELIVERY',NULL,NULL,NULL,NULL
      ) AS allowed
    `, [losingDriver.userId,losingDriver.assignmentId]);
    expect(deniedDeliveryPermission.rows[0]!.allowed).toBe(false);
    const deliveryPreflight = await admin.query<{
      actorActive: boolean;
      assignmentActive: boolean;
      assignmentActorMatches: boolean;
      assignmentRoleMatches: boolean;
      jobVersionMatches: boolean;
      jobStatus: string;
      canAccept: boolean;
    }>(`
      SELECT
        snapshot.value IS NOT NULL AS "actorActive",
        assignment.status IN ('ASSIGNED','ACCEPTED') AND assignment.ended_at IS NULL
          AS "assignmentActive",
        assignment.driver_user_id=$1 AS "assignmentActorMatches",
        assignment.driver_role_assignment_id=$2 AS "assignmentRoleMatches",
        job.workflow_version=$5 AS "jobVersionMatches",
        job.status AS "jobStatus",
        public.axora_snapshot_has_permission(
          snapshot.value,'delivery.accept','DELIVERY',NULL,NULL,NULL,NULL
        ) AS "canAccept"
      FROM public.delivery_jobs job
      JOIN public.delivery_job_assignments assignment ON assignment.id=$4
      CROSS JOIN LATERAL (
        SELECT public.axora_live_authorization_snapshot($1,$2,now()) AS value
      ) snapshot
      WHERE job.id=$3 AND assignment.delivery_job_id=job.id
    `, [
      winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,activeAssignment.workflowVersion,
    ]);
    expect(deliveryPreflight.rows[0]).toEqual({
      actorActive: true,
      assignmentActive: true,
      assignmentActorMatches: true,
      assignmentRoleMatches: true,
      jobVersionMatches: true,
      jobStatus: "ASSIGNED",
      canAccept: true,
    });
    const deviceId = randomUUID();
    let workflowVersion = activeAssignment.workflowVersion;
    let deviceSequence = 1;
    const recordEvent = async (
      eventType: string,
      metadata: Record<string, unknown> = {},
      commandId = randomUUID(),
    ) => {
      const recordedAt = new Date();
      const result = await app!.query<{
        payload: { eventId: string; status: string; workflowVersion: number };
      }>(`
        SELECT public.axora_record_delivery_event(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
        ) AS payload
      `, [
        winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
        activeAssignment.assignmentId,workflowVersion,commandId,deviceId,
        deviceSequence,eventType,recordedAt,JSON.stringify(metadata),recordedAt,
      ]);
      deviceSequence += 1;
      workflowVersion = result.rows[0]!.payload.workflowVersion;
      return { ...result.rows[0]!.payload,commandId,recordedAt };
    };

    await expect(withAppClient((client) => client.query(`
      SELECT public.axora_record_delivery_event(
        $1,$2,$3,$4,$5,$6,$7,1,'ACCEPTED',now(),'{}'::jsonb,now()
      )
    `, [
      losingDriver.userId,losingDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,workflowVersion,randomUUID(),randomUUID(),
    ]))).rejects.toThrow(/delivery (event|workflow) is unavailable/i);

    expect((await recordEvent("ACCEPTED")).status).toBe("ACCEPTED");
    expect((await recordEvent("SHOPPING_STARTED")).status).toBe("SHOPPING");
    const deliveryLine = await admin.query<{ id: string }>(`
      SELECT id::text FROM public.delivery_job_lines
      WHERE delivery_job_id=$1 ORDER BY created_at,id LIMIT 1
    `, [job.rows[0]!.id]);
    const invalidAcquisition = async (input: {
      lines: unknown;
      actor?: Actor;
      assignmentId?: string;
      deliveryJobId?: string;
      expectedVersion?: number;
    }) => {
      const attemptedBy = input.actor ?? winningDriver;
      const capturedAt = new Date();
      return withAppClient((client) => client.query(`
        SELECT public.axora_register_delivery_acquisition(
          $1,$2,$3,$4,$5,$6,$7,'invalid-receipt.pdf','application/pdf',$8,$9,
          1024,$10,'Rejected controlled acquisition fixture',$11::jsonb,$10
        )
      `, [
        attemptedBy.userId,attemptedBy.assignmentId,
        input.deliveryJobId ?? job.rows[0]!.id,
        input.assignmentId ?? activeAssignment.assignmentId,
        input.expectedVersion ?? workflowVersion,randomUUID(),randomUUID(),
        `delivery-receipts/${attemptedBy.userId}/${job.rows[0]!.id}/${randomUUID()}.pdf`,
        "b".repeat(64),capturedAt,JSON.stringify(input.lines),
      ]));
    };
    const rejectedAcquisitions = [
      invalidAcquisition({ lines: [] }),
      invalidAcquisition({ lines: [{
        deliveryJobLineId: randomUUID(),resolution: "ACQUIRED",
        actualInternalUnitCost: "700.000000",
      }] }),
      invalidAcquisition({ lines: [0,1].map(() => ({
        deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
        actualInternalUnitCost: "700.000000",
      })) }),
      invalidAcquisition({ lines: [{
        deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
        actualInternalUnitCost: "-1.000000",
      }] }),
      invalidAcquisition({ lines: [{
        deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
        actualInternalUnitCost: "not-a-decimal",
      }] }),
      invalidAcquisition({ lines: [{
        deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "UNAVAILABLE",
        reason: "x",
      }] }),
      invalidAcquisition({
        lines: [{
          deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
          actualInternalUnitCost: "700.000000",
        }],
        assignmentId: randomUUID(),
      }),
      invalidAcquisition({
        lines: [{
          deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
          actualInternalUnitCost: "700.000000",
        }],
        deliveryJobId: randomUUID(),
      }),
      invalidAcquisition({
        lines: [{
          deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
          actualInternalUnitCost: "700.000000",
        }],
        expectedVersion: workflowVersion - 1,
      }),
      invalidAcquisition({
        actor: losingDriver,
        lines: [{
          deliveryJobLineId: deliveryLine.rows[0]!.id,resolution: "ACQUIRED",
          actualInternalUnitCost: "700.000000",
        }],
      }),
    ];
    const rejectedResults = await Promise.allSettled(rejectedAcquisitions);
    expect(rejectedResults.every((result) => result.status === "rejected")).toBe(true);
    const rejectedPersistence = await admin.query<{ submissions: number; lines: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.delivery_acquisition_submissions
          WHERE delivery_job_id=$1) AS submissions,
        (SELECT count(*)::int FROM public.delivery_acquisition_lines
          WHERE delivery_job_id=$1) AS lines
    `, [job.rows[0]!.id]);
    expect(rejectedPersistence.rows[0]).toEqual({ submissions: 0,lines: 0 });
    const unavailableCommand = randomUUID();
    const unavailableEventCommand = randomUUID();
    const unavailableCapturedAt = new Date();
    const unavailablePath = `delivery-receipts/${winningDriver.userId}/${job.rows[0]!.id}/unavailable.pdf`;
    const unavailable = await app.query<{
      payload: { submissionId: string; created: boolean; unavailableLines: number };
    }>(`
      SELECT public.axora_register_delivery_acquisition(
        $1,$2,$3,$4,$5,$6,$7,'unavailable-receipt.pdf','application/pdf',$8,$9,
        1024,$10,'Item unavailable at controlled source',$11::jsonb,$10
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,workflowVersion,unavailableCommand,
      unavailableEventCommand,unavailablePath,"d".repeat(64),unavailableCapturedAt,
      JSON.stringify([{
        deliveryJobLineId: deliveryLine.rows[0]!.id,
        resolution: "UNAVAILABLE",
        reason: "Item unavailable at controlled source",
      }])]);
    expect(unavailable.rows[0]!.payload).toMatchObject({
      created: true,unavailableLines: 1,
    });
    expect((await recordEvent("ISSUE_REPORTED", {
      note: "Item unavailable at controlled source",
      issueCode: "MISSING_ITEMS",
    }, unavailableEventCommand)).status).toBe("SHOPPING");
    const acquisitionCommand = randomUUID();
    const acquisitionEventCommand = randomUUID();
    const acquisitionCapturedAt = new Date();
    const acquisitionLines = JSON.stringify([{
      deliveryJobLineId: deliveryLine.rows[0]!.id,
      resolution: "ACQUIRED",
      actualInternalUnitCost: "700.000000",
    }]);
    const acquisitionPath = `delivery-receipts/${winningDriver.userId}/${job.rows[0]!.id}/native.pdf`;
    const acquisition = await app.query<{
      payload: { submissionId: string; created: boolean; unavailableLines: number };
    }>(`
      SELECT public.axora_register_delivery_acquisition(
        $1,$2,$3,$4,$5,$6,$7,'native-receipt.pdf','application/pdf',$8,$9,
        1024,$10,'Native paid-safe acquisition',$11::jsonb,$10
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,workflowVersion,acquisitionCommand,
      acquisitionEventCommand,acquisitionPath,"c".repeat(64),
      acquisitionCapturedAt,acquisitionLines]);
    expect(acquisition.rows[0]!.payload).toMatchObject({ created: true,unavailableLines: 0 });
    const acquisitionReplay = await app.query<{
      payload: { submissionId: string; created: boolean; storagePath: string };
    }>(`
      SELECT public.axora_register_delivery_acquisition(
        $1,$2,$3,$4,$5,$6,$7,'native-receipt.pdf','application/pdf',$8,$9,
        1024,$10,'Native paid-safe acquisition',$11::jsonb,$10
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,workflowVersion,acquisitionCommand,
      acquisitionEventCommand,acquisitionPath,"c".repeat(64),
      acquisitionCapturedAt,acquisitionLines]);
    expect(acquisitionReplay.rows[0]!.payload).toMatchObject({
      submissionId: acquisition.rows[0]!.payload.submissionId,
      created: false,storagePath: acquisitionPath,
    });
    expect((await recordEvent("ITEMS_ACQUIRED", {
      note: "Native paid-safe acquisition",
    }, acquisitionEventCommand)).status).toBe("ITEMS_ACQUIRED");
    expect((await recordEvent("OUT_FOR_DELIVERY")).status).toBe("OUT_FOR_DELIVERY");
    const arrived = await recordEvent("ARRIVED");
    expect(arrived.status).toBe("ARRIVED");

    await admin.query(`
      INSERT INTO public.branch_assignments(
        user_id,company_id,branch_id,status,is_primary,created_by
      ) VALUES ($1,$2,$3,'ACTIVE',true,$4)
      ON CONFLICT(user_id,branch_id) DO UPDATE SET status='ACTIVE'
    `, [companyAdmin.userId,financeCompanyId,financeBranchId,owner.userId]);
    const otpChallenge = await app.query<{
      payload: { challengeId: string };
    }>(`
      SELECT public.axora_create_delivery_otp(
        $1,$2,$3,$4,now()
      ) AS payload
    `, [companyAdmin.userId,companyAdmin.assignmentId,job.rows[0]!.id,
      "f".repeat(64)]);
    const otpCommand = randomUUID();
    const failedOtp = await app.query<{
      payload: { jobId: string; challengeId: string; verified: boolean };
    }>(`
      SELECT public.axora_verify_delivery_otp_command(
        $1,$2,$3,$4,$5,$6,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      otpChallenge.rows[0]!.payload.challengeId,"e".repeat(64),otpCommand]);
    expect(failedOtp.rows[0]!.payload.verified).toBe(false);
    const failedOtpReplay = await app.query<{
      payload: { jobId: string; challengeId: string; verified: boolean };
    }>(`
      SELECT public.axora_verify_delivery_otp_command(
        $1,$2,$3,$4,$5,$6,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      otpChallenge.rows[0]!.payload.challengeId,"e".repeat(64),otpCommand]);
    expect(failedOtpReplay.rows[0]!.payload).toEqual(failedOtp.rows[0]!.payload);
    const otpIntegrity = await admin.query<{
      attempts: number;
      commands: number;
    }>(`
      SELECT challenge.attempt_count AS attempts,
        (SELECT count(*)::int FROM public.delivery_workflow_commands command
          WHERE command.actor_user_id=$2 AND command.command_id=$3) AS commands
      FROM public.delivery_otp_challenges challenge
      WHERE challenge.id=$1
    `, [otpChallenge.rows[0]!.payload.challengeId,winningDriver.userId,otpCommand]);
    expect(otpIntegrity.rows[0]).toEqual({ attempts: 1,commands: 1 });
    const otpCommandResult = await app.query<{
      payload: { verified: boolean };
    }>(`
      SELECT public.axora_driver_delivery_command_result(
        $1,$2,$3,'OTP',$4,NULL,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      otpCommand]);
    expect(otpCommandResult.rows[0]!.payload.verified).toBe(false);

    const evidenceCommand = randomUUID();
    const evidenceCapturedAt = new Date();
    const evidence = await app.query<{
      payload: { evidenceId: string; created: boolean; storagePath: string };
    }>(`
      SELECT public.axora_register_delivery_evidence(
        $1,$2,$3,$4,$5,'PHOTO','native-proof.png','image/png',$6,$7,
        $8,NULL,NULL,NULL,1,1,NULL,'{}'::jsonb,$8
      ) AS payload
    `, [
      winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      arrived.eventId,evidenceCommand,
      `delivery-evidence/native/${job.rows[0]!.id}/proof.png`,"a".repeat(64),
      evidenceCapturedAt,
    ]);
    expect(evidence.rows[0]!.payload).toMatchObject({ created: true });
    const evidenceReplay = await app.query<{
      payload: { evidenceId: string; created: boolean; storagePath: string; version: number };
    }>(`
      SELECT public.axora_register_delivery_evidence(
        $1,$2,$3,$4,$5,'PHOTO','native-proof.png','image/png',$6,$7,
        $8,NULL,NULL,NULL,1,1,NULL,'{}'::jsonb,$8
      ) AS payload
    `, [
      winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      arrived.eventId,evidenceCommand,
      `delivery-evidence/native/${job.rows[0]!.id}/proof.png`,"a".repeat(64),
      evidenceCapturedAt,
    ]);
    expect(evidenceReplay.rows[0]!.payload).toEqual({
      evidenceId: evidence.rows[0]!.payload.evidenceId,
      version: 1,
      created: false,
      storagePath: `delivery-evidence/native/${job.rows[0]!.id}/proof.png`,
    });
    const eventCommandResult = await app.query<{
      payload: { eventId: string; status: string; workflowVersion: number };
    }>(`
      SELECT public.axora_driver_delivery_command_result(
        $1,$2,$3,'EVENT',$4,NULL,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      arrived.commandId]);
    expect(eventCommandResult.rows[0]!.payload).toMatchObject({
      eventId: arrived.eventId,status: "ARRIVED",workflowVersion,
    });
    const acquisitionCommandResult = await app.query<{
      payload: {
        registration: { submissionId: string; created: boolean; unavailableLines: number };
        event: { status: string; workflowVersion: number };
      };
    }>(`
      SELECT public.axora_driver_delivery_command_result(
        $1,$2,$3,'ACQUISITION',$4,$5,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      acquisitionCommand,acquisitionEventCommand]);
    expect(acquisitionCommandResult.rows[0]!.payload).toMatchObject({
      registration: {
        submissionId: acquisition.rows[0]!.payload.submissionId,
        created: false,
        unavailableLines: 0,
      },
      event: { status: "ITEMS_ACQUIRED" },
    });
    const evidenceCommandResult = await app.query<{
      payload: { evidenceId: string; version: number; validationStatus: string };
    }>(`
      SELECT public.axora_driver_delivery_command_result(
        $1,$2,$3,'EVIDENCE',$4,NULL,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      evidenceCommand]);
    expect(evidenceCommandResult.rows[0]!.payload).toEqual({
      evidenceId: evidence.rows[0]!.payload.evidenceId,
      version: 1,
      validationStatus: "ACCEPTED",
      created: false,
    });
    const foreignCommandResult = await app.query<{ payload: null }>(`
      SELECT public.axora_driver_delivery_command_result(
        $1,$2,$3,'EVIDENCE',$4,NULL,now()
      ) AS payload
    `, [losingDriver.userId,losingDriver.assignmentId,job.rows[0]!.id,
      evidenceCommand]);
    expect(foreignCommandResult.rows[0]!.payload).toBeNull();
    await expect(app.query(`
      SELECT public.axora_register_delivery_evidence(
        $1,$2,$3,$4,$5,'DELIVERY_NOTE','native-proof.pdf','application/pdf',$6,$7,
        now(),NULL,NULL,NULL,1,1,NULL,'{}'::jsonb,now()
      )
    `, [
      winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      arrived.eventId,evidenceCommand,
      `delivery-evidence/native/${job.rows[0]!.id}/proof.pdf`,"b".repeat(64),
    ])).rejects.toThrow(/delivery evidence command is unavailable/i);

    const evidenceReaders: Array<{ actor: Actor; allowed: boolean }> = [
      { actor: owner,allowed: true },
      { actor: managerA,allowed: true },
      { actor: managerB,allowed: false },
      { actor: companyAdmin,allowed: true },
      { actor: otherCompanyAdmin,allowed: false },
      { actor: requester,allowed: true },
      { actor: approvers[0]!,allowed: true },
      { actor: winningDriver,allowed: true },
      { actor: losingDriver,allowed: false },
    ];
    const evidenceVisibility = await Promise.all(evidenceReaders.map(({ actor }) => (
      withAppClient((client) => client.query<{
        evidence_id: string;
        file_name: string;
        content_type: string;
        storage_path: string;
        sha256: string;
        delivery_job_id: string;
        evidence_version: number;
      }>(`SELECT * FROM public.axora_delivery_evidence_file($1,$2,$3,now())`, [
        actor.userId,actor.assignmentId,evidence.rows[0]!.payload.evidenceId,
      ]))
    )));
    expect(evidenceVisibility.map((result) => result.rowCount)).toEqual(
      evidenceReaders.map(({ allowed }) => allowed ? 1 : 0),
    );
    for (const [index,result] of evidenceVisibility.entries()) {
      if (!evidenceReaders[index]!.allowed) {
        expect(result.rows).toEqual([]);
        continue;
      }
      expect(result.rows[0]).toEqual({
        evidence_id: evidence.rows[0]!.payload.evidenceId,
        file_name: "native-proof.png",
        content_type: "image/png",
        storage_path: `delivery-evidence/native/${job.rows[0]!.id}/proof.png`,
        sha256: "a".repeat(64),
        delivery_job_id: job.rows[0]!.id,
        evidence_version: 1,
      });
    }

    expect((await recordEvent("DELIVERED", {
      receiverName: "Native recipient",
      lineOutcomes: [{
        deliveryJobLineId: deliveryLine.rows[0]!.id,
        deliveredQuantity: 1,
        damagedQuantity: 0,
        missingQuantity: 0,
      }],
    })).status)
      .toBe("DELIVERED");
    const completionVersion = workflowVersion;
    const completionCommands = Array.from({ length: 10 }, () => randomUUID());
    const completionRecordedAt = new Date();
    const completionSequence = deviceSequence;
    const completionAttempts = await Promise.allSettled(completionCommands.map((command, index) => (
      withAppClient((client) => client.query<{
        payload: { eventId: string; status: string; workflowVersion: number };
      }>(`
        SELECT public.axora_record_delivery_event(
          $1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',$9,'{}'::jsonb,$9
        ) AS payload
      `, [winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
        activeAssignment.assignmentId,completionVersion,command,deviceId,
        completionSequence+index,completionRecordedAt]))
    )));
    const completedAttempts = completionAttempts.flatMap((attempt, index) => (
      attempt.status === "fulfilled"
        ? [{ command: completionCommands[index]!,sequence: completionSequence+index,
          payload: attempt.value.rows[0]!.payload }]
        : []
    ));
    expect(completedAttempts).toHaveLength(1);
    expect(completionAttempts.filter((attempt) => attempt.status === "rejected"))
      .toHaveLength(9);
    const completed = completedAttempts[0]!.payload;
    expect(completed.status).toBe("COMPLETED");
    workflowVersion = completed.workflowVersion;
    deviceSequence += 10;
    const completedReplay = await app.query<{
      payload: { eventId: string; status: string; workflowVersion: number };
    }>(`
      SELECT public.axora_record_delivery_event(
        $1,$2,$3,$4,$5,$6,$7,$8,'COMPLETED',$9,$10::jsonb,$9
      ) AS payload
    `, [
      winningDriver.userId,winningDriver.assignmentId,job.rows[0]!.id,
      activeAssignment.assignmentId,completionVersion,completedAttempts[0]!.command,deviceId,
      completedAttempts[0]!.sequence,completionRecordedAt,
      JSON.stringify({}),
    ]);
    expect(completedReplay.rows[0]!.payload).toMatchObject({
      eventId: completed.eventId,status: "COMPLETED",
    });
    const completionEvidence = await admin.query<{
      jobStatus: string;
      assignmentStatus: string;
      completionEvents: number;
      proofRows: number;
      activeAssignments: number;
      eventCount: number;
      eventTypes: string[];
      eventVersionsBefore: number[];
      eventVersionsAfter: number[];
      distinctEventCommands: number;
      evidenceActor: string;
      evidenceEvent: string;
      evidenceCommand: string;
      evidenceType: string;
      evidenceVersion: number;
      evidenceValidation: string;
      evidenceContentType: string;
      evidenceStoragePath: string;
      evidenceSha256: string;
      requestStatus: string;
      finalDocumentJobs: number;
      acquisitionRows: number;
      customerInvoiceAmount: string;
      internalCost: string;
      acquiredQuantity: string;
      expectedQuantity: string;
      trackingSessionsEnded: number;
    }>(`
      SELECT
        job.status AS "jobStatus",
        assignment.status AS "assignmentStatus",
        (SELECT count(*)::int FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id AND event.event_type='COMPLETED')
          AS "completionEvents",
        (SELECT count(*)::int FROM public.delivery_evidence proof
          WHERE proof.delivery_job_id=job.id AND proof.validation_status='ACCEPTED')
          AS "proofRows",
        (SELECT count(*)::int FROM public.delivery_job_assignments active
          WHERE active.delivery_job_id=job.id AND active.ended_at IS NULL)
          AS "activeAssignments",
        (SELECT count(*)::int FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id) AS "eventCount",
        (SELECT array_agg(event.event_type ORDER BY event.job_version_after)
          FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id) AS "eventTypes",
        (SELECT array_agg(event.job_version_before ORDER BY event.job_version_after)
          FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id) AS "eventVersionsBefore",
        (SELECT array_agg(event.job_version_after ORDER BY event.job_version_after)
          FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id) AS "eventVersionsAfter",
        (SELECT count(DISTINCT event.command_id)::int
          FROM public.delivery_job_events event
          WHERE event.delivery_job_id=job.id) AS "distinctEventCommands",
        proof.driver_user_id::text AS "evidenceActor",
        proof.delivery_job_event_id::text AS "evidenceEvent",
        proof.client_evidence_id::text AS "evidenceCommand",
        proof.evidence_type AS "evidenceType",
        proof.evidence_version::int AS "evidenceVersion",
        proof.validation_status AS "evidenceValidation",
        proof.content_type AS "evidenceContentType",
        proof.storage_path AS "evidenceStoragePath",
        proof.sha256 AS "evidenceSha256",
        request_status.value_key AS "requestStatus",
        (SELECT count(*)::int FROM public.document_generation_jobs document_job
          WHERE document_job.request_id=job.request_id
            AND document_job.document_type='FINAL_FULFILMENT_DELIVERY') AS "finalDocumentJobs",
        (SELECT count(*)::int FROM public.delivery_acquisition_submissions acquisition
          WHERE acquisition.delivery_job_id=job.id) AS "acquisitionRows",
        (SELECT invoice.amount::text FROM public.invoices invoice
          WHERE invoice.request_id=job.request_id AND invoice.lifecycle_status='FINALIZED'
          ORDER BY invoice.finalized_at DESC LIMIT 1) AS "customerInvoiceAmount",
        (SELECT acquisition_line.actual_internal_unit_cost::text
          FROM public.delivery_acquisition_lines acquisition_line
          WHERE acquisition_line.delivery_job_id=job.id
            AND acquisition_line.actual_internal_unit_cost IS NOT NULL
          ORDER BY acquisition_line.created_at DESC LIMIT 1) AS "internalCost",
        (SELECT acquisition_line.acquired_quantity::text
          FROM public.delivery_acquisition_lines acquisition_line
          WHERE acquisition_line.delivery_job_id=job.id
            AND acquisition_line.actual_internal_unit_cost IS NOT NULL
          ORDER BY acquisition_line.created_at DESC LIMIT 1) AS "acquiredQuantity",
        (SELECT acquisition_line.expected_quantity::text
          FROM public.delivery_acquisition_lines acquisition_line
          WHERE acquisition_line.delivery_job_id=job.id
            AND acquisition_line.actual_internal_unit_cost IS NOT NULL
          ORDER BY acquisition_line.created_at DESC LIMIT 1) AS "expectedQuantity",
        (SELECT count(*)::int FROM public.delivery_tracking_sessions session
          WHERE session.delivery_job_id=job.id AND session.status='ENDED') AS "trackingSessionsEnded"
      FROM public.delivery_jobs job
      JOIN public.delivery_job_assignments assignment
        ON assignment.id=$2
      JOIN public.delivery_evidence proof
        ON proof.delivery_job_id=job.id AND proof.validation_status='ACCEPTED'
      JOIN public.requests request ON request.id=job.request_id
      JOIN public.lookup_values request_status ON request_status.id=request.status_id
      WHERE job.id=$1
    `, [job.rows[0]!.id,activeAssignment.assignmentId]);
    expect(completionEvidence.rows[0]).toEqual({
      jobStatus: "COMPLETED",assignmentStatus: "COMPLETED",
      completionEvents: 1,proofRows: 1,activeAssignments: 0,
      eventCount: 8,
      eventTypes: [
        "ACCEPTED","SHOPPING_STARTED","ISSUE_REPORTED","ITEMS_ACQUIRED","OUT_FOR_DELIVERY",
        "ARRIVED","DELIVERED","COMPLETED",
      ],
      eventVersionsBefore: [2,3,4,5,6,7,8,9],
      eventVersionsAfter: [3,4,5,6,7,8,9,10],
      distinctEventCommands: 8,
      evidenceActor: winningDriver.userId,
      evidenceEvent: arrived.eventId,
      evidenceCommand,
      evidenceType: "PHOTO",
      evidenceVersion: 1,
      evidenceValidation: "ACCEPTED",
      evidenceContentType: "image/png",
      evidenceStoragePath: `delivery-evidence/native/${job.rows[0]!.id}/proof.png`,
      evidenceSha256: "a".repeat(64),
      requestStatus: "COMPLETED",
      finalDocumentJobs: 1,
      acquisitionRows: 2,
      customerInvoiceAmount: "1000.00",
      internalCost: "700.000000",
      acquiredQuantity: "1.000",
      expectedQuantity: "1.000",
      trackingSessionsEnded: 1,
    });
    const recentCompletion = await app.query<{
      payload: { jobs: Array<Record<string, unknown>> };
    }>(`
      SELECT public.axora_driver_recent_delivery_completion(
        $1,$2,now()
      ) AS payload
    `, [winningDriver.userId,winningDriver.assignmentId]);
    expect(recentCompletion.rows[0]!.payload.jobs).toHaveLength(1);
    expect(recentCompletion.rows[0]!.payload.jobs[0]).toMatchObject({
      id: job.rows[0]!.id,
      status: "COMPLETED",
      assignmentId: activeAssignment.assignmentId,
      proofSatisfied: true,
    });
    const recentCompletionJson = JSON.stringify(recentCompletion.rows[0]!.payload);
    expect(recentCompletionJson).not.toContain("Native recipient");
    expect(recentCompletionJson).not.toContain("actualInternalUnitCost");
    expect(recentCompletionJson).not.toContain("destinationLatitude");
    expect(recentCompletionJson).not.toContain("recipientIdentity");
    expect((await app.query<{ payload: { jobs: unknown[] } }>(`
      SELECT public.axora_driver_recent_delivery_completion(
        $1,$2,now()
      ) AS payload
    `, [losingDriver.userId,losingDriver.assignmentId])).rows[0]!.payload.jobs)
      .toEqual([]);
    const finalDocument = await admin.query<{ snapshot: Record<string, unknown> }>(`
      SELECT public.axora_build_final_delivery_document_snapshot($1,now()) AS snapshot
    `, [request.requestId]);
    const finalSnapshot = JSON.stringify(finalDocument.rows[0]!.snapshot);
    expect(finalSnapshot).toContain("Native recipient");
    expect(finalSnapshot).toContain('"documentType":"FINAL_FULFILMENT_DELIVERY"');
    expect(finalSnapshot).not.toContain("actualInternalUnitCost");
    expect(finalSnapshot).not.toContain(acquisitionPath);
    expect(finalSnapshot).not.toContain("700.000000");
    const deliveryNotifications = await admin.query<{
      eventKey: string; actorValid: boolean; otherDriverValid: boolean;
      actorNotifications: number; otherDriverNotifications: number;
      routeAuthorized: boolean;
    }>(`
      SELECT event.event_key AS "eventKey",
        public.axora_workflow_notification_recipient_is_valid(
          event.company_id,event.id,$2
        ) AS "actorValid",
        public.axora_workflow_notification_recipient_is_valid(
          event.company_id,event.id,$3
        ) AS "otherDriverValid",
        (SELECT count(*)::int FROM public.in_app_notifications notification
          WHERE notification.workflow_event_id=event.id
            AND notification.recipient_user_id=$2) AS "actorNotifications",
        (SELECT count(*)::int FROM public.in_app_notifications notification
          WHERE notification.workflow_event_id=event.id
            AND notification.recipient_user_id=$3) AS "otherDriverNotifications",
        public.axora_notification_route_is_authorized(
          public.axora_live_authorization_snapshot($2,$4,now()),$2,
          (SELECT notification.id FROM public.in_app_notifications notification
            WHERE notification.workflow_event_id=event.id
              AND notification.recipient_user_id=$2 LIMIT 1),now()
        ) AS "routeAuthorized"
      FROM public.workflow_events event
      WHERE event.aggregate_type='delivery-job' AND event.aggregate_id=$1
        AND event.event_key IN (
          'delivery.accepted','delivery.out_for_delivery','delivery.completed'
        )
      ORDER BY event.event_version
    `, [
      job.rows[0]!.id,winningDriver.userId,losingDriver.userId,
      winningDriver.assignmentId,
    ]);
    expect(deliveryNotifications.rows).toEqual([
      {
        eventKey: "delivery.accepted",actorValid: true,otherDriverValid: false,
        actorNotifications: 1,otherDriverNotifications: 0,routeAuthorized: true,
      },
      {
        eventKey: "delivery.out_for_delivery",actorValid: true,otherDriverValid: false,
        actorNotifications: 1,otherDriverNotifications: 0,routeAuthorized: true,
      },
      {
        eventKey: "delivery.completed",actorValid: true,otherDriverValid: false,
        actorNotifications: 1,otherDriverNotifications: 0,routeAuthorized: true,
      },
    ]);

    const locationRaceRequest = await createRequest("250.00","LOCATION-RACE");
    expect(locationRaceRequest.budgetAccountId).toBe(request.budgetAccountId);
    expect(locationRaceRequest.budgetPeriodId).toBe(request.budgetPeriodId);
    const locationRaceCommand = randomUUID();
    const locationPayCommand = randomUUID();
    const locationClient = await connectedAppClient();
    const locationPayClient = await connectedAppClient();
    let locationTransactionOpen = false;
    let locationPaymentPromise: Promise<{
      status: string;
      requestId: string;
      invoiceId: string;
      amount: string;
      currency: string;
      created: boolean;
    }> | undefined;
    try {
      await locationClient.query("BEGIN");
      locationTransactionOpen = true;
      await locationClient.query("SET LOCAL statement_timeout='20s'");
      const locationBackend = await locationClient.query<{ pid: number }>(
        "SELECT pg_backend_pid()::int AS pid",
      );
      const paymentBackend = await locationPayClient.query<{ pid: number }>(
        "SELECT pg_backend_pid()::int AS pid",
      );
      await locationPayClient.query("SET statement_timeout='20s'");
      await locationClient.query(`
        SELECT 1 FROM public.branches WHERE id=$1 FOR UPDATE
      `, [financeBranchId]);
      locationPaymentPromise = locationPayClient.query<{
        payload: {
          status: string;
          requestId: string;
          invoiceId: string;
          amount: string;
          currency: string;
          created: boolean;
        };
      }>(`
        SELECT public.axora_approve_and_pay(
          $1,$2,$3,$4,'Serialize against branch location update',$5,now()
        ) AS payload
      `, [
        approvers[1]!.userId,approvers[1]!.assignmentId,
        locationRaceRequest.requestId,locationRaceRequest.revision,locationPayCommand,
      ]).then((result) => result.rows[0]!.payload);
      await waitUntilBlockedBy(
        paymentBackend.rows[0]!.pid,
        locationBackend.rows[0]!.pid,
      );
      const savedLocation = await locationClient.query<{
        payload: {
          commandId: string;
          location: { latitude: string; longitude: string; addressLabel: string };
        };
      }>(`
        SELECT public.axora_save_branch_delivery_location(
          $1,$2,$3,'Race-serialized destination',$4::numeric,$5::numeric,
          'Use the race-serialized entrance','Deterministic location/payment race',
          $6,now()
        ) AS payload
      `, [
        companyAdmin.userId,companyAdmin.assignmentId,financeBranchId,
        "3.160000","101.710000",locationRaceCommand,
      ]);
      expect(savedLocation.rows[0]!.payload).toMatchObject({
        commandId: locationRaceCommand,
        location: {
          latitude: "3.160000",
          longitude: "101.710000",
          addressLabel: "Race-serialized destination",
        },
      });
      await locationClient.query("COMMIT");
      locationTransactionOpen = false;
      expect(await locationPaymentPromise).toMatchObject({
        status: "SUCCESS",
        requestId: locationRaceRequest.requestId,
        amount: "250.00",
        currency: "MYR",
        created: true,
      });
    } finally {
      if (locationTransactionOpen) {
        await locationClient.query("ROLLBACK").catch(() => undefined);
      }
      if (locationPaymentPromise) {
        await locationPaymentPromise.catch(() => undefined);
      }
      await Promise.all([locationClient.end(),locationPayClient.end()]);
    }
    const locationRaceEvidence = await admin.query<{
      locationCommands: number;
      commandHashLength: number;
      address: string;
      latitude: string;
      longitude: string;
      instructions: string;
      deliveryJobs: number;
      walletPayments: number;
      approveCommands: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.branch_delivery_location_commands command
          WHERE command.actor_user_id=$1 AND command.command_id=$2)
          AS "locationCommands",
        (SELECT char_length(command.payload_hash)::int
          FROM public.branch_delivery_location_commands command
          WHERE command.actor_user_id=$1 AND command.command_id=$2)
          AS "commandHashLength",
        job.delivery_address_snapshot AS address,
        job.destination_latitude::text AS latitude,
        job.destination_longitude::text AS longitude,
        job.instructions,
        (SELECT count(*)::int FROM public.delivery_jobs item
          WHERE item.request_id=$3) AS "deliveryJobs",
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries entry
          WHERE entry.request_id=$3 AND entry.entry_type='PAYMENT') AS "walletPayments",
        (SELECT count(*)::int FROM public.approve_and_pay_commands command
          WHERE command.request_id=$3) AS "approveCommands"
      FROM public.delivery_jobs job WHERE job.request_id=$3
    `, [companyAdmin.userId,locationRaceCommand,locationRaceRequest.requestId]);
    expect(locationRaceEvidence.rows[0]).toEqual({
      locationCommands: 1,
      commandHashLength: 64,
      address: "Race-serialized destination",
      latitude: "3.160000",
      longitude: "101.710000",
      instructions: "Use the race-serialized entrance",
      deliveryJobs: 1,
      walletPayments: 1,
      approveCommands: 1,
    });

    const normalApprovalRequest = await createRequest("200.00","NORMAL-LOCK-ORDER");
    const concurrentPaymentRequest = await createRequest("300.00","PAY-LOCK-ORDER");
    expect(normalApprovalRequest.budgetAccountId).toBe(request.budgetAccountId);
    expect(normalApprovalRequest.budgetPeriodId).toBe(request.budgetPeriodId);
    expect(concurrentPaymentRequest.budgetAccountId).toBe(request.budgetAccountId);
    expect(concurrentPaymentRequest.budgetPeriodId).toBe(request.budgetPeriodId);
    const normalDecisionKey = `normal-lock-${randomUUID()}`;
    const concurrentPayCommand = randomUUID();
    const normalClient = await connectedAppClient();
    const concurrentPayClient = await connectedAppClient();
    let normalTransactionOpen = false;
    let paymentTransactionOpen = false;
    try {
      await Promise.all([normalClient.query("BEGIN"),concurrentPayClient.query("BEGIN")]);
      normalTransactionOpen = true;
      paymentTransactionOpen = true;
      await Promise.all([
        normalClient.query("SET LOCAL statement_timeout='20s'"),
        concurrentPayClient.query("SET LOCAL statement_timeout='20s'"),
      ]);
      const [normalBackend,paymentBackend] = await Promise.all([
        normalClient.query<{ pid: number }>("SELECT pg_backend_pid()::int AS pid"),
        concurrentPayClient.query<{ pid: number }>("SELECT pg_backend_pid()::int AS pid"),
      ]);
      await Promise.all([
        normalClient.query("SELECT 1 FROM public.requests WHERE id=$1 FOR UPDATE", [
          normalApprovalRequest.requestId,
        ]),
        concurrentPayClient.query("SELECT 1 FROM public.requests WHERE id=$1 FOR UPDATE", [
          concurrentPaymentRequest.requestId,
        ]),
      ]);
      const normalDecisionPromise = normalClient.query<{
        payload: { state: string; action: string; amount: string; requestId: string };
      }>(`
        SELECT public.axora_decide_request_approval(
          $1,$2,$3,$4,'APPROVE','',NULL,
          'Concurrent normal approval lock order',$5,now()
        ) AS payload
      `, [
        approvers[2]!.userId,approvers[2]!.assignmentId,
        normalApprovalRequest.requestId,normalApprovalRequest.revision,normalDecisionKey,
      ]).then((result) => ({ side: "normal" as const,payload: result.rows[0]!.payload }));
      const concurrentPaymentPromise = concurrentPayClient.query<{
        payload: {
          status: string;
          amount: string;
          requestId: string;
          created: boolean;
        };
      }>(`
        SELECT public.axora_approve_and_pay(
          $1,$2,$3,$4,'Concurrent Approve and Pay lock order',$5,now()
        ) AS payload
      `, [
        approvers[3]!.userId,approvers[3]!.assignmentId,
        concurrentPaymentRequest.requestId,concurrentPaymentRequest.revision,
        concurrentPayCommand,
      ]).then((result) => ({ side: "payment" as const,payload: result.rows[0]!.payload }));
      const firstResult = await Promise.race([
        normalDecisionPromise,concurrentPaymentPromise,
      ]);
      const firstClient = firstResult.side === "normal" ? normalClient : concurrentPayClient;
      const secondBackendPid = firstResult.side === "normal"
        ? paymentBackend.rows[0]!.pid
        : normalBackend.rows[0]!.pid;
      const firstBackendPid = firstResult.side === "normal"
        ? normalBackend.rows[0]!.pid
        : paymentBackend.rows[0]!.pid;
      await waitUntilBlockedBy(secondBackendPid,firstBackendPid);
      await firstClient.query("COMMIT");
      if (firstResult.side === "normal") normalTransactionOpen = false;
      else paymentTransactionOpen = false;
      const [normalDecision,concurrentPayment] = await Promise.all([
        normalDecisionPromise,concurrentPaymentPromise,
      ]);
      const secondClient = firstResult.side === "normal" ? concurrentPayClient : normalClient;
      await secondClient.query("COMMIT");
      if (firstResult.side === "normal") paymentTransactionOpen = false;
      else normalTransactionOpen = false;
      expect(normalDecision.payload).toMatchObject({
        state: "APPROVED",
        action: "APPROVE",
        amount: "200.00",
        requestId: normalApprovalRequest.requestId,
      });
      expect(concurrentPayment.payload).toMatchObject({
        status: "SUCCESS",
        amount: "300.00",
        requestId: concurrentPaymentRequest.requestId,
        created: true,
      });
    } finally {
      if (normalTransactionOpen) {
        await normalClient.query("ROLLBACK").catch(() => undefined);
      }
      if (paymentTransactionOpen) {
        await concurrentPayClient.query("ROLLBACK").catch(() => undefined);
      }
      await Promise.all([normalClient.end(),concurrentPayClient.end()]);
    }
    const mixedPathEvidence = await admin.query<{
      normalState: string;
      normalReservations: number;
      normalReservedAmount: string;
      normalRemainingAmount: string;
      normalWalletPayments: number;
      paymentState: string;
      paymentWalletPayments: number;
      paymentBudgetFinalizations: number;
      paymentCommands: number;
      walletBalance: string;
      budgetAllocated: string;
      budgetAvailable: string;
      budgetReserved: string;
      budgetSpent: string;
    }>(`
      SELECT
        normal_request.approval_state AS "normalState",
        (SELECT count(*)::int FROM public.budget_reservations reservation
          WHERE reservation.request_id=normal_request.id) AS "normalReservations",
        normal_reservation.reserved_amount::text AS "normalReservedAmount",
        normal_reservation.remaining_reserved::text AS "normalRemainingAmount",
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries entry
          WHERE entry.request_id=normal_request.id AND entry.entry_type='PAYMENT')
          AS "normalWalletPayments",
        payment_request.approval_state AS "paymentState",
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries entry
          WHERE entry.request_id=payment_request.id AND entry.entry_type='PAYMENT')
          AS "paymentWalletPayments",
        (SELECT count(*)::int FROM public.budget_ledger_entries entry
          WHERE entry.request_id=payment_request.id AND entry.entry_type='FINAL_SPEND')
          AS "paymentBudgetFinalizations",
        (SELECT count(*)::int FROM public.approve_and_pay_commands command
          WHERE command.request_id=payment_request.id) AS "paymentCommands",
        wallet.available_balance::text AS "walletBalance",
        budget.allocated::text AS "budgetAllocated",
        budget.available::text AS "budgetAvailable",
        budget.reserved::text AS "budgetReserved",
        budget.spent::text AS "budgetSpent"
      FROM public.requests normal_request
      JOIN public.requests payment_request ON payment_request.id=$2
      JOIN public.budget_reservations normal_reservation
        ON normal_reservation.request_id=normal_request.id
      JOIN public.v_company_wallet_balances wallet
        ON wallet.company_id=normal_request.company_id
      JOIN public.v_budget_period_balances budget
        ON budget.budget_period_id=normal_request.budget_period_id
      WHERE normal_request.id=$1
    `, [normalApprovalRequest.requestId,concurrentPaymentRequest.requestId]);
    expect(mixedPathEvidence.rows[0]).toEqual({
      normalState: "APPROVED",
      normalReservations: 1,
      normalReservedAmount: "200.00",
      normalRemainingAmount: "200.00",
      normalWalletPayments: 0,
      paymentState: "AWAITING_FULFILMENT",
      paymentWalletPayments: 1,
      paymentBudgetFinalizations: 1,
      paymentCommands: 1,
      walletBalance: "3450.00",
      budgetAllocated: "8000.00",
      budgetAvailable: "6250.00",
      budgetReserved: "200.00",
      budgetSpent: "1550.00",
    });

    const walletShortfall = await createRequest("4000.00","WALLET-SHORTFALL");
    const walletShortfallCommand = randomUUID();
    const walletResult = await app.query<{
      payload: {
        status: string;
        requiredAmount: string;
        availableAmount: string;
        currency: string;
        requestId: string;
      };
    }>(`
      SELECT public.axora_approve_and_pay(
        $1,$2,$3,$4,'Prove insufficient wallet is mutation free',$5,now()
      ) AS payload
    `, [
      approvers[0]!.userId,approvers[0]!.assignmentId,
      walletShortfall.requestId,walletShortfall.revision,walletShortfallCommand,
    ]);
    expect(walletResult.rows[0]!.payload).toMatchObject({
      status: "INSUFFICIENT_WALLET",
      requiredAmount: "4000.00",
      availableAmount: "3450.00",
      currency: "MYR",
      requestId: walletShortfall.requestId,
    });
    await expect(app.query(`
      SELECT public.axora_approve_and_pay(
        $1,$2,$3,$4,'Altered insufficient-wallet command payload',$5,now()
      )
    `, [
      approvers[0]!.userId,approvers[0]!.assignmentId,
      walletShortfall.requestId,walletShortfall.revision,walletShortfallCommand,
    ])).rejects.toThrow(/Approve & Pay is unavailable/i);

    await expect(createRequest("7000.00","BUDGET-SHORTFALL"))
      .rejects.toMatchObject({ code: "P8207" });
    const deniedFinancialMutations = await admin.query<{
      count: number;
      commands: number;
      walletCommands: number;
      budgetCommands: number;
      paymentEvents: number;
      balance: string;
      budgetAvailable: string;
      budgetReserved: string;
      budgetSpent: string;
    }>(`
      SELECT ((
        SELECT count(*) FROM public.company_wallet_ledger_entries
        WHERE request_id=$1 AND entry_type='PAYMENT'
      ) + (
        SELECT count(*) FROM public.budget_ledger_entries
        WHERE request_id=$1 AND entry_type='FINAL_SPEND'
      ) + (
        SELECT count(*) FROM public.invoices
        WHERE request_id=$1 AND direction='CUSTOMER'
      ) + (
        SELECT count(*) FROM public.request_approval_decisions
        WHERE request_id=$1 AND action='APPROVE'
      ))::int AS count,
      (SELECT count(*)::int FROM public.approve_and_pay_commands command
        WHERE command.request_id=$1) AS commands,
      (SELECT count(*)::int FROM public.approve_and_pay_commands command
        WHERE command.request_id=$1
          AND command.result->>'status'='INSUFFICIENT_WALLET') AS "walletCommands",
      (SELECT count(*)::int FROM public.approve_and_pay_commands command
        WHERE command.request_id=$1
          AND command.result->>'status'='INSUFFICIENT_BUDGET') AS "budgetCommands",
      (SELECT count(*)::int FROM public.workflow_events event
        WHERE event.request_id=$1
          AND event.event_key='wallet.payment.recorded') AS "paymentEvents",
      (SELECT available_balance::text FROM public.v_company_wallet_balances
        WHERE company_id=$2) AS balance,
      budget.available::text AS "budgetAvailable",
      budget.reserved::text AS "budgetReserved",
      budget.spent::text AS "budgetSpent"
      FROM public.v_budget_period_balances budget WHERE budget.budget_period_id=$3
    `, [
      walletShortfall.requestId,financeCompanyId,request.budgetPeriodId,
    ]);
    expect(deniedFinancialMutations.rows[0]).toEqual({
      count: 0,
      commands: 1,
      walletCommands: 1,
      budgetCommands: 0,
      paymentEvents: 0,
      balance: "3450.00",
      budgetAvailable: "2250.00",
      budgetReserved: "4200.00",
      budgetSpent: "1550.00",
    });
    await app.query(`
      SELECT public.axora_decide_request_approval(
        $1,$2,$3,$4,'CANCEL','',NULL,
        'Release the wallet-shortfall reservation after verification',$5,now()
      )
    `, [requester.userId,requester.assignmentId,walletShortfall.requestId,
      walletShortfall.revision,randomUUID()]);

    const raceRequest = await createRequest("500.00", "PAY-CANCEL-RACE");
    const [payClient,cancelClient] = await Promise.all([
      connectedAppClient(), connectedAppClient(),
    ]);
    try {
      await Promise.allSettled([
        payClient.query(`
          SELECT public.axora_approve_and_pay(
            $1,$2,$3,$4,'Win or lose atomically against cancellation',$5,now()
          )
        `, [approvers[0]!.userId,approvers[0]!.assignmentId,
          raceRequest.requestId,raceRequest.revision,randomUUID()]),
        cancelClient.query(`
          SELECT public.axora_decide_request_approval(
            $1,$2,$3,$4,'CANCEL','',NULL,
            'Requester cancellation racing final payment',$5,now()
          )
        `, [requester.userId,requester.assignmentId,
          raceRequest.requestId,raceRequest.revision,randomUUID()]),
      ]);
    } finally {
      await Promise.all([payClient.end(),cancelClient.end()]);
    }
    const raceEvidence = await admin.query<{
      state: string; payments: number; cancellations: number; reservationStatus: string;
    }>(`
      SELECT request.approval_state AS state,
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries
          WHERE request_id=request.id AND entry_type='PAYMENT') AS payments,
        (SELECT count(*)::int FROM public.request_approval_decisions
          WHERE request_id=request.id AND action='CANCEL') AS cancellations,
        reservation.status AS "reservationStatus"
      FROM public.requests request
      JOIN public.budget_reservations reservation ON reservation.request_id=request.id
      WHERE request.id=$1
    `, [raceRequest.requestId]);
    expect([
      { state: "AWAITING_FULFILMENT",payments: 1,cancellations: 0,reservationStatus: "SPENT" },
      { state: "CANCELLED",payments: 0,cancellations: 1,reservationStatus: "RELEASED" },
    ]).toContainEqual(raceEvidence.rows[0]);
  }, 150_000);

  it("routes the immediately previous payment contract through Company Wallet", async () => {
    if (!app || !admin) throw new Error("Native PostgreSQL fixture is unavailable.");
    const legacyRequest = await createRequest("500.00","LEGACY-COMPATIBILITY");
    const approval = await app.query<{ payload: { state: string; approvalRevision: number } }>(`
      SELECT public.axora_decide_request_approval(
        $1,$2,$3,$4,'APPROVE','',NULL,
        'Approve before previous-image checkout',$5,now()
      ) AS payload
    `, [
      approvers[0]!.userId,approvers[0]!.assignmentId,
      legacyRequest.requestId,legacyRequest.revision,randomUUID(),
    ]);
    expect(approval.rows[0]!.payload.state).toBe("APPROVED");

    const balanceBefore = await admin.query<{ balance: string }>(`
      SELECT available_balance::text AS balance
      FROM public.v_company_wallet_balances WHERE company_id=$1
    `, [financeCompanyId]);
    const previousImageIdempotencyKey = randomUUID();
    const paid = await app.query<{
      payload: {
        invoiceId: string; invoiceNumber: string; paymentStatus: string;
        invoiceStatus: string; created: boolean;
      };
    }>(`
      SELECT public.axora_complete_payment($1,$2,$3,$4,$5,$6) AS payload
    `, [
      requester.userId,requester.assignmentId,legacyRequest.requestId,
      "OFFLINE",previousImageIdempotencyKey,new Date(),
    ]);
    expect(paid.rows[0]!.payload).toMatchObject({
      paymentStatus: "PAID",invoiceStatus: "FINALIZED",created: true,
    });
    const replay = await app.query<{ payload: { invoiceId: string; created: boolean } }>(`
      SELECT public.axora_complete_payment($1,$2,$3,$4,$5,$6) AS payload
    `, [
      requester.userId,requester.assignmentId,legacyRequest.requestId,
      "OFFLINE",previousImageIdempotencyKey,new Date(),
    ]);
    expect(replay.rows[0]!.payload).toEqual(expect.objectContaining({
      invoiceId: paid.rows[0]!.payload.invoiceId,created: false,
    }));

    const evidence = await admin.query<{
      walletPayments: number; budgetFinalizations: number; invoices: number;
      payments: number; commands: number; balance: string;
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.company_wallet_ledger_entries
          WHERE request_id=$1 AND entry_type='PAYMENT') AS "walletPayments",
        (SELECT count(*)::int FROM public.budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND') AS "budgetFinalizations",
        (SELECT count(*)::int FROM public.invoices
          WHERE request_id=$1 AND direction='CUSTOMER') AS invoices,
        (SELECT count(*)::int FROM public.payments payment
          JOIN public.invoices invoice ON invoice.id=payment.invoice_id
          WHERE invoice.request_id=$1 AND payment.payment_status='PAID') AS payments,
        (SELECT count(*)::int FROM public.approve_and_pay_commands
          WHERE request_id=$1) AS commands,
        (SELECT available_balance::text FROM public.v_company_wallet_balances
          WHERE company_id=$2) AS balance
    `, [legacyRequest.requestId,financeCompanyId]);
    expect(evidence.rows[0]).toEqual({
      walletPayments: 1,budgetFinalizations: 1,invoices: 1,payments: 1,commands: 1,
      balance: (Number(balanceBefore.rows[0]!.balance)-500).toFixed(2),
    });

    const insufficientAmount = (Number(evidence.rows[0]!.balance)+100).toFixed(2);
    const insufficientRequest = await createRequest(
      insufficientAmount,"LEGACY-INSUFFICIENT",
    );
    await app.query(`
      SELECT public.axora_decide_request_approval(
        $1,$2,$3,$4,'APPROVE','',NULL,
        'Approve before insufficient previous-image checkout',$5,now()
      )
    `, [
      approvers[0]!.userId,approvers[0]!.assignmentId,
      insufficientRequest.requestId,insufficientRequest.revision,randomUUID(),
    ]);
    await expect(app.query(`
      SELECT public.axora_complete_payment($1,$2,$3,$4,$5,$6)
    `, [
      requester.userId,requester.assignmentId,insufficientRequest.requestId,
      "OFFLINE",randomUUID(),new Date(),
    ])).rejects.toThrow(/INSUFFICIENT_WALLET/i);
    const refused = await admin.query<{ mutations: number; balance: string }>(`
      SELECT (SELECT count(*)::int FROM public.company_wallet_ledger_entries
        WHERE request_id=$1 AND entry_type='PAYMENT')
        +(SELECT count(*)::int FROM public.budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND')
        +(SELECT count(*)::int FROM public.invoices
          WHERE request_id=$1 AND direction='CUSTOMER') AS mutations,
        (SELECT available_balance::text FROM public.v_company_wallet_balances
          WHERE company_id=$2) AS balance
    `, [insufficientRequest.requestId,financeCompanyId]);
    expect(refused.rows[0]).toEqual({
      mutations: 0,balance: evidence.rows[0]!.balance,
    });
  }, 60_000);
});

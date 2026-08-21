import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

type Actor = { userId: string; assignmentId: string };

const ids = {
  company: "74000000-0000-4000-8000-000000000001",
  branch: "74000000-0000-4000-8000-000000000002",
  owner: "74000000-0000-4000-8000-000000000003",
  ownerAssignment: "74000000-0000-4000-8000-000000000004",
  admin: "74000000-0000-4000-8000-000000000005",
  adminAssignment: "74000000-0000-4000-8000-000000000006",
  requester: "74000000-0000-4000-8000-000000000007",
  requesterAssignment: "74000000-0000-4000-8000-000000000008",
  approver: "74000000-0000-4000-8000-000000000009",
  approverAssignment: "74000000-0000-4000-8000-000000000010",
  finance: "74000000-0000-4000-8000-000000000011",
  financeAssignment: "74000000-0000-4000-8000-000000000012",
  otherRequester: "74000000-0000-4000-8000-000000000013",
  otherRequesterAssignment: "74000000-0000-4000-8000-000000000014",
  otherCompany: "74000000-0000-4000-8000-000000000015",
  otherBranch: "74000000-0000-4000-8000-000000000016",
  otherFinance: "74000000-0000-4000-8000-000000000017",
  otherFinanceAssignment: "74000000-0000-4000-8000-000000000018",
  product: "74000000-0000-4000-8000-000000000019",
  cam: "74000000-0000-4000-8000-000000000020",
  camAssignment: "74000000-0000-4000-8000-000000000021",
} as const;

describe.sequential("Company Wallet and atomic Approve & Pay migration", () => {
  let db: PGlite;
  let budgetAccountId: string;
  let topUpRequestId: string;
  let topUpLedgerId: string;

  const owner: Actor = {
    userId: ids.owner,
    assignmentId: ids.ownerAssignment,
  };
  const admin: Actor = {
    userId: ids.admin,
    assignmentId: ids.adminAssignment,
  };
  const requester: Actor = {
    userId: ids.requester,
    assignmentId: ids.requesterAssignment,
  };
  const approver: Actor = {
    userId: ids.approver,
    assignmentId: ids.approverAssignment,
  };

  async function asApp<T>(operation: () => Promise<T>) {
    await db.exec("SET ROLE axora_app");
    try {
      return await operation();
    } finally {
      await db.exec("RESET ROLE");
    }
  }

  async function createRequest(input: {
    code: string;
    total: string;
    deliveryFee: string;
  }) {
    const created = await db.query<{ id: string }>(`
      INSERT INTO requests(
        order_code,request_date,request_type_id,company_id,branch_id,
        department,requested_by,requester_contact,needed_by_date,urgency_id,
        status_id,notes,created_by,estimated_delivery_fee,tax_rate,tax_amount,
        client_submission_key
      ) VALUES (
        $1,CURRENT_DATE,lookup_id('request_type','Standard'),$2,$3,
        'Operations','Wallet requester','wallet-requester@example.test',
        CURRENT_DATE+7,lookup_id('urgency','Normal'),
        lookup_id('request_status','New Request'),'Wallet migration request',$4,
        $5::numeric,0,0,gen_random_uuid()
      ) RETURNING id::text
    `, [input.code,ids.company,ids.branch,requester.userId,input.deliveryFee]);
    const requestId = created.rows[0]!.id;
    await db.query(`
      INSERT INTO request_lines(
        request_line_code,request_id,product_id,product_name_snapshot,
        category_snapshot,subcategory_snapshot,quantity,unit_of_measure,
        supplier_confirmation_status_id,unit_buy_price,unit_sell_price
      ) SELECT next_request_line_code(),$1,product.id,product.name,
        product.category,product.subcategory,1,product.unit_of_measure,
        lookup_id('supplier_confirmation','Pending'),0,0
      FROM products product WHERE product.id=$2
    `, [requestId,ids.product]);
    await asApp(() => db.query(
      "SELECT axora_initialize_request_approval($1,$2,$3,$4,now())",
      [requester.userId,requester.assignmentId,requestId,`initialize-${input.code}`],
    ));
    const state = await db.query<{ revision: number; amount: string }>(`
      SELECT request.approval_revision::int AS revision,
        snapshot.amount::text AS amount
      FROM requests request
      JOIN request_approval_snapshots snapshot
        ON snapshot.request_id=request.id
       AND snapshot.request_version=request.request_version
      WHERE request.id=$1
    `, [requestId]);
    expect(state.rows[0]!.amount).toBe(input.total);
    return { requestId,revision: state.rows[0]!.revision };
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec("CREATE ROLE axora_app NOLOGIN");
    await applyMigrations(db);

    await db.query(`
      INSERT INTO companies(id,company_code,name,active,contractual_ceiling)
      VALUES
        ($1,'WALLET-CORE','Wallet core company',true,50000),
        ($2,'WALLET-OTHER','Wallet other company',true,50000)
    `, [ids.company,ids.otherCompany]);
    await db.query(`
      INSERT INTO branches(
        id,branch_code_id,company_id,name,branch_code,delivery_address,
        city,timezone,monthly_budget,active
      ) VALUES
        ($1,'WALLET-BRANCH',$2,'Wallet branch','WALLET-BRANCH',
          'Original wallet delivery address','Kuala Lumpur','Asia/Kuala_Lumpur',
          12000,true),
        ($3,'WALLET-OTHER-BRANCH',$4,'Other wallet branch',
          'WALLET-OTHER-BRANCH','Other tenant address','Kuala Lumpur',
          'Asia/Kuala_Lumpur',12000,true)
    `, [ids.branch,ids.company,ids.otherBranch,ids.otherCompany]);
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,company_id,branch_id,
        is_owner,account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT fixture.id,fixture.email,fixture.display_name,'not-a-real-hash',
        role.id,fixture.company_id,fixture.branch_id,fixture.is_owner,
        now(),now(),fixture.account_kind,'ACTIVE',true,1
      FROM (VALUES
        ($1::uuid,'wallet-owner@example.test','Wallet owner',NULL::uuid,NULL::uuid,true,'PLATFORM','PLATFORM_OWNER'),
        ($2::uuid,'wallet-admin@example.test','Wallet administrator',$8::uuid,NULL::uuid,false,'COMPANY','COMPANY_ADMIN'),
        ($3::uuid,'wallet-requester@example.test','Wallet requester',$8::uuid,$9::uuid,false,'COMPANY','REQUESTER'),
        ($4::uuid,'wallet-approver@example.test','Wallet approver',$8::uuid,$9::uuid,false,'COMPANY','BRANCH_APPROVER'),
        ($5::uuid,'wallet-finance@example.test','Wallet finance',$8::uuid,$9::uuid,false,'COMPANY','FINANCE_REVIEWER'),
        ($6::uuid,'wallet-other-requester@example.test','Other scoped requester',$8::uuid,$9::uuid,false,'COMPANY','REQUESTER'),
        ($7::uuid,'wallet-cross-tenant-finance@example.test','Cross tenant finance',$10::uuid,$11::uuid,false,'COMPANY','FINANCE_REVIEWER'),
        ($12::uuid,'wallet-cam@example.test','Wallet CAM',NULL::uuid,NULL::uuid,false,'PLATFORM','CLIENT_ACCOUNT_MANAGER')
      ) AS fixture(
        id,email,display_name,company_id,branch_id,is_owner,account_kind,role_key
      )
      JOIN roles role ON role.role_key=fixture.role_key
    `, [
      ids.owner,ids.admin,ids.requester,ids.approver,ids.finance,
      ids.otherRequester,ids.otherFinance,ids.company,ids.branch,
      ids.otherCompany,ids.otherBranch,ids.cam,
    ]);
    await db.query(`
      INSERT INTO user_profiles(
        user_id,display_name,preferred_locale,timezone,profile_completed_at
      ) SELECT id,display_name,'en','Asia/Kuala_Lumpur',now()
      FROM users WHERE id=ANY($1::uuid[])
    `, [[
      ids.owner,ids.admin,ids.requester,ids.approver,ids.finance,
      ids.otherRequester,ids.otherFinance,
      ids.cam,
    ]]);
    await db.query(`
      INSERT INTO company_memberships(
        user_id,company_id,status,is_primary,joined_at
      ) VALUES
        ($1,$6,'ACTIVE',true,now()),($2,$6,'ACTIVE',true,now()),
        ($3,$6,'ACTIVE',true,now()),($4,$6,'ACTIVE',true,now()),
        ($5,$6,'ACTIVE',true,now()),($7,$8,'ACTIVE',true,now())
    `, [
      ids.admin,ids.requester,ids.approver,ids.finance,ids.otherRequester,
      ids.company,ids.otherFinance,ids.otherCompany,
    ]);
    await db.query(`
      INSERT INTO branch_assignments(
        user_id,company_id,branch_id,status,is_primary
      ) VALUES
        ($1,$6,$7,'ACTIVE',true),($2,$6,$7,'ACTIVE',true),
        ($3,$6,$7,'ACTIVE',true),($4,$6,$7,'ACTIVE',true),
        ($5,$8,$9,'ACTIVE',true)
    `, [
      ids.requester,ids.approver,ids.finance,ids.otherRequester,
      ids.otherFinance,ids.company,ids.branch,ids.otherCompany,ids.otherBranch,
    ]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,company_id,branch_id,active,assigned_at
      ) SELECT fixture.assignment_id,fixture.user_id,role.id,
        fixture.scope_type,fixture.company_id,fixture.branch_id,true,now()
      FROM (VALUES
        ($1::uuid,$2::uuid,'PLATFORM',NULL::uuid,NULL::uuid,'PLATFORM_OWNER'),
        ($3::uuid,$4::uuid,'COMPANY',$13::uuid,NULL::uuid,'COMPANY_ADMIN'),
        ($5::uuid,$6::uuid,'BRANCH',$13::uuid,$14::uuid,'REQUESTER'),
        ($7::uuid,$8::uuid,'BRANCH',$13::uuid,$14::uuid,'BRANCH_APPROVER'),
        ($9::uuid,$10::uuid,'BRANCH',$13::uuid,$14::uuid,'FINANCE_REVIEWER'),
        ($11::uuid,$12::uuid,'BRANCH',$13::uuid,$14::uuid,'REQUESTER'),
        ($15::uuid,$16::uuid,'BRANCH',$17::uuid,$18::uuid,'FINANCE_REVIEWER'),
        ($19::uuid,$20::uuid,'PLATFORM',NULL::uuid,NULL::uuid,'CLIENT_ACCOUNT_MANAGER')
      ) AS fixture(
        assignment_id,user_id,scope_type,company_id,branch_id,role_key
      )
      JOIN roles role ON role.role_key=fixture.role_key
    `, [
      ids.ownerAssignment,ids.owner,ids.adminAssignment,ids.admin,
      ids.requesterAssignment,ids.requester,ids.approverAssignment,ids.approver,
      ids.financeAssignment,ids.finance,ids.otherRequesterAssignment,
      ids.otherRequester,ids.company,ids.branch,ids.otherFinanceAssignment,
      ids.otherFinance,ids.otherCompany,ids.otherBranch,
      ids.camAssignment,ids.cam,
    ]);
    await db.query(`
      INSERT INTO approval_limits(
        role_id,permission_id,scope_type,company_id,branch_id,currency,
        maximum_amount,allow_self_approval,starts_at,active,reason,changed_by
      ) SELECT role.id,permission.id,'BRANCH',$1,$2,'MYR',50000,false,
        now()-interval '1 minute',true,'Wallet migration approval authority',$3
      FROM roles role CROSS JOIN permissions permission
      WHERE role.role_key='BRANCH_APPROVER'
        AND permission.permission_code='request.approve.other'
    `, [ids.company,ids.branch,ids.owner]);
    await db.query(`
      INSERT INTO products(
        id,product_code,name,category,subcategory,unit_of_measure,
        default_buy_price,default_sell_price,minimum_order_quantity,active
      ) VALUES (
        $1,'WALLET-PRODUCT','Wallet product','Operations','Finance','unit',
        100,110,1,true
      )
    `, [ids.product]);
    await asApp(() => db.query(`
      SELECT axora_save_branch_delivery_location(
        $1,$2,$3,'Original canonical wallet destination',3.139000,101.686900,
        'Use the loading entrance','Configure wallet test destination',$4,now()
      )
    `, [admin.userId,admin.assignmentId,ids.branch,randomUUID()]));
    const budget = await db.query<{ id: string }>(`
      SELECT id::text FROM budget_accounts
      WHERE branch_id=$1 AND level_type='BRANCH' AND active
    `, [ids.branch]);
    budgetAccountId = budget.rows[0]!.id;
  }, 45_000);

  afterAll(async () => {
    await db.close();
  });

  it("requests and records top-ups exactly once with immutable evidence", async () => {
    const requestCommand = randomUUID();
    const requested = await asApp(() => db.query<{
      payload: {
        created: boolean; requestId: string; amount: string; workflowEventId: string;
      };
    }>(`
      SELECT axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'WALLET-REQUEST','External transfer planned',$5,now()
      ) AS payload
    `, [admin.userId,admin.assignmentId,ids.company,"6000.00",requestCommand]));
    expect(requested.rows[0]!.payload).toMatchObject({
      created: true,
      amount: "6000.00",
    });
    topUpRequestId = requested.rows[0]!.payload.requestId;
    const requestReplay = await asApp(() => db.query<{
      payload: { created: boolean; requestId: string };
    }>(`
      SELECT axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'WALLET-REQUEST','External transfer planned',$5,now()
      ) AS payload
    `, [admin.userId,admin.assignmentId,ids.company,"6000.00",requestCommand]));
    expect(requestReplay.rows[0]!.payload).toEqual(expect.objectContaining({
      created: false,
      requestId: topUpRequestId,
    }));
    await expect(asApp(() => db.query(`
      SELECT axora_request_company_wallet_top_up(
        $1,$2,$3,$4::numeric,'WALLET-REQUEST','External transfer planned',$5,now()
      )
    `, [
      admin.userId,admin.assignmentId,ids.company,"6001.00",requestCommand,
    ]))).rejects.toThrow(/unavailable/i);

    const walletNotifications = await db.query<{
      id: string; recipientUserId: string; routePath: string; authorized: boolean;
    }>(`
      SELECT notification.id::text,notification.recipient_user_id::text
          AS "recipientUserId",notification.route_path AS "routePath",
        axora_notification_route_is_authorized(
          axora_live_authorization_snapshot(
            notification.recipient_user_id,assignment.id,now()
          ),notification.recipient_user_id,notification.id,now()
        ) AS authorized
      FROM in_app_notifications notification
      JOIN role_assignments assignment
        ON assignment.user_id=notification.recipient_user_id
       AND assignment.active AND assignment.revoked_at IS NULL
      WHERE notification.workflow_event_id=$1
      ORDER BY notification.recipient_user_id
    `, [requested.rows[0]!.payload.workflowEventId]);
    expect(walletNotifications.rows).toHaveLength(2);
    expect(new Set(walletNotifications.rows.map((item) => item.recipientUserId)))
      .toEqual(new Set([owner.userId,admin.userId]));
    expect(walletNotifications.rows.every((item) => (
      item.routePath === `/wallet?company=${ids.company}` && item.authorized
    ))).toBe(true);

    const forgedRoute = await db.query<{ id: string }>(`
      INSERT INTO in_app_notifications(
        company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
        title,body,priority,route_path,created_at
      ) SELECT event.company_id,$1,event.id,event.event_key,$2,
        'Forged Wallet route','Must fail exact tenant authorization','NORMAL',
        '/wallet?company='||$3::text,now()
      FROM workflow_events event WHERE event.id=$4
      RETURNING id::text
    `, [
      ids.otherFinance,`forged-wallet-route:${randomUUID()}`,
      ids.otherCompany,requested.rows[0]!.payload.workflowEventId,
    ]);
    const forgedRouteAuthorization = await db.query<{ authorized: boolean }>(`
      SELECT axora_notification_route_is_authorized(
        axora_live_authorization_snapshot($1,$2,now()),$1,$3,now()
      ) AS authorized
    `, [ids.otherFinance,ids.otherFinanceAssignment,forgedRoute.rows[0]!.id]);
    expect(forgedRouteAuthorization.rows[0]!.authorized).toBe(false);

    await expect(asApp(() => db.query(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'FORGED-CREDIT',
        'Company users cannot credit funds',$6,now()
      )
    `, [
      admin.userId,admin.assignmentId,ids.company,topUpRequestId,
      "6000.00",randomUUID(),
    ]))).rejects.toThrow(/unavailable/i);

    const recordCommand = randomUUID();
    const recorded = await asApp(() => db.query<{
      payload: { created: boolean; ledgerEntryId: string; amount: string };
    }>(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'WALLET-RECEIVED',
        'Externally confirmed received funds',$6,now()
      ) AS payload
    `, [
      owner.userId,owner.assignmentId,ids.company,topUpRequestId,
      "6000.00",recordCommand,
    ]));
    expect(recorded.rows[0]!.payload).toMatchObject({
      created: true,
      amount: "6000.00",
    });
    topUpLedgerId = recorded.rows[0]!.payload.ledgerEntryId;

    const sameCommand = await asApp(() => db.query<{
      payload: { ledgerEntryId: string };
    }>(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'WALLET-RECEIVED',
        'Externally confirmed received funds',$6,now()
      ) AS payload
    `, [
      owner.userId,owner.assignmentId,ids.company,topUpRequestId,
      "6000.00",recordCommand,
    ]));
    const sameRequest = await asApp(() => db.query<{
      payload: { created: boolean; ledgerEntryId: string; amount: string };
    }>(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'WALLET-RECEIVED-REPLAY',
        'Second command cannot duplicate funds',$6,now()
      ) AS payload
    `, [
      owner.userId,owner.assignmentId,ids.company,topUpRequestId,
      "9999.00",randomUUID(),
    ]));
    expect(sameCommand.rows[0]!.payload.ledgerEntryId).toBe(topUpLedgerId);
    await expect(asApp(() => db.query(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,$4,$5::numeric,CURRENT_DATE,'WALLET-RECEIVED',
        'Changed reason must not replay the old result',$6,now()
      )
    `, [
      owner.userId,owner.assignmentId,ids.company,topUpRequestId,
      "6000.00",recordCommand,
    ]))).rejects.toThrow(/unavailable/i);
    expect(sameRequest.rows[0]!.payload).toMatchObject({
      created: false,
      ledgerEntryId: topUpLedgerId,
      amount: "6000.00",
    });

    const state = await db.query<{ credits: number; balance: string }>(`
      SELECT
        (SELECT count(*)::int FROM company_wallet_ledger_entries
          WHERE company_id=$1 AND entry_type='TOP_UP') AS credits,
        (SELECT available_balance::text FROM v_company_wallet_balances
          WHERE company_id=$1) AS balance
    `, [ids.company]);
    expect(state.rows[0]).toEqual({ credits: 1,balance: "6000.00" });
    await expect(db.query(
      "UPDATE company_wallet_ledger_entries SET reason='mutated' WHERE id=$1",
      [topUpLedgerId],
    )).rejects.toThrow(/append-only/i);
    await expect(db.query(
      "DELETE FROM company_wallet_ledger_entries WHERE id=$1",
      [topUpLedgerId],
    )).rejects.toThrow(/append-only/i);

    const deletionImpact = await asApp(() => db.query<{
      payload: {
        branchDeliveryLocationCommands: number;
        protectedEvidence: number;
        hardDeleteEligible: boolean;
        ownership: Record<string, { count: number; protectedAction: string }>;
      };
    }>(`
      SELECT axora_company_deletion_impact_v2($1,$2,$3,now()) AS payload
    `, [owner.userId,owner.assignmentId,ids.company]));
    expect(deletionImpact.rows[0]!.payload).toMatchObject({
      branchDeliveryLocationCommands: 1,
      hardDeleteEligible: false,
      ownership: {
        branch_delivery_location_commands: {
          count: 1,
          protectedAction: "RETAIN_WITH_ACCESS_REVOKED",
        },
      },
    });
    expect(deletionImpact.rows[0]!.payload.protectedEvidence).toBeGreaterThan(0);
    const hardDeleteDag = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM company_deletion_ownership_dag
      WHERE table_name='branch_delivery_location_commands'
    `);
    expect(hardDeleteDag.rows[0]!.count).toBe(1);
  }, 30_000);

  it("keeps monthly, yearly, recurring custom, and custom-day budgets separate from money", async () => {
    const opening = await db.query<{ frequency: string; balance: string; entries: number }>(`
      SELECT schedule.frequency,
        wallet.available_balance::text AS balance,
        (SELECT count(*)::int FROM company_wallet_ledger_entries
          WHERE company_id=$2) AS entries
      FROM budget_cycle_schedules schedule
      JOIN v_company_wallet_balances wallet ON wallet.company_id=schedule.company_id
      WHERE schedule.budget_account_id=$1
      ORDER BY schedule.schedule_version LIMIT 1
    `, [budgetAccountId,ids.company]);
    expect(opening.rows[0]).toEqual({ frequency: "MONTHLY",balance: "6000.00",entries: 1 });

    for (const [frequency,intervalCount,customDays] of [
      ["YEARLY",1,null],
      ["MONTHLY",10,null],
      ["CUSTOM",1,300],
    ] as const) {
      const requested = await asApp(() => db.query<{
        payload: { changeRequestId: string };
      }>(`
        SELECT axora_request_budget_cycle_change(
          $1,$2,$3,jsonb_strip_nulls(jsonb_build_object(
            'frequency',$4::text,'intervalCount',$5::integer,
            'customIntervalDays',$6::integer,
            'timezone','Asia/Kuala_Lumpur','dstResolution','EARLIER',
            'fixedAllocation','12000.00','rolloverMode','RESET_FIXED',
            'lowThresholdPercentage',25,'criticalThresholdPercentage',10,
            'hysteresisPercentage',5,
            'effectiveLocal',to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur',
              'YYYY-MM-DD"T"HH24:MI:SS')
          )),'Change the branch budget period safely',$7,now()
        ) AS payload
      `, [
        admin.userId,admin.assignmentId,budgetAccountId,frequency,
        intervalCount,customDays,`cycle-${frequency}-${intervalCount}-${randomUUID()}`,
      ]));
      const decided = await asApp(() => db.query<{
        payload: { state: string };
      }>(`
        SELECT axora_decide_budget_cycle_change(
          $1,$2,$3,'APPROVE','Approve tested budget period',$4,now()
        ) AS payload
      `, [
        owner.userId,owner.assignmentId,
        requested.rows[0]!.payload.changeRequestId,randomUUID(),
      ]));
      expect(decided.rows[0]!.payload.state).toBe("APPROVED");
    }

    const schedules = await db.query<{
      frequency: string; intervalCount: number; customDays: number | null;
    }>(`
      SELECT frequency,"interval_count"::int AS "intervalCount",
        custom_interval_days::int AS "customDays"
      FROM budget_cycle_schedules WHERE budget_account_id=$1
      ORDER BY schedule_version
    `, [budgetAccountId]);
    expect(schedules.rows.map((schedule) => [
      schedule.frequency,schedule.intervalCount,schedule.customDays,
    ])).toEqual([
      ["MONTHLY",1,null],
      ["YEARLY",1,null],
      ["MONTHLY",10,null],
      ["CUSTOM",1,300],
    ]);
    const wallet = await db.query<{ balance: string; entries: number }>(`
      SELECT available_balance::text AS balance,
        (SELECT count(*)::int FROM company_wallet_ledger_entries
          WHERE company_id=$1) AS entries
      FROM v_company_wallet_balances WHERE company_id=$1
    `, [ids.company]);
    expect(wallet.rows[0]).toEqual({ balance: "6000.00",entries: 1 });
  }, 30_000);

  it("approves and pays once, reports shortfalls locally, and scopes invoice reads", async () => {
    const successRequest = await createRequest({
      code: "WALLET-PAY-SUCCESS",
      total: "1000.00",
      deliveryFee: "890.00",
    });
    const authority = await db.query<{ amount: string | null; snapshot: unknown }>(`
      SELECT axora_approval_limit_for_request(
        axora_live_authorization_snapshot($1,$2,now()),
        'request.approve.other',$3,$4,NULL,'MYR',false
      )::text AS amount,
      axora_live_authorization_snapshot($1,$2,now())->'approvalLimits' AS snapshot
    `, [approver.userId,approver.assignmentId,ids.company,ids.branch]);
    expect(authority.rows[0]!.amount, JSON.stringify(authority.rows[0]!.snapshot))
      .toBe("50000.00");
    const commandId = randomUUID();
    const success = await asApp(() => db.query<{
      payload: { status: string; invoiceId: string; created: boolean };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Approve and pay the authorized request',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,successRequest.requestId,
      successRequest.revision,commandId,
    ]));
    if (success.rows[0]!.payload.status !== "SUCCESS") {
      throw new Error(`Unexpected Approve & Pay result: ${JSON.stringify(
        success.rows[0]!.payload,
      )}`);
    }
    expect(success.rows[0]!.payload).toMatchObject({ status: "SUCCESS",created: true });
    const retry = await asApp(() => db.query<{
      payload: { status: string; invoiceId: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Approve and pay the authorized request',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,successRequest.requestId,
      successRequest.revision,commandId,
    ]));
    const secondCommand = await asApp(() => db.query<{
      payload: { status: string; invoiceId: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Approve and pay the authorized request',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,successRequest.requestId,
      successRequest.revision,randomUUID(),
    ]));
    expect(retry.rows[0]!.payload).toEqual(success.rows[0]!.payload);
    await expect(asApp(() => db.query(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Changed reason must not replay the old result',$5,now()
      )
    `, [
      approver.userId,approver.assignmentId,successRequest.requestId,
      successRequest.revision,commandId,
    ]))).rejects.toThrow(/unavailable/i);
    expect(secondCommand.rows[0]!.payload).toMatchObject({
      status: "ALREADY_PROCESSED",
      invoiceId: success.rows[0]!.payload.invoiceId,
    });

    const evidence = await db.query<{
      walletPayments: number; budgetSpends: number; invoices: number;
      payments: number; approvals: number; commands: number; balance: string;
    }>(`
      SELECT
        (SELECT count(*)::int FROM company_wallet_ledger_entries
          WHERE request_id=$1 AND entry_type='PAYMENT') AS "walletPayments",
        (SELECT count(*)::int FROM budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND') AS "budgetSpends",
        (SELECT count(*)::int FROM invoices
          WHERE request_id=$1 AND direction='CUSTOMER') AS invoices,
        (SELECT count(*)::int FROM payments payment JOIN invoices invoice
          ON invoice.id=payment.invoice_id WHERE invoice.request_id=$1
            AND payment.payment_status='PAID') AS payments,
        (SELECT count(*)::int FROM request_approval_decisions
          WHERE request_id=$1 AND action='APPROVE') AS approvals,
        (SELECT count(*)::int FROM approve_and_pay_commands
          WHERE request_id=$1) AS commands,
        (SELECT available_balance::text FROM v_company_wallet_balances
          WHERE company_id=$2) AS balance
    `, [successRequest.requestId,ids.company]);
    expect(evidence.rows[0]).toEqual({
      walletPayments: 1,budgetSpends: 1,invoices: 1,payments: 1,
      approvals: 1,commands: 2,balance: "5000.00",
    });

    const summaries = await asApp(async () => Promise.all([
      db.query<{ payload: Record<string, unknown> | null }>(
        "SELECT axora_final_invoice_summary($1,$2,$3,now()) AS payload",
        [approver.userId,approver.assignmentId,successRequest.requestId],
      ),
      db.query<{ payload: Record<string, unknown> | null }>(
        "SELECT axora_final_invoice_summary($1,$2,$3,now()) AS payload",
        [requester.userId,requester.assignmentId,successRequest.requestId],
      ),
      db.query<{ payload: Record<string, unknown> | null }>(
        "SELECT axora_final_invoice_summary($1,$2,$3,now()) AS payload",
        [ids.finance,ids.financeAssignment,successRequest.requestId],
      ),
      db.query<{ payload: Record<string, unknown> | null }>(
        "SELECT axora_final_invoice_summary($1,$2,$3,now()) AS payload",
        [ids.otherRequester,ids.otherRequesterAssignment,successRequest.requestId],
      ),
      db.query<{ payload: Record<string, unknown> | null }>(
        "SELECT axora_final_invoice_summary($1,$2,$3,now()) AS payload",
        [ids.otherFinance,ids.otherFinanceAssignment,successRequest.requestId],
      ),
    ]));
    expect(summaries.slice(0, 3).every((summary) => summary.rows[0]!.payload)).toBe(true);
    expect(summaries[3]!.rows[0]!.payload).toBeNull();
    expect(summaries[4]!.rows[0]!.payload).toBeNull();

    const deliveryJob = (await db.query<{ id: string }>(`
      SELECT id::text FROM delivery_jobs WHERE request_id=$1
    `, [successRequest.requestId])).rows[0];
    if (!deliveryJob) throw new Error("Approve & Pay must create a delivery job.");
    const deliveryEvidenceId = randomUUID();
    await db.exec("SET session_replication_role=replica");
    try {
      await db.query(`
        INSERT INTO delivery_evidence(
          id,company_id,delivery_job_id,delivery_job_event_id,driver_user_id,
          client_evidence_id,evidence_type,file_name,content_type,storage_path,
          sha256,captured_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,'PHOTO','proof.jpg','image/jpeg',
          'delivery-evidence/wallet/proof.jpg',repeat('a',64),now()
        )
      `, [
        deliveryEvidenceId,ids.company,deliveryJob.id,randomUUID(),requester.userId,
        randomUUID(),
      ]);
    } finally {
      await db.exec("SET session_replication_role=origin");
    }
    async function evidenceRows(actor: Actor) {
      return asApp(() => db.query<{ evidence_id: string }>(`
        SELECT evidence_id::text FROM axora_delivery_evidence_file(
          $1,$2,$3,now()
        )
      `, [actor.userId,actor.assignmentId,deliveryEvidenceId]));
    }
    const platformOperations = {
      userId: randomUUID(),
      assignmentId: randomUUID(),
    };
    await db.query(`
      INSERT INTO users(
        id,email,display_name,password_hash,role_id,is_owner,
        account_setup_completed_at,email_verified_at,account_kind,
        account_status,active,auth_version
      ) SELECT $1,$2,'Platform operations evidence fixture','not-a-real-hash',
        role.id,false,now(),now(),'PLATFORM','ACTIVE',true,1
      FROM roles role WHERE role.role_key='PLATFORM_OPERATIONS'
    `, [
      platformOperations.userId,
      `platform-operations-evidence-${platformOperations.userId}@example.test`,
    ]);
    await db.query(`
      INSERT INTO role_assignments(
        id,user_id,role_id,scope_type,active,assigned_by,assigned_at
      ) SELECT $1,$2,role.id,'PLATFORM',true,$3,now()
      FROM roles role WHERE role.role_key='PLATFORM_OPERATIONS'
    `, [platformOperations.assignmentId,platformOperations.userId,ids.owner]);
    expect((await evidenceRows(owner)).rows).toHaveLength(1);
    expect((await evidenceRows(platformOperations)).rows).toHaveLength(0);
    expect((await evidenceRows({
      userId: ids.finance,
      assignmentId: ids.financeAssignment,
    })).rows).toHaveLength(1);
    expect((await evidenceRows({
      userId: ids.otherFinance,
      assignmentId: ids.otherFinanceAssignment,
    })).rows).toHaveLength(0);
    const cam = { userId: ids.cam,assignmentId: ids.camAssignment };
    expect((await evidenceRows(cam)).rows).toHaveLength(0);
    await db.query(`
      INSERT INTO company_assignments(
        company_id,manager_user_id,assignment_type,status,coverage_starts_at,
        assigned_by,assigned_at,assignment_reason
      ) VALUES ($1,$2,'PRIMARY','ACTIVE',now()-interval '1 minute',$3,now(),
        'PGlite exact-scope evidence coverage')
    `, [ids.company,ids.cam,ids.owner]);
    expect((await evidenceRows(cam)).rows).toHaveLength(1);
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,reason,changed_by
      ) SELECT $1,permission.id,'DENY','COMPANY',$2,
        'Remove covered CAM evidence access',$3
      FROM permissions permission WHERE permission.permission_code='delivery.view'
    `, [ids.cam,ids.company,ids.owner]);
    expect((await evidenceRows(cam)).rows).toHaveLength(0);

    const guardedLocationRequest = await createRequest({
      code: "WALLET-PAY-LOCATION-GUARD",
      total: "500.00",
      deliveryFee: "390.00",
    });
    await db.exec(`
      CREATE FUNCTION prompt7_test_location_guard()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'AXORA_BRANCH_DELIVERY_LOCATION_REQUIRED'
          USING ERRCODE='P7301';
      END $$;
      CREATE TRIGGER prompt7_test_location_guard
      BEFORE INSERT ON delivery_jobs
      FOR EACH ROW EXECUTE FUNCTION prompt7_test_location_guard();
    `);
    let guardedLocationResult: { status: string; requestState: string } | undefined;
    try {
      guardedLocationResult = (await asApp(() => db.query<{
        payload: { status: string; requestState: string };
      }>(`
        SELECT axora_approve_and_pay(
          $1,$2,$3,$4,'Keep location guard fully atomic',$5,now()
        ) AS payload
      `, [
        approver.userId,approver.assignmentId,guardedLocationRequest.requestId,
        guardedLocationRequest.revision,randomUUID(),
      ]))).rows[0]?.payload;
    } finally {
      await db.exec(`
        DROP TRIGGER IF EXISTS prompt7_test_location_guard ON delivery_jobs;
        DROP FUNCTION IF EXISTS prompt7_test_location_guard();
      `);
    }
    expect(guardedLocationResult).toMatchObject({
      status: "NOT_READY",
      requestState: "BRANCH_LOCATION_REQUIRED",
    });
    const guardedLocationEvidence = await db.query<{
      approvalState: string; approvalRevision: number; approvals: number;
      reservations: number; invoices: number; payments: number;
    }>(`
      SELECT request.approval_state AS "approvalState",
        request.approval_revision::int AS "approvalRevision",
        (SELECT count(*)::int FROM request_approval_decisions
          WHERE request_id=$1 AND action='APPROVE') AS approvals,
        (SELECT count(*)::int FROM budget_reservations
          WHERE request_id=$1) AS reservations,
        (SELECT count(*)::int FROM invoices WHERE request_id=$1) AS invoices,
        (SELECT count(*)::int FROM company_wallet_ledger_entries
          WHERE request_id=$1 AND entry_type='PAYMENT') AS payments
      FROM requests request WHERE request.id=$1
    `, [guardedLocationRequest.requestId]);
    expect(guardedLocationEvidence.rows[0]).toMatchObject({
      approvalRevision: guardedLocationRequest.revision,
      approvals: 0,
      // Prompt 8 reserves the active scoped budget at submission. The guard
      // failure must not finalize or release that reservation.
      reservations: 1,
      invoices: 0,
      payments: 0,
    });
    expect(guardedLocationEvidence.rows[0]?.approvalState).toMatch(/^PENDING_/);

    const walletShortfall = await createRequest({
      code: "WALLET-PAY-WALLET-SHORT",
      total: "5500.00",
      deliveryFee: "5390.00",
    });
    const walletResult = await asApp(() => db.query<{
      payload: { status: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Keep wallet shortfall mutation free',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,walletShortfall.requestId,
      walletShortfall.revision,randomUUID(),
    ]));
    expect(walletResult.rows[0]!.payload.status).toBe("INSUFFICIENT_WALLET");

    await asApp(() => db.query(`
      SELECT axora_record_company_wallet_top_up(
        $1,$2,$3,NULL,$4::numeric,CURRENT_DATE,'DIRECT-RECEIVED',
        'Externally confirmed direct top-up',$5,now()
      )
    `, [owner.userId,owner.assignmentId,ids.company,"10000.00",randomUUID()]));
    await expect(createRequest({
      code: "WALLET-PAY-BUDGET-SHORT",
      total: "11500.00",
      deliveryFee: "11390.00",
    })).rejects.toMatchObject({ code: "P8207" });
    const deniedEvidence = await db.query<{ count: number }>(`
      SELECT ((SELECT count(*) FROM company_wallet_ledger_entries
        WHERE request_id=$1 AND entry_type='PAYMENT')
        +(SELECT count(*) FROM budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND')
        +(SELECT count(*) FROM invoices
          WHERE request_id=$1 AND direction='CUSTOMER')
        +(SELECT count(*) FROM request_approval_decisions
          WHERE request_id=$1 AND action='APPROVE'))::int AS count
    `, [walletShortfall.requestId]);
    expect(deniedEvidence.rows[0]!.count).toBe(0);

    const selfDenied = await createRequest({
      code: "WALLET-PAY-SELF-DENIED",
      total: "110.00",
      deliveryFee: "0.00",
    });
    await expect(asApp(() => db.query(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Self approval requires explicit authority',$5,now()
      )
    `, [requester.userId,requester.assignmentId,selfDenied.requestId,
      selfDenied.revision,randomUUID()])))
      .rejects.toMatchObject({ code: "42501" });
    await db.query(`
      INSERT INTO role_permissions(role_id,permission_id)
      SELECT role.id,permission.id FROM roles role CROSS JOIN permissions permission
      WHERE role.role_key='REQUESTER'
        AND permission.permission_code IN ('request.approve.self','finance.invoice.view')
      ON CONFLICT DO NOTHING
    `);
    await db.query(`
      INSERT INTO approval_limits(
        role_id,permission_id,scope_type,company_id,branch_id,currency,
        maximum_amount,allow_self_approval,starts_at,active,reason,changed_by
      ) SELECT role.id,permission.id,'BRANCH',$1,$2,'MYR',150,true,
        now()-interval '1 minute',true,'Explicit Prompt 8 self approval authority',$3
      FROM roles role CROSS JOIN permissions permission
      WHERE role.role_key='REQUESTER'
        AND permission.permission_code='request.approve.self'
    `, [ids.company,ids.branch,ids.owner]);
    const selfPaid = await asApp(() => db.query<{
      payload: { status: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Authorized self approval within explicit limit',$5,now()
      ) AS payload
    `, [requester.userId,requester.assignmentId,selfDenied.requestId,
      selfDenied.revision,randomUUID()]));
    expect(selfPaid.rows[0]!.payload.status).toBe("SUCCESS");
    const selfEvidence = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count FROM request_approval_decisions
      WHERE request_id=$1 AND action='APPROVE' AND self_approval
    `, [selfDenied.requestId]);
    expect(selfEvidence.rows[0]!.count).toBe(1);
    const selfOverLimit = await createRequest({
      code: "WALLET-PAY-SELF-LIMIT",
      total: "200.00",
      deliveryFee: "90.00",
    });
    const selfLimited = await asApp(() => db.query<{
      payload: { status: string; requestState: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Self approval must stay within explicit limit',$5,now()
      ) AS payload
    `, [requester.userId,requester.assignmentId,selfOverLimit.requestId,
      selfOverLimit.revision,randomUUID()]));
    expect(selfLimited.rows[0]!.payload).toMatchObject({
      status: "NOT_READY", requestState: "FINAL_PAYMENT_AUTHORITY_REQUIRED",
    });

    const preapproved = await createRequest({
      code: "WALLET-PAY-LIVE-AUTHORITY",
      total: "250.00",
      deliveryFee: "140.00",
    });
    const approval = await asApp(() => db.query<{
      payload: { state: string };
    }>(`
      SELECT axora_decide_request_approval(
        $1,$2,$3,$4,'APPROVE','',NULL,
        'Record independent approval before authority changes',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,preapproved.requestId,
      preapproved.revision,randomUUID(),
    ]));
    expect(approval.rows[0]!.payload.state).toBe("APPROVED");
    const approvalLimitId = (await db.query<{ id: string }>(`
      SELECT approval_limit.id::text AS id
      FROM approval_limits approval_limit
      JOIN roles role ON role.id=approval_limit.role_id
      JOIN permissions permission ON permission.id=approval_limit.permission_id
      WHERE role.role_key='BRANCH_APPROVER'
        AND permission.permission_code='request.approve.other'
        AND approval_limit.company_id=$1 AND approval_limit.branch_id=$2
        AND approval_limit.active
    `, [ids.company,ids.branch])).rows[0]?.id;
    if (!approvalLimitId) throw new Error("Expected live approval limit fixture.");
    await asApp(() => db.query(`
      SELECT * FROM axora_remove_approval_limit(
        $1,$2,$3,'Remove authority before final payment commit'
      )
    `, [owner.userId,owner.assignmentId,approvalLimitId]));
    const lostAuthority = await asApp(() => db.query<{
      payload: { status: string; requestState: string };
    }>(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Payment must reauthorize at commit time',$5,now()
      ) AS payload
    `, [
      approver.userId,approver.assignmentId,preapproved.requestId,
      preapproved.revision+1,randomUUID(),
    ]));
    expect(lostAuthority.rows[0]!.payload).toMatchObject({
      status: "NOT_READY",
      requestState: "FINAL_PAYMENT_AUTHORITY_REQUIRED",
    });
    const lostAuthorityEvidence = await db.query<{ count: number }>(`
      SELECT ((SELECT count(*) FROM invoices WHERE request_id=$1)
        +(SELECT count(*) FROM company_wallet_ledger_entries
          WHERE request_id=$1 AND entry_type='PAYMENT')
        +(SELECT count(*) FROM budget_ledger_entries
          WHERE request_id=$1 AND entry_type='FINAL_SPEND'))::int AS count
    `, [preapproved.requestId]);
    expect(lostAuthorityEvidence.rows[0]!.count).toBe(0);

    const paymentEventId = (await db.query<{ id: string }>(`
      SELECT id::text FROM workflow_events
      WHERE request_id=$1 AND event_key='wallet.payment.recorded'
    `, [successRequest.requestId])).rows[0]?.id;
    if (!paymentEventId) throw new Error("Expected payment workflow event.");
    const recipientBeforeMove = await db.query<{ valid: boolean }>(`
      SELECT axora_workflow_notification_recipient_is_valid(
        $1,$2,$3
      ) AS valid
    `, [ids.company,paymentEventId,approver.userId]);
    expect(recipientBeforeMove.rows[0]!.valid).toBe(true);
    await db.query(`
      UPDATE role_assignments SET active=false,revoked_at=now(),revoked_by=$2,
        revoke_reason='Approver moved out of event resource scope'
      WHERE id=$1
    `, [approver.assignmentId,owner.userId]);
    const recipientAfterMove = await db.query<{ valid: boolean }>(`
      SELECT axora_workflow_notification_recipient_is_valid(
        $1,$2,$3
      ) AS valid
    `, [ids.company,paymentEventId,approver.userId]);
    expect(recipientAfterMove.rows[0]!.valid).toBe(false);
    await expect(asApp(() => db.query(`
      SELECT axora_approve_and_pay(
        $1,$2,$3,$4,'Approve and pay the authorized request',$5,now()
      )
    `, [
      approver.userId,approver.assignmentId,successRequest.requestId,
      successRequest.revision,commandId,
    ]))).rejects.toThrow(/unavailable/i);
  }, 45_000);

  it("rejects account-kind-incompatible explicit permission replacement", async () => {
    const forbiddenPermissions = [
      "finance.wallet.top_up.record",
      "commercial.company_ceiling.override",
      "analytics.revenue.view",
      "finance.manage",
      "finance.match.review",
      "delivery.manage",
      "delivery.assign",
      "delivery.claim",
    ];
    const policy = await db.query<{ permissionCode: string; allowed: boolean }>(`
      SELECT permission_code AS "permissionCode",
        axora_permission_allowed_for_account_kind(
          'COMPANY',permission_code
        ) AS allowed
      FROM unnest($1::text[]) permission_code
      ORDER BY permission_code
    `, [forbiddenPermissions]);
    expect(policy.rows).toHaveLength(forbiddenPermissions.length);
    expect(policy.rows.every((permission) => permission.allowed === false)).toBe(true);

    for (const forbidden of forbiddenPermissions) {
      await expect(asApp(() => db.query(`
        SELECT axora_replace_user_permission_set(
          $1,$2,$3,$4,ARRAY[$5]::text[],
          'Attempt incompatible Company permission replacement',now()
        )
      `, [
        owner.userId,owner.assignmentId,admin.userId,admin.assignmentId,forbidden,
      ]))).rejects.toThrow();
    }
    await expect(db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,reason,changed_by
      ) SELECT $1,permission.id,'GRANT','COMPANY',$2,
        'Attempt direct incompatible grant',$3
      FROM permissions permission WHERE permission.permission_code='delivery.claim'
    `, [admin.userId,ids.company,owner.userId])).rejects.toThrow(/account kind/i);
    const grants = await db.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM user_permission_overrides override_row
      JOIN permissions permission ON permission.id=override_row.permission_id
      WHERE override_row.user_id=$1 AND override_row.active
        AND override_row.effect='GRANT'
        AND permission.permission_code IN (
          'finance.wallet.top_up.record','commercial.company_ceiling.override',
          'analytics.revenue.view','finance.manage','finance.match.review',
          'delivery.manage','delivery.assign','delivery.claim'
        )
    `, [admin.userId]);
    expect(grants.rows[0]!.count).toBe(0);

    // A pre-migration incompatible row remains immutable audit evidence, but
    // the effective snapshot filters it out instead of silently deactivating
    // it without a human permission-change event.
    await db.exec("ALTER TABLE user_permission_overrides DISABLE TRIGGER enforce_permission_account_kind");
    await db.query(`
      INSERT INTO user_permission_overrides(
        user_id,permission_id,effect,scope_type,company_id,reason,changed_by
      ) SELECT $1,permission.id,'GRANT','COMPANY',$2,
        'Historical incompatible grant fixture',$3
      FROM permissions permission
      WHERE permission.permission_code='finance.wallet.top_up.record'
    `, [admin.userId,ids.company,owner.userId]);
    await db.exec("ALTER TABLE user_permission_overrides ENABLE TRIGGER enforce_permission_account_kind");
    const historical = await db.query<{ stored: number; resolved: number }>(`
      SELECT
        (SELECT count(*)::int FROM user_permission_overrides override_row
          JOIN permissions permission ON permission.id=override_row.permission_id
          WHERE override_row.user_id=$1 AND override_row.active
            AND override_row.effect='GRANT'
            AND permission.permission_code='finance.wallet.top_up.record') AS stored,
        (SELECT count(*)::int
          FROM jsonb_array_elements(COALESCE(
            axora_effective_access_snapshot($1,$2,now())->'permissionOverrides',
            '[]'::jsonb
          )) item
          WHERE item->>'permission'='finance.wallet.top_up.record'
            AND item->>'effect'='GRANT') AS resolved
    `, [admin.userId,admin.assignmentId]);
    expect(historical.rows[0]).toEqual({ stored: 1, resolved: 0 });
    const defaults = await db.query<{ roleKey: string; permissionCode: string }>(`
      SELECT role.role_key AS "roleKey",permission.permission_code AS "permissionCode"
      FROM role_permissions role_permission
      JOIN roles role ON role.id=role_permission.role_id
      JOIN permissions permission ON permission.id=role_permission.permission_id
      WHERE role.role_key IN (
        'COMPANY_ADMIN','COMPANY_APPROVER','BRANCH_APPROVER','DEPARTMENT_ADMIN'
      )
        AND permission.permission_code IN (
          'finance.wallet.view','finance.wallet.top_up.request',
          'finance.wallet.top_up.record','finance.invoice.view'
        )
      ORDER BY role.role_key,permission.permission_code
    `);
    expect(defaults.rows).toEqual([
      { roleKey: "BRANCH_APPROVER",permissionCode: "finance.invoice.view" },
      { roleKey: "COMPANY_ADMIN",permissionCode: "finance.invoice.view" },
      { roleKey: "COMPANY_ADMIN",permissionCode: "finance.wallet.top_up.request" },
      { roleKey: "COMPANY_ADMIN",permissionCode: "finance.wallet.view" },
      { roleKey: "COMPANY_APPROVER",permissionCode: "finance.invoice.view" },
      { roleKey: "DEPARTMENT_ADMIN",permissionCode: "finance.invoice.view" },
    ]);
  }, 30_000);

  it("keeps canonical request-period-company finance lock ordering", async () => {
    const approveAndPayDefinition = await db.query<{ definition: string }>(`
      SELECT pg_get_functiondef(
        'axora_approve_and_pay_internal(uuid,uuid,uuid,integer,text,uuid,timestamptz,boolean)'
          ::regprocedure
      ) AS definition
    `);
    const definition = approveAndPayDefinition.rows[0]!.definition;
    const branchLock = definition.indexOf("FROM public.branches branch");
    const locationLock = definition.indexOf("FROM public.delivery_locations location");
    const periodLock = definition.indexOf("FROM public.budget_periods period");
    const companyLock = definition.indexOf(
      "FROM public.companies company\n    WHERE company.id=request_row.company_id FOR UPDATE",
    );
    expect(branchLock).toBeGreaterThan(-1);
    expect(locationLock).toBeGreaterThan(branchLock);
    expect(periodLock).toBeGreaterThan(locationLock);
    expect(companyLock).toBeGreaterThan(periodLock);
  }, 30_000);
});

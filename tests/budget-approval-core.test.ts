import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/pglite";

const ids = {
  company: "71000000-0000-4000-8000-000000000001",
  branch: "71000000-0000-4000-8000-000000000002",
  requester: "71000000-0000-4000-8000-000000000003",
  approver: "71000000-0000-4000-8000-000000000004",
  requesterAssignment: "71000000-0000-4000-8000-000000000005",
  approverAssignment: "71000000-0000-4000-8000-000000000006",
  admin: "71000000-0000-4000-8000-000000000007",
  adminAssignment: "71000000-0000-4000-8000-000000000008",
};

type Fixture = {
  db: PGlite;
  requestId: string;
  accountId: string;
  periodId: string;
};

async function addApprovalLimit(
  db: PGlite,
  roleId: string,
  permissionCode: string,
  maximumAmount: number,
) {
  await db.query(`
    INSERT INTO approval_limits(
      role_id,permission_id,scope_type,company_id,branch_id,currency,
      maximum_amount,allow_self_approval,starts_at,active,reason,changed_by
    ) VALUES (
      $1,(SELECT id FROM permissions WHERE permission_code=$2),
      'BRANCH',$3,$4,'MYR',$5,false,now()-interval '1 minute',true,
      'Focused budget approval test authority',$6
    )
    ON CONFLICT DO NOTHING
  `, [roleId, permissionCode, ids.company, ids.branch, maximumAmount, ids.approver]);
}

async function insertRequest(db: PGlite, code: string, amount: number) {
  const result = await db.query<{ id: string }>(`
    INSERT INTO requests(
      order_code,request_date,request_type_id,company_id,branch_id,
      department,requested_by,requester_contact,needed_by_date,urgency_id,
      status_id,notes,created_by,estimated_delivery_fee,tax_rate,tax_amount,
      client_submission_key
    ) VALUES (
      $1,CURRENT_DATE,lookup_id('request_type','Standard'),$2,$3,
      'Operations','Budget requester','requester-budget@example.test',
      CURRENT_DATE+7,lookup_id('urgency','Normal'),
      lookup_id('request_status','New Request'),'Focused approval request',$4,
      $5,0,0,gen_random_uuid()
    ) RETURNING id::text
  `, [code, ids.company, ids.branch, ids.requester, amount]);
  const requestId = result.rows[0].id;
  await db.query(
    "SELECT axora_initialize_request_approval($1,$2,$3,$4,now())",
    [ids.requester, ids.requesterAssignment, requestId, `submit-${code}`],
  );
  return requestId;
}

async function fixture(): Promise<Fixture> {
  const db = new PGlite();
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  const roles = await db.query<{ requester: string; approver: string; admin: string }>(`
    SELECT
      (SELECT id::text FROM roles WHERE role_key='REQUESTER') AS requester,
      (SELECT id::text FROM roles WHERE role_key='BRANCH_APPROVER') AS approver,
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN') AS admin
  `);
  const role = roles.rows[0];

  await db.query(`
    INSERT INTO companies(id,company_code,name,active)
    VALUES ($1,'BUDGET-CORE','Budget core company',true)
  `, [ids.company]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,
      monthly_budget,active
    ) VALUES ($1,'BUDGET-BRANCH',$2,'Budget branch','BUDGET-BRANCH',
      'Test delivery address',5000,true)
  `, [ids.branch, ids.company]);
  await db.query(
    "UPDATE companies SET contractual_ceiling=12000 WHERE id=$1",
    [ids.company],
  );
  await db.query(`
    INSERT INTO users(
      id,email,display_name,password_hash,role_id,company_id,branch_id,
      is_owner,account_setup_completed_at,account_kind,account_status,
      active,auth_version
    ) VALUES
      ($1,'requester-budget@example.test','Budget requester','not-a-real-hash',
        $5,$3,$4,false,now(),'COMPANY','ACTIVE',true,1),
      ($2,'approver-budget@example.test','Budget approver','not-a-real-hash',
        $6,$3,$4,false,now(),'COMPANY','ACTIVE',true,1),
      ($7,'admin-budget@example.test','Budget administrator','not-a-real-hash',
        $8,$3,NULL,false,now(),'COMPANY','ACTIVE',true,1)
  `, [ids.requester, ids.approver, ids.company, ids.branch, role.requester,
    role.approver, ids.admin, role.admin]);
  await db.query(`
    INSERT INTO company_memberships(user_id,company_id,status,is_primary,joined_at)
    VALUES
      ($1,$4,'ACTIVE',true,now()),($2,$4,'ACTIVE',true,now()),
      ($3,$4,'ACTIVE',true,now())
  `, [ids.requester, ids.approver, ids.admin, ids.company]);
  await db.query(`
    INSERT INTO branch_assignments(user_id,company_id,branch_id,status,is_primary)
    VALUES
      ($1,$3,$4,'ACTIVE',true),($2,$3,$4,'ACTIVE',true)
  `, [ids.requester, ids.approver, ids.company, ids.branch]);
  await db.query(`
    INSERT INTO role_assignments(
      id,user_id,role_id,scope_type,company_id,branch_id,active
    ) VALUES
      ($1,$3,$5,'BRANCH',$7,$8,true),
      ($2,$4,$6,'BRANCH',$7,$8,true),
      ($9,$10,$11,'COMPANY',$7,NULL,true)
  `, [ids.requesterAssignment, ids.approverAssignment, ids.requester,
    ids.approver, role.requester, role.approver, ids.company, ids.branch,
    ids.adminAssignment, ids.admin, role.admin]);
  await addApprovalLimit(db, role.approver, "request.approve.other", 10_000);

  const account = await db.query<{ accountId: string; periodId: string }>(`
    SELECT account.id::text AS "accountId",period.id::text AS "periodId"
    FROM budget_accounts account
    JOIN budget_periods period ON period.budget_account_id=account.id
      AND period.status='ACTIVE'
    WHERE account.branch_id=$1
  `, [ids.branch]);
  const requestId = await insertRequest(db, "BUDGET-REQ-1", 1000);
  return {
    db,
    requestId,
    accountId: account.rows[0].accountId,
    periodId: account.rows[0].periodId,
  };
}

async function approve(db: PGlite, requestId: string, revision: number, key: string) {
  return db.query<{ payload: Record<string, unknown> }>(`
    SELECT axora_decide_request_approval(
      $1,$2,$3,$4,'APPROVE',NULL,NULL,$5,$6,now()
    ) AS payload
  `, [ids.approver, ids.approverAssignment, requestId, revision,
    "Authorized focused approval", key]);
}

describe("transactional budget and approval core", () => {
  it("installs forward, seeds current periods, and reconstructs balances from append-only entries", async () => {
    const context = await fixture();
    try {
      const state = await context.db.query<{
        allocated: number;
        available: number;
        pending: number;
        policyCount: number;
      }>(`
        SELECT balance.allocated::float8 AS allocated,
          balance.available::float8 AS available,
          balance.pending_approval::float8 AS pending,
          (SELECT count(*)::int FROM request_approval_policies
            WHERE company_id=$2 AND status='ACTIVE') AS "policyCount"
        FROM v_budget_period_balances balance
        WHERE balance.budget_period_id=$1
      `, [context.periodId, ids.company]);
      expect(state.rows[0]).toEqual({
        allocated: 5000,
        available: 5000,
        pending: 1000,
        policyCount: 1,
      });
      await expect(context.db.query(
        "UPDATE budget_ledger_entries SET explanation='mutated' WHERE budget_period_id=$1",
        [context.periodId],
      )).rejects.toThrow(/append-only/i);
      await expect(context.db.query(
        "DELETE FROM request_approval_snapshots WHERE request_id=$1",
        [context.requestId],
      )).rejects.toThrow(/append-only/i);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("filters approval and budget workspaces in PostgreSQL before returning rows", async () => {
    const context = await fixture();
    try {
      const otherCompany = "71000000-0000-4000-8000-000000000030";
      const otherBranch = "71000000-0000-4000-8000-000000000031";
      await context.db.query(`
        INSERT INTO companies(id,company_code,name,active)
        VALUES ($1,'OTHER-BUDGET','Other budget company',true)
      `, [otherCompany]);
      await context.db.query(`
        INSERT INTO branches(
          id,branch_code_id,company_id,name,branch_code,delivery_address,
          monthly_budget,active
        ) VALUES ($1,'OTHER-BUDGET-BRANCH',$2,'Other branch','OTHER-BUDGET-BRANCH',
          'Other tenant address',9000,true)
      `, [otherBranch, otherCompany]);
      const outside = await context.db.query<{ id: string }>(`
        INSERT INTO requests(
          order_code,request_date,request_type_id,company_id,branch_id,
          department,requested_by,requester_contact,needed_by_date,urgency_id,
          status_id,notes,created_by,estimated_delivery_fee,tax_rate,tax_amount,
          client_submission_key
        ) VALUES (
          'OTHER-TENANT-REQUEST',CURRENT_DATE,lookup_id('request_type','Standard'),
          $1,$2,'Operations','Outside requester','outside@example.test',
          CURRENT_DATE+7,lookup_id('urgency','Normal'),
          lookup_id('request_status','New Request'),'Outside tenant request',$3,
          50,0,0,gen_random_uuid()
        ) RETURNING id::text
      `, [otherCompany, otherBranch, ids.requester]);
      await context.db.query(
        "UPDATE requests SET approval_state='PENDING_COMPANY' WHERE id=$1",
        [outside.rows[0].id],
      );
      await context.db.query(`
        INSERT INTO request_approval_snapshots(
          request_id,request_version,company_id,policy_id,policy_version,
          amount,currency,snapshot,snapshot_hash,created_by
        )
        SELECT request.id,request.request_version,request.company_id,policy.id,
          policy.policy_version,50,'MYR',jsonb_build_object('lines','[]'::jsonb),
          repeat('0',64),$2
        FROM requests request
        JOIN request_approval_policies policy ON policy.id=request.approval_policy_id
        WHERE request.id=$1
      `, [outside.rows[0].id, ids.requester]);
      const queue = await context.db.query<{ payload: { requests: Array<{ id: string }> } }>(
        "SELECT axora_request_approval_workspace($1,$2,now()) AS payload",
        [ids.approver, ids.approverAssignment],
      );
      const budget = await context.db.query<{ payload: { accounts: Array<{ id: string }> } }>(
        "SELECT axora_budget_workspace($1,$2,now()) AS payload",
        [ids.approver, ids.approverAssignment],
      );
      expect(queue.rows[0].payload.requests.map((item) => item.id)).toEqual([
        context.requestId,
      ]);
      expect(queue.rows[0].payload.requests[0]).not.toHaveProperty("companyCeiling");
      expect(budget.rows[0].payload.accounts.map((item) => item.id)).toEqual([
        context.accountId,
      ]);
      const choices = await context.db.query<{ payload: { accounts: Record<string, unknown>[] } }>(
        "SELECT axora_request_budget_choices($1,$2,now()) AS payload",
        [ids.requester, ids.requesterAssignment],
      );
      expect(choices.rows[0].payload.accounts[0]).not.toHaveProperty("companyCeiling");
      await expect(context.db.query(
        "SELECT axora_decide_request_approval($1,$2,$3,1,'APPROVE',NULL,NULL,'No access','outside-key-1',now())",
        [ids.requester, ids.requesterAssignment, context.requestId],
      )).rejects.toThrow(/unavailable/i);
      await context.db.exec("SET SESSION AUTHORIZATION axora_app");
      await expect(context.db.query(`
        INSERT INTO approvals(
          request_id,approval_type,status,reviewer_id,reason,decided_at
        ) VALUES ($1,'Company approval','Approved',$2,'Legacy bypass',now())
      `, [context.requestId, ids.approver])).rejects.toThrow(/versioned/i);
      await context.db.exec("RESET SESSION AUTHORIZATION");
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("records approval and reservation atomically and makes retry idempotent", async () => {
    const context = await fixture();
    try {
      const first = await approve(context.db, context.requestId, 1, "approve-idempotent-1");
      const repeated = await approve(context.db, context.requestId, 1, "approve-idempotent-1");
      expect(repeated.rows[0].payload).toEqual(first.rows[0].payload);
      const evidence = await context.db.query<{
        state: string;
        revision: number;
        reservations: number;
        available: number;
        reserved: number;
        pending: number;
        jobs: number;
      }>(`
        SELECT request.approval_state AS state,
          request.approval_revision::int AS revision,
          (SELECT count(*)::int FROM budget_reservations WHERE request_id=request.id)
            AS reservations,
          balance.available::float8 AS available,
          balance.reserved::float8 AS reserved,
          balance.pending_approval::float8 AS pending,
          (SELECT count(*)::int FROM request_approval_outbox
            WHERE request_id=request.id) AS jobs
        FROM requests request
        JOIN v_budget_period_balances balance
          ON balance.budget_period_id=request.budget_period_id
        WHERE request.id=$1
      `, [context.requestId]);
      expect(evidence.rows[0]).toEqual({
        state: "APPROVED",
        revision: 2,
        reservations: 1,
        available: 4000,
        reserved: 1000,
        pending: 0,
        jobs: 4,
      });
      await expect(approve(context.db, context.requestId, 1, "stale-approval-2"))
        .rejects.toThrow(/changed|no longer/i);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("serializes simultaneous decisions so only one reservation can exist", async () => {
    const context = await fixture();
    try {
      const results = await Promise.allSettled([
        approve(context.db, context.requestId, 1, "concurrent-approval-a"),
        approve(context.db, context.requestId, 1, "concurrent-approval-b"),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const count = await context.db.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM budget_reservations WHERE request_id=$1",
        [context.requestId],
      );
      expect(count.rows[0].count).toBe(1);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("applies authorized adjustments and transfers, rejects negative availability, and refreshes periods", async () => {
    const context = await fixture();
    try {
      await context.db.query(`
        SELECT axora_adjust_budget_allocation(
          $1,$2,$3,'INCREASE',500,false,'TEST_INCREASE',
          'Focused authorized allocation increase',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId]);
      await context.db.query(`
        SELECT axora_adjust_budget_allocation(
          $1,$2,$3,'INCREASE',500,false,'TEST_INCREASE',
          'Focused authorized allocation increase',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId]);
      await context.db.query(`
        SELECT axora_adjust_budget_allocation(
          $1,$2,$3,'REDUCE',200,false,'TEST_DECREASE',
          'Focused authorized allocation decrease',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId]);
      await expect(context.db.query(`
        SELECT axora_adjust_budget_allocation(
          $1,$2,$3,'REDUCE',999999,false,'TEST_DECREASE',
          'Attempt to create negative availability',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId])).rejects.toThrow(/available|negative|exceed/i);

      const secondBranch = "71000000-0000-4000-8000-000000000020";
      await context.db.query(`
        INSERT INTO branches(
          id,branch_code_id,company_id,name,branch_code,delivery_address,
          monthly_budget,active
        ) VALUES ($1,'BUDGET-BRANCH-2',$2,'Second budget branch','BUDGET-BRANCH-2',
          'Second test address',1000,true)
      `, [secondBranch, ids.company]);
      const target = await context.db.query<{ id: string }>(`
        SELECT id::text FROM budget_accounts WHERE branch_id=$1
      `, [secondBranch]);
      await context.db.query(`
        SELECT axora_transfer_budget_allocation(
          $1,$2,$3,$4,300,false,'TEST_TRANSFER',
          'Focused authorized branch transfer',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId, target.rows[0].id]);
      await context.db.query(`
        SELECT axora_transfer_budget_allocation(
          $1,$2,$3,$4,300,false,'TEST_TRANSFER',
          'Focused authorized branch transfer',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId, target.rows[0].id]);
      const transfer = await context.db.query<{ source: number; target: number }>(`
        SELECT
          (SELECT available::float8 FROM v_budget_period_balances balance
            JOIN budget_periods period ON period.id=balance.budget_period_id
            WHERE period.budget_account_id=$1 AND period.status='ACTIVE') AS source,
          (SELECT available::float8 FROM v_budget_period_balances balance
            JOIN budget_periods period ON period.id=balance.budget_period_id
            WHERE period.budget_account_id=$2 AND period.status='ACTIVE') AS target
      `, [context.accountId, target.rows[0].id]);
      expect(transfer.rows[0]).toEqual({ source: 5000, target: 1300 });
      await context.db.query(`
        SELECT axora_set_budget_allocation(
          $1,$2,$3,4500,'Absolute recurring branch authorization',
          'absolute-budget-set-1',now()
        )
      `, [ids.admin, ids.adminAssignment, context.accountId]);
      const absolute = await context.db.query<{
        recurring: number;
        projection: number;
        available: number;
      }>(`
        SELECT account.recurring_allocation::float8 AS recurring,
          branch.monthly_budget::float8 AS projection,
          balance.available::float8 AS available
        FROM budget_accounts account
        JOIN branches branch ON branch.id=account.branch_id
        JOIN budget_periods period ON period.budget_account_id=account.id
          AND period.status='ACTIVE'
        JOIN v_budget_period_balances balance ON balance.budget_period_id=period.id
        WHERE account.id=$1
      `, [context.accountId]);
      expect(absolute.rows[0]).toEqual({
        recurring: 4500,
        projection: 4500,
        available: 4500,
      });

      const current = await context.db.query<{ endsAt: string }>(`
        SELECT ends_at::text AS "endsAt" FROM budget_periods WHERE id=$1
      `, [context.periodId]);
      const refreshAt = new Date(new Date(current.rows[0].endsAt).getTime()+1000).toISOString();
      await context.db.query(`
        SELECT axora_refresh_budget_period(
          $1,$2,$3,'TEST_REFRESH','Focused period refresh',$4
        )
      `, [ids.admin, ids.adminAssignment, context.accountId, refreshAt]);
      const periods = await context.db.query<{
        status: string;
        allocationMethod: string;
        expired: number;
      }>(`
        SELECT period.status,period.allocation_method AS "allocationMethod",
          COALESCE(balance.expired_amount,0)::float8 AS expired
        FROM budget_periods period
        LEFT JOIN v_budget_period_balances balance ON balance.budget_period_id=period.id
        WHERE period.budget_account_id=$1 ORDER BY period.starts_at
      `, [context.accountId]);
      expect(periods.rows.map((period) => period.status)).toEqual(["CLOSED", "ACTIVE"]);
      expect(periods.rows[1].allocationMethod).toBe("REFRESH");
      expect(periods.rows[0].expired).toBeGreaterThan(0);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("carries only the configured capped rollover into a reconstructable next period", async () => {
    const context = await fixture();
    try {
      await context.db.query(`
        UPDATE budget_accounts SET rollover_policy='CAPPED',rollover_cap=300
        WHERE id=$1
      `, [context.accountId]);
      const current = await context.db.query<{ endsAt: string }>(`
        SELECT ends_at::text AS "endsAt" FROM budget_periods WHERE id=$1
      `, [context.periodId]);
      const refreshAt = new Date(new Date(current.rows[0].endsAt).getTime()+1000).toISOString();
      await context.db.query(`
        SELECT axora_refresh_budget_period(
          $1,$2,$3,'Capped rollover period refresh','capped-rollover-1',$4
        )
      `, [ids.admin, ids.adminAssignment, context.accountId, refreshAt]);
      const balances = await context.db.query<{
        status: string;
        allocated: number;
        available: number;
        rollover: number;
        expired: number;
      }>(`
        SELECT period.status,balance.allocated::float8 AS allocated,
          balance.available::float8 AS available,
          balance.rollover_brought_forward::float8 AS rollover,
          balance.expired_amount::float8 AS expired
        FROM budget_periods period
        JOIN v_budget_period_balances balance ON balance.budget_period_id=period.id
        WHERE period.budget_account_id=$1 ORDER BY period.starts_at
      `, [context.accountId]);
      expect(balances.rows).toEqual([
        { status: "CLOSED", allocated: 5000, available: 0, rollover: 0, expired: 5000 },
        { status: "ACTIVE", allocated: 5300, available: 5300, rollover: 300, expired: 0 },
      ]);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("escalates budget and ceiling exceptions without creating a reservation", async () => {
    const context = await fixture();
    try {
      const budgetRequest = await insertRequest(context.db, "BUDGET-REQ-OVER", 6000);
      const budgetResult = await approve(
        context.db,
        budgetRequest,
        1,
        "over-budget-escalation",
      );
      expect(budgetResult.rows[0].payload).toMatchObject({
        state: "PENDING_COMPANY",
        escalationType: "BUDGET_AVAILABLE",
      });
      await context.db.query(
        "UPDATE companies SET contractual_ceiling=5000 WHERE id=$1",
        [ids.company],
      );
      const ceilingRequest = await insertRequest(context.db, "BUDGET-REQ-CEILING", 5100);
      const ceilingResult = await approve(
        context.db,
        ceilingRequest,
        1,
        "ceiling-escalation",
      );
      expect(ceilingResult.rows[0].payload).toMatchObject({
        state: "PENDING_AXORA",
        escalationType: "COMPANY_CEILING",
      });
      const reservations = await context.db.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM budget_reservations
        WHERE request_id IN ($1,$2)
      `, [budgetRequest, ceilingRequest]);
      expect(reservations.rows[0].count).toBe(0);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("records limit escalation, return, and rejection as immutable transitions", async () => {
    const context = await fixture();
    try {
      const limitRequest = await insertRequest(context.db, "BUDGET-REQ-LIMIT", 11_000);
      await context.db.query(
        "UPDATE requests SET approval_state='PENDING_DEPARTMENT' WHERE id=$1",
        [limitRequest],
      );
      const limited = await approve(context.db, limitRequest, 1, "limit-escalation");
      expect(limited.rows[0].payload).toMatchObject({
        state: "PENDING_COMPANY",
        escalationType: "APPROVAL_LIMIT",
      });

      const returnedRequest = await insertRequest(context.db, "BUDGET-REQ-RETURN", 200);
      await context.db.query(`
        SELECT axora_decide_request_approval(
          $1,$2,$3,1,'RETURN',NULL,NULL,'Clarify requested quantities',
          'return-decision-1',now()
        )
      `, [ids.approver, ids.approverAssignment, returnedRequest]);
      const rejectedRequest = await insertRequest(context.db, "BUDGET-REQ-REJECT", 250);
      await context.db.query(`
        SELECT axora_decide_request_approval(
          $1,$2,$3,1,'REJECT',NULL,NULL,'Request is not authorized',
          'reject-decision-1',now()
        )
      `, [ids.approver, ids.approverAssignment, rejectedRequest]);
      const closed = await context.db.query<{
        code: string;
        state: string;
        pending: number;
      }>(`
        SELECT request.order_code AS code,request.approval_state AS state,
          COALESCE(sum(entry.pending_delta),0)::float8 AS pending
        FROM requests request
        LEFT JOIN budget_ledger_entries entry ON entry.request_id=request.id
        WHERE request.id IN ($1,$2)
        GROUP BY request.id ORDER BY request.order_code
      `, [returnedRequest, rejectedRequest]);
      expect(closed.rows).toEqual([
        { code: "BUDGET-REQ-REJECT", state: "REJECTED", pending: 0 },
        { code: "BUDGET-REQ-RETURN", state: "RETURNED", pending: 0 },
      ]);
      const legacy = await context.db.query<{ status: string }>(`
        SELECT status FROM approvals WHERE request_id=$1
      `, [rejectedRequest]);
      expect(legacy.rows).toEqual([{ status: "Rejected" }]);
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("releases cancellation and lower actual differences and gates higher actuals", async () => {
    const context = await fixture();
    try {
      await approve(context.db, context.requestId, 1, "approve-before-cancel");
      await context.db.query(`
        SELECT axora_decide_request_approval(
          $1,$2,$3,2,'CANCEL',NULL,NULL,'Requester cancelled','cancel-release-1',now()
        )
      `, [ids.requester, ids.requesterAssignment, context.requestId]);
      const cancelled = await context.db.query<{ available: number; status: string }>(`
        SELECT balance.available::float8 AS available,reservation.status
        FROM requests request
        JOIN v_budget_period_balances balance
          ON balance.budget_period_id=request.budget_period_id
        JOIN budget_reservations reservation ON reservation.request_id=request.id
        WHERE request.id=$1
      `, [context.requestId]);
      expect(cancelled.rows[0]).toEqual({ available: 5000, status: "RELEASED" });

      const lowerRequest = await insertRequest(context.db, "BUDGET-REQ-LOWER", 1000);
      await approve(context.db, lowerRequest, 1, "approve-lower-actual");
      const finalized = await context.db.query<{ payload: Record<string, unknown> }>(`
        SELECT axora_finalize_request_budget(
          $1,$2,$3,800,'Final invoice lower than authorization','final-lower-1',now()
        ) AS payload
      `, [ids.approver, ids.approverAssignment, lowerRequest]);
      expect(finalized.rows[0].payload).toMatchObject({
        state: "AWAITING_FULFILMENT",
        releasedAmount: "200.00",
      });
      expect(Number(finalized.rows[0].payload.actualAmount)).toBe(800);

      const higherRequest = await insertRequest(context.db, "BUDGET-REQ-HIGHER", 500);
      await approve(context.db, higherRequest, 1, "approve-higher-actual");
      const additional = await context.db.query<{ payload: Record<string, unknown> }>(`
        SELECT axora_finalize_request_budget(
          $1,$2,$3,700,'Additional actual needs approval','final-higher-1',now()
        ) AS payload
      `, [ids.approver, ids.approverAssignment, higherRequest]);
      expect(additional.rows[0].payload).toMatchObject({
        state: "PENDING_COMPANY",
        action: "ADDITIONAL_ACTUAL_REQUIRED",
      });
    } finally {
      await context.db.close();
    }
  }, 45_000);

  it("keeps raw financial and approval evidence inaccessible to the app role", async () => {
    const context = await fixture();
    try {
      const privileges = await context.db.query<{
        ledger: boolean;
        decisions: boolean;
        outbox: boolean;
        workspace: boolean;
        internalPost: boolean;
      }>(`
        SELECT
          has_table_privilege('axora_app','budget_ledger_entries','SELECT') AS ledger,
          has_table_privilege('axora_app','request_approval_decisions','SELECT') AS decisions,
          has_table_privilege('axora_app','request_approval_outbox','SELECT') AS outbox,
          has_function_privilege('axora_app',
            'axora_request_approval_workspace(uuid,uuid,timestamptz)','EXECUTE') AS workspace,
          has_function_privilege('axora_app',
            'axora_post_budget_entry_internal(uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,uuid,integer,uuid,uuid,text,uuid,uuid,uuid,text,text,text,uuid,text,timestamptz)',
            'EXECUTE') AS "internalPost"
      `);
      expect(privileges.rows[0]).toEqual({
        ledger: false,
        decisions: false,
        outbox: false,
        workspace: true,
        internalPost: false,
      });
    } finally {
      await context.db.close();
    }
  }, 45_000);
});

describe("budget and approval presentation contracts", () => {
  it("keeps migration and UI contracts explicit, localized and RTL-safe", async () => {
    const migration = await readFile(
      new URL("../database/migrations/057_request_approval_state_machine.sql", import.meta.url),
      "utf8",
    );
    const i18n = await readFile(
      new URL("../src/lib/budget-approval-i18n.ts", import.meta.url),
      "utf8",
    );
    const styles = await readFile(
      new URL("../src/app/(portal)/budget-approval.module.css", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("request.approve.self");
    expect(migration).toContain("commercial.company_ceiling.override");
    expect(migration).toContain("PENDING_EXPOSURE_REMOVE");
    expect(migration).toContain("FULFILMENT_CREATE");
    expect(i18n).toContain("en:");
    expect(i18n).toContain("ar:");
    expect(i18n).toContain("ms:");
    expect(styles).toContain("inset-inline-end");
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).not.toMatch(/\b(?:margin-left|margin-right|padding-left|padding-right|left|right)\s*:/);
  });
});

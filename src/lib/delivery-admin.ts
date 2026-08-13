import { randomUUID } from "node:crypto";
import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
  notifyWorkflowUsers,
} from "./workflow-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireDeliveryManager(actor: SessionUser) {
  if (!canAccess(actor, "manage_deliveries")) {
    throw new Error("Only authorized Axora operations users can manage delivery assignments.");
  }
}

export interface DeliveryAgentOption {
  id: string;
  name: string;
  email: string;
}

export interface DeliveryJobSummary {
  id: string;
  requestId: string;
  companyId: string;
  branchId: string;
  jobCode: string;
  orderCode: string;
  companyName: string;
  branchName: string;
  status: string;
  windowStart?: string;
  windowEnd?: string;
  driverName?: string;
  driverUserId?: string;
  assignmentStatus?: string;
  packageSummary: string;
  lastEvent?: string;
  lastEventAt?: string;
}

export async function listDeliveryAgents(actor: SessionUser): Promise<DeliveryAgentOption[]> {
  requireDeliveryManager(actor);
  if (isDemoMode()) return [];
  return withAuditTransaction({ actor, reason: "Viewed active Delivery Guys" }, async (client) => {
    const result = await client.query<DeliveryAgentOption>(`
      SELECT account.id::text,profile.display_name AS name,account.email
      FROM delivery_agent_profiles driver
      JOIN users account ON account.id=driver.user_id
      JOIN user_profiles profile ON profile.user_id=account.id
      WHERE driver.active AND account.active AND account.account_status='ACTIVE'
      ORDER BY profile.display_name,account.email
    `);
    return result.rows;
  });
}

export async function listDeliveryJobs(actor: SessionUser): Promise<DeliveryJobSummary[]> {
  requireDeliveryManager(actor);
  if (isDemoMode()) return [];
  return withAuditTransaction({ actor, reason: "Viewed delivery administration" }, async (client) => {
    const result = await client.query<DeliveryJobSummary>(`
      SELECT job.id::text,job.request_id::text AS "requestId",
        job.company_id::text AS "companyId",job.branch_id::text AS "branchId",
        job.job_code AS "jobCode",request.order_code AS "orderCode",
        company.name AS "companyName",branch.name AS "branchName",job.status,
        job.scheduled_window_start::text AS "windowStart",
        job.scheduled_window_end::text AS "windowEnd",
        driver_profile.display_name AS "driverName",
        assignment.driver_user_id::text AS "driverUserId",
        assignment.status AS "assignmentStatus",
        COALESCE(lines.summary,'No package lines') AS "packageSummary",
        latest.event_type AS "lastEvent",latest.client_recorded_at::text AS "lastEventAt"
      FROM delivery_jobs job
      JOIN requests request ON request.id=job.request_id
      JOIN companies company ON company.id=job.company_id
      JOIN branches branch ON branch.id=job.branch_id
      LEFT JOIN LATERAL (
        SELECT current_assignment.* FROM delivery_job_assignments current_assignment
        WHERE current_assignment.delivery_job_id=job.id
        ORDER BY (current_assignment.status IN ('ASSIGNED','ACCEPTED')) DESC,
          current_assignment.assigned_at DESC LIMIT 1
      ) assignment ON true
      LEFT JOIN user_profiles driver_profile ON driver_profile.user_id=assignment.driver_user_id
      LEFT JOIN LATERAL (
        SELECT string_agg(line.product_name_snapshot || ' × '
          || job_line.quantity_to_deliver::text || ' '
          || job_line.unit_of_measure_snapshot, ', ' ORDER BY line.product_name_snapshot) AS summary
        FROM delivery_job_lines job_line
        JOIN request_lines line ON line.id=job_line.request_line_id
        WHERE job_line.delivery_job_id=job.id
      ) lines ON true
      LEFT JOIN LATERAL (
        SELECT event_type,client_recorded_at FROM delivery_job_events event
        WHERE event.delivery_job_id=job.id
        ORDER BY received_at DESC,id DESC LIMIT 1
      ) latest ON true
      ORDER BY (job.status NOT IN ('DELIVERED','FAILED','CANCELLED')) DESC,
        job.scheduled_window_start NULLS LAST,job.created_at DESC
    `);
    return result.rows;
  });
}

export async function createDeliveryJob(actor: SessionUser, input: {
  requestId: string;
  windowStart?: string;
  windowEnd?: string;
  instructions?: string;
  idempotencyKey: string;
}) {
  requireDeliveryManager(actor);
  if (!UUID_PATTERN.test(input.requestId) || !UUID_PATTERN.test(input.idempotencyKey)) {
    throw new Error("Delivery request identifiers are invalid.");
  }
  const windowStart = input.windowStart ? new Date(input.windowStart) : undefined;
  const windowEnd = input.windowEnd ? new Date(input.windowEnd) : undefined;
  if ((windowStart && Number.isNaN(windowStart.getTime()))
    || (windowEnd && Number.isNaN(windowEnd.getTime()))
    || (windowStart && windowEnd && windowEnd <= windowStart)) {
    throw new Error("Delivery window must end after it starts.");
  }
  if (isDemoMode()) return "demo-delivery-job";
  return withAuditTransaction({ actor, reason: "Created delivery job" }, async (client) => {
    const request = await client.query<{
      companyId: string;
      branchId: string;
      orderCode: string;
      address: string;
      contactName: string;
      contactPhone: string;
    }>(`
      SELECT request.company_id::text AS "companyId",request.branch_id::text AS "branchId",
        request.order_code AS "orderCode",branch.delivery_address AS address,
        branch.contact_name AS "contactName",branch.contact_phone AS "contactPhone"
      FROM requests request
      JOIN branches branch ON branch.id=request.branch_id AND branch.company_id=request.company_id
      JOIN lookup_values status ON status.id=request.status_id
      WHERE request.id=$1 AND branch.active
        AND status.label IN ('Supplier Assigned','Ordered','Preparing for Delivery','Out for Delivery')
        AND EXISTS (
          SELECT 1 FROM approvals approval
          WHERE approval.request_id=request.id AND approval.approval_type='Company approval'
            AND approval.status='Approved'
        )
      FOR UPDATE OF request,branch
    `, [input.requestId]);
    const linked = request.rows[0];
    if (!linked) throw new Error("Only an approved, sourced request can become a delivery job.");
    const existing = await client.query<{ id: string }>(`
      SELECT id::text FROM delivery_jobs WHERE company_id=$1 AND idempotency_key=$2
    `, [linked.companyId, input.idempotencyKey]);
    if (existing.rows[0]) return existing.rows[0].id;

    const jobId = randomUUID();
    const jobCode = `DLV-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${jobId.slice(0,8).toUpperCase()}`;
    await client.query(`
      INSERT INTO delivery_jobs(
        id,company_id,branch_id,request_id,job_code,status,
        scheduled_window_start,scheduled_window_end,delivery_address_snapshot,
        contact_name_snapshot,contact_phone_snapshot,instructions,idempotency_key,created_by
      ) VALUES ($1,$2,$3,$4,$5,'CREATED',$6,$7,$8,$9,$10,$11,$12,$13)
    `, [jobId,linked.companyId,linked.branchId,input.requestId,jobCode,
      windowStart?.toISOString() ?? null,windowEnd?.toISOString() ?? null,
      linked.address,linked.contactName,linked.contactPhone,
      input.instructions?.trim().slice(0,2_000) || null,input.idempotencyKey,actor.id]);

    const lines = await client.query<{
      id: string;
      quantity: number;
      unit: string;
      received: number;
      reserved: number;
    }>(`
      SELECT line.id::text,line.quantity::float8 AS quantity,
        line.unit_of_measure AS unit,
        axora_received_quantity(line.id)::float8 AS received,
        COALESCE((SELECT sum(job_line.quantity_to_deliver)
          FROM delivery_job_lines job_line
          JOIN delivery_jobs prior_job ON prior_job.id=job_line.delivery_job_id
          WHERE job_line.request_line_id=line.id
            AND (
              prior_job.status IN ('CREATED','ASSIGNED','ACCEPTED','EN_ROUTE','ARRIVED')
              OR (
                prior_job.status='DELIVERED'
                AND NOT EXISTS (
                  SELECT 1 FROM receipt_lines receipt_line
                  WHERE receipt_line.delivery_job_line_id=job_line.id
                )
              )
            )),0)::float8 AS reserved
      FROM request_lines line WHERE line.request_id=$1 FOR UPDATE
    `, [input.requestId]);
    let insertedLines = 0;
    for (const line of lines.rows) {
      const remaining = Math.round(
        (line.quantity - line.received - line.reserved) * 1_000,
      ) / 1_000;
      if (remaining <= 0) continue;
      await client.query(`
        INSERT INTO delivery_job_lines(
          company_id,delivery_job_id,request_line_id,quantity_to_deliver,unit_of_measure_snapshot
        ) VALUES ($1,$2,$3,$4,$5)
      `, [linked.companyId,jobId,line.id,remaining,line.unit]);
      insertedLines += 1;
    }
    if (!insertedLines) throw new Error("Every request line is already assigned to an active delivery job.");
    const event = await appendWorkflowEvent(client, {
      companyId: linked.companyId,
      branchId: linked.branchId,
      requestId: input.requestId,
      aggregateType: "request",
      aggregateId: input.requestId,
      eventKey: "delivery.scheduled",
      stableKey: jobId,
      actor,
      newState: "Delivery job created",
      source: "WEB",
      metadata: { deliveryJobId: jobId, packageLineCount: insertedLines },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR", "COMPANY_RECEIVERS"],
      message: { key: "delivery_scheduled" },
      routePath: `/requests/${input.requestId}`,
    });
    return jobId;
  });
}

export async function assignDeliveryDriver(actor: SessionUser, input: {
  deliveryJobId: string;
  driverUserId: string;
}) {
  requireDeliveryManager(actor);
  if (!UUID_PATTERN.test(input.deliveryJobId) || !UUID_PATTERN.test(input.driverUserId)) {
    throw new Error("Delivery assignment identifiers are invalid.");
  }
  if (isDemoMode()) return;
  await withAuditTransaction({ actor, reason: "Assigned Delivery Guy" }, async (client) => {
    const job = await client.query<{ companyId: string; branchId: string; requestId: string; jobCode: string }>(`
      SELECT company_id::text AS "companyId",branch_id::text AS "branchId",
        request_id::text AS "requestId",job_code AS "jobCode"
      FROM delivery_jobs WHERE id=$1 AND status NOT IN ('DELIVERED','FAILED','CANCELLED')
      FOR UPDATE
    `, [input.deliveryJobId]);
    const linked = job.rows[0];
    if (!linked) throw new Error("Delivery job is unavailable.");
    const activeDriver = await client.query(`
      SELECT 1 FROM delivery_agent_profiles driver
      JOIN users account ON account.id=driver.user_id
      WHERE driver.user_id=$1 AND driver.active AND account.active
        AND account.account_status='ACTIVE' AND account.account_kind='DELIVERY'
      FOR SHARE OF driver,account
    `, [input.driverUserId]);
    if (!activeDriver.rowCount) throw new Error("Choose an active Delivery Guy.");
    const assignment = await client.query<{ id: string }>(`
      INSERT INTO delivery_job_assignments(
        company_id,delivery_job_id,driver_user_id,status,assigned_by
      ) VALUES ($1,$2,$3,'ASSIGNED',$4) RETURNING id::text
    `, [linked.companyId,input.deliveryJobId,input.driverUserId,actor.id]);
    await client.query(`UPDATE delivery_jobs SET status='ASSIGNED',updated_at=now()
      WHERE id=$1 AND status='CREATED'`, [input.deliveryJobId]);
    const event = await appendWorkflowEvent(client, {
      companyId: linked.companyId,
      branchId: linked.branchId,
      requestId: linked.requestId,
      aggregateType: "request",
      aggregateId: linked.requestId,
      eventKey: "driver.assigned",
      stableKey: assignment.rows[0].id,
      actor,
      newState: "Driver assigned",
      source: "WEB",
      metadata: { deliveryJobId: input.deliveryJobId },
    });
    await notifyWorkflowUsers(client, event, {
      recipientUserIds: [input.driverUserId],
      message: { key: "driver_assigned", jobCode: linked.jobCode },
      routePath: "/driver",
      priority: "HIGH",
    });
  });
}

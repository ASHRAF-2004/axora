import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import {
  createInvoice as legacyCreateInvoice,
  recordApproval as legacyRecordApproval,
  recordDelivery as legacyRecordDelivery,
  recordPayment as legacyRecordPayment,
} from "./operations";
import { canAccess } from "./permissions";
import {
  INTERNAL_PAYMENT_STRATEGY,
  type ApprovalRecord,
  type DeliveryStatus,
  type InvoiceStatus,
} from "./types";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
} from "./workflow-repository";

const uuidSchema = z.string().uuid();

interface AccessSnapshot {
  requestId: string;
  companyId: string;
  branchId: string;
  departmentId?: string;
  ownerUserId?: string;
  requestLineId?: string;
  quotationId?: string;
  supplierId?: string;
  invoiceId?: string;
  invoiceDirection?: "CUSTOMER" | "SUPPLIER";
}

interface SnapshotRow extends QueryResultRow {
  snapshot: AccessSnapshot | null;
}

function requireAssignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new Error("The requested operational record is unavailable.");
  }
  return actor.roleAssignmentId;
}

function assertUuid(value: string) {
  if (!uuidSchema.safeParse(value).success) {
    throw new Error("The requested operational record is unavailable.");
  }
}

function platformOperationsActor(actor: AuthenticatedSessionUser) {
  return actor.accountKind === "PLATFORM"
    && actor.scopeType === "PLATFORM"
    && ["PLATFORM_OWNER", "PLATFORM_OPERATIONS", "ADMIN"].includes(
      actor.role,
    );
}

async function lockRequest(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  permission: string,
  requestId: string,
  capturedAt = new Date(),
) {
  assertUuid(requestId);
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_lock_request_resource_access(
      $1,$2,$3,$4,$5
    ) AS snapshot
  `, [
    actor.id,
    requireAssignment(actor),
    permission,
    requestId,
    capturedAt,
  ]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot || snapshot.requestId !== requestId) {
    throw new Error("The requested operational record is unavailable.");
  }
  return snapshot;
}

async function lockRequestLine(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  permission: string,
  requestLineId: string,
  capturedAt = new Date(),
) {
  assertUuid(requestLineId);
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_lock_request_line_access(
      $1,$2,$3,$4,$5
    ) AS snapshot
  `, [
    actor.id,
    requireAssignment(actor),
    permission,
    requestLineId,
    capturedAt,
  ]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot || snapshot.requestLineId !== requestLineId) {
    throw new Error("The requested operational record is unavailable.");
  }
  return snapshot;
}

async function lockInvoice(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  permission: string,
  invoiceId: string,
  capturedAt = new Date(),
) {
  assertUuid(invoiceId);
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_lock_invoice_access(
      $1,$2,$3,$4,$5
    ) AS snapshot
  `, [
    actor.id,
    requireAssignment(actor),
    permission,
    invoiceId,
    capturedAt,
  ]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot || snapshot.invoiceId !== invoiceId) {
    throw new Error("The requested operational record is unavailable.");
  }
  return snapshot;
}

export async function recordScopedApproval(
  input: {
    requestId: string;
    approvalType: string;
    status: ApprovalRecord["status"];
    reason?: string;
  },
  actor: AuthenticatedSessionUser,
) {
  if (isDemoMode()) return legacyRecordApproval(input, actor);
  if (input.status === "Rejected" && !input.reason?.trim()) {
    throw new Error("A rejection reason is required.");
  }
  if (input.status === "Pending") throw new Error("Choose Approve or Reject.");
  if (actor.isOwner || !canAccess(actor, "approve_requests")) {
    throw new Error("Only an assigned company approver can decide this request.");
  }

  await withAuditTransaction({
    actor,
    reason: input.reason,
  }, async (client) => {
    const access = await lockRequest(
      client,
      actor,
      "request.approve.other",
      input.requestId,
    );
    const request = await client.query<{
      createdBy?: string;
      companyId: string;
      branchId: string;
      monthlyBudget?: number;
      estimatedTotal: number;
    }>(`
      SELECT
        request.created_by::text AS "createdBy",
        request.company_id::text AS "companyId",
        request.branch_id::text AS "branchId",
        branch.monthly_budget::float8 AS "monthlyBudget",
        COALESCE((
          SELECT sum(round(line.quantity*line.unit_sell_price,2))
          FROM public.request_lines line
          WHERE line.request_id=request.id
        ),0)::float8 AS "estimatedTotal"
      FROM public.requests request
      JOIN public.branches branch ON branch.id=request.branch_id
      JOIN public.lookup_values request_status
        ON request_status.id=request.status_id
      WHERE request.id=$1
        AND request.id=$2
        AND request_status.label='New Request'
        AND branch.active
      FOR UPDATE OF request,branch
    `, [input.requestId, access.requestId]);
    const current = request.rows[0];
    if (!current) {
      throw new Error(
        "This request is not pending approval for your branch.",
      );
    }
    if (current.createdBy === actor.id) {
      throw new Error("You cannot approve your own purchase request.");
    }

    const prior = await client.query(`
      SELECT 1 FROM public.approvals
      WHERE request_id=$1
        AND approval_type='Company approval'
        AND status IN ('Approved','Rejected')
      LIMIT 1
    `, [input.requestId]);
    if (prior.rowCount) {
      throw new Error("This purchase request already has a final company decision.");
    }

    if (input.status === "Approved"
      && current.monthlyBudget !== undefined
      && current.monthlyBudget !== null) {
      const usage = await client.query<{ committed: number }>(`
        SELECT committed_amount::float8 AS committed
        FROM public.v_branch_budget_usage
        WHERE branch_id=$1
      `, [current.branchId]);
      const committed = Number(usage.rows[0]?.committed ?? 0);
      if (committed + current.estimatedTotal > current.monthlyBudget) {
        throw new Error(
          "This request exceeds the branch's available monthly budget.",
        );
      }
    }

    await client.query(`
      INSERT INTO public.approvals(
        request_id,approval_type,status,reviewer_id,reason,decided_at
      ) VALUES ($1,'Company approval',$2,$3,$4,now())
    `, [input.requestId, input.status, actor.id, input.reason ?? null]);
    if (input.status === "Rejected") {
      await client.query(`
        UPDATE public.requests
        SET status_id=lookup_id('request_status','Cancelled'),
            issue_reason=$2
        WHERE id=$1
      `, [input.requestId, input.reason]);
    }

    const event = await appendWorkflowEvent(client, {
      companyId: current.companyId,
      branchId: current.branchId,
      requestId: input.requestId,
      aggregateType: "request",
      aggregateId: input.requestId,
      eventKey: input.status === "Approved"
        ? "request.approved"
        : "request.rejected",
      stableKey: `${input.status}:${actor.id}`,
      actor,
      previousState: "Pending approval",
      newState: input.status,
      reason: input.reason,
      source: "WEB",
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: input.status === "Approved"
        ? ["REQUEST_CREATOR", "PLATFORM_OPERATIONS"]
        : ["REQUEST_CREATOR"],
      message: input.status === "Approved"
        ? { key: "request_approved" }
        : { key: "request_rejected" },
      routePath: `/requests/${input.requestId}`,
      priority: input.status === "Rejected" ? "HIGH" : "NORMAL",
    });
  });
}

export async function recordScopedDelivery(
  input: {
    requestLineId: string;
    expectedDate?: string;
    revisedDate?: string;
    actualDate?: string;
    status: DeliveryStatus;
    quantityReceived: number;
    receivedBy?: string;
    issueReason?: string;
  },
  actor: AuthenticatedSessionUser,
) {
  if (isDemoMode()) return legacyRecordDelivery(input, actor);
  if (!canAccess(actor, "manage_deliveries")) {
    throw new Error(
      "Only authorized Axora operations users can record delivery updates.",
    );
  }
  if (["Partially Delivered", "Delivered"].includes(input.status)) {
    throw new Error(
      "Customer receipt must be confirmed independently in the receiving portal.",
    );
  }
  if (!Number.isFinite(input.quantityReceived)
    || input.quantityReceived !== 0
    || input.actualDate
    || input.receivedBy?.trim()) {
    throw new Error(
      "Logistics status updates cannot record customer receipt evidence.",
    );
  }
  if (["Delayed", "Failed", "Cancelled"].includes(input.status)
    && !input.issueReason?.trim()) {
    throw new Error("An issue reason is required for this delivery status.");
  }

  await withAuditTransaction({
    actor,
    reason: input.issueReason,
  }, async (client) => {
    const access = await lockRequestLine(
      client,
      actor,
      "delivery.manage",
      input.requestLineId,
    );
    const eligible = await client.query(`
      SELECT 1
      FROM public.request_lines line
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.lookup_values request_status
        ON request_status.id=request.status_id
      WHERE line.id=$1
        AND request.id=$2
        AND request_status.label IN (
          'Ordered','Preparing for Delivery','Out for Delivery'
        )
      FOR UPDATE OF line,request
    `, [input.requestLineId, access.requestId]);
    if (!eligible.rowCount) throw new Error("Request line not found.");

    const inserted = await client.query<{ id: string }>(`
      INSERT INTO public.deliveries(
        request_line_id,expected_date,revised_date,actual_date,status_id,
        quantity_received,received_by,issue_reason
      ) VALUES (
        $1,$2,$3,NULL,lookup_id('delivery_status',$4),0,NULL,$5
      )
      RETURNING id::text
    `, [
      input.requestLineId,
      input.expectedDate || null,
      input.revisedDate || null,
      input.status,
      input.issueReason || null,
    ]);
    const eventKey = input.status === "Scheduled"
      ? "delivery.scheduled"
      : input.status === "Out for Delivery"
        ? "delivery.out_for_delivery"
        : input.status === "Delayed"
          ? "delivery.delayed"
          : input.status === "Failed"
            ? "delivery.failed"
            : "delivery.status_changed";
    const event = await appendWorkflowEvent(client, {
      companyId: access.companyId,
      branchId: access.branchId,
      requestId: access.requestId,
      aggregateType: "request",
      aggregateId: access.requestId,
      eventKey,
      stableKey: inserted.rows[0].id,
      actor,
      newState: input.status,
      reason: input.issueReason,
      source: "WEB",
      metadata: { requestLineId: input.requestLineId },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: {
        key: "delivery_status_updated",
        status: input.status,
      },
      routePath: `/requests/${access.requestId}`,
      priority: ["Delayed", "Failed"].includes(input.status)
        ? "HIGH"
        : "NORMAL",
    });
  });
}

export async function createScopedInvoice(
  input: {
    direction: "CUSTOMER" | "SUPPLIER";
    requestId: string;
    supplierId?: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate?: string;
    amount: number;
    status: InvoiceStatus;
  },
  actor: AuthenticatedSessionUser,
) {
  if (!canAccess(actor, "manage_finance")) {
    throw new Error("Only authorized Axora finance users can create invoices.");
  }
  if (input.direction !== "SUPPLIER") {
    throw new Error("Customer invoices are finalized by checkout.");
  }
  if (isDemoMode()) return legacyCreateInvoice(input, actor);
  if (!input.supplierId) {
    throw new Error("Select the supplier for a supplier invoice.");
  }
  if (input.status !== "Issued") {
    throw new Error("New invoices must be issued records.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Enter a positive invoice amount.");
  }
  if (!input.invoiceNumber.trim()) {
    throw new Error("Enter the invoice number.");
  }

  await withAuditTransaction({ actor }, async (client) => {
    const access = await lockRequest(
      client,
      actor,
      "finance.manage",
      input.requestId,
    );
    if (input.direction === "SUPPLIER") {
      await lockRequest(
        client,
        actor,
        "platform.view",
        input.requestId,
      );
    }

    const request = await client.query<{ status: string }>(`
      SELECT request_status.label AS status
      FROM public.requests request
      JOIN public.lookup_values request_status
        ON request_status.id=request.status_id
      WHERE request.id=$1
        AND request_status.label IN ('Delivered','Invoice Issued')
        AND EXISTS (
          SELECT 1 FROM public.approvals approval
          WHERE approval.request_id=request.id
            AND approval.approval_type='Company approval'
            AND approval.status='Approved'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.request_lines line
          WHERE line.request_id=request.id
            AND axora_received_quantity(line.id)<line.quantity
        )
      FOR UPDATE OF request
    `, [access.requestId]);
    if (!request.rows[0]) {
      throw new Error(
        "Invoices can be issued only after the approved request is fully delivered.",
      );
    }

    if (input.direction === "SUPPLIER") {
      const supplier = await client.query(`
        SELECT 1 FROM public.suppliers supplier
        WHERE supplier.id=$1
          AND supplier.company_id IS NULL
          AND supplier.active
          AND EXISTS (
            SELECT 1 FROM public.request_lines line
            WHERE line.request_id=$2
              AND line.selected_supplier_id=supplier.id
          )
        FOR SHARE
      `, [input.supplierId, access.requestId]);
      if (!supplier.rowCount) {
        throw new Error("The supplier must be selected on this request.");
      }
    }

    if (input.direction === "CUSTOMER") {
      const totals = await client.query<{
        authorizedTotal: number;
        invoicedTotal: number;
      }>(`
        SELECT
          COALESCE((
            SELECT sum(round(line.quantity*line.unit_sell_price,2))
            FROM public.request_lines line
            WHERE line.request_id=$1
          ),0)::float8 AS "authorizedTotal",
          COALESCE((
            SELECT sum(invoice.amount)
            FROM public.invoices invoice
            JOIN public.lookup_values invoice_status
              ON invoice_status.id=invoice.status_id
            WHERE invoice.request_id=$1
              AND invoice.direction='CUSTOMER'
              AND invoice_status.label<>'Cancelled'
          ),0)::float8 AS "invoicedTotal"
      `, [access.requestId]);
      if (totals.rows[0].invoicedTotal + input.amount
        > totals.rows[0].authorizedTotal + 0.001) {
        throw new Error(
          "Customer invoices cannot exceed the total approved by the company.",
        );
      }
    }

    const inserted = await client.query<{ id: string }>(`
      INSERT INTO public.invoices(
        direction,request_id,company_id,supplier_id,invoice_number,
        invoice_date,due_date,amount,status_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,lookup_id('invoice_status',$9)
      )
      RETURNING id::text
    `, [
      input.direction,
      access.requestId,
      input.direction === "CUSTOMER" ? access.companyId : null,
      input.direction === "SUPPLIER" ? input.supplierId : null,
      input.invoiceNumber,
      input.invoiceDate,
      input.dueDate || null,
      input.amount,
      input.status,
    ]);
    if (input.direction === "CUSTOMER"
      && request.rows[0].status === "Delivered") {
      await client.query(`
        UPDATE public.requests
        SET status_id=lookup_id('request_status','Invoice Issued')
        WHERE id=$1
      `, [access.requestId]);
    }
    if (input.direction === "CUSTOMER") {
      const event = await appendWorkflowEvent(client, {
        companyId: access.companyId,
        branchId: access.branchId,
        requestId: access.requestId,
        aggregateType: "request",
        aggregateId: access.requestId,
        eventKey: "invoice.issued",
        stableKey: inserted.rows[0].id,
        actor,
        newState: "Invoice issued",
        source: "WEB",
      });
      await notifyWorkflowAudience(client, event, {
        actorUserId: actor.id,
        audiences: ["REQUEST_CREATOR", "COMPANY_FINANCE"],
        message: { key: "invoice_issued" },
        routePath: "/finance",
      });
    }
  });
}

export async function recordScopedPayment(
  input: {
    invoiceId: string;
    paymentDate: string;
    amount: number;
    method: string;
    reference?: string;
  },
  actor: AuthenticatedSessionUser,
) {
  if (isDemoMode()) return legacyRecordPayment(input, actor);
  if (!canAccess(actor, "manage_finance")) {
    throw new Error("Only authorized Axora finance users can record payments.");
  }
  if (input.method !== INTERNAL_PAYMENT_STRATEGY) {
    throw new Error(`Only ${INTERNAL_PAYMENT_STRATEGY} is currently supported.`);
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("Enter a positive payment amount.");
  }
  const reference = input.reference?.trim();
  if (!reference) {
    throw new Error("Enter the numbered receipt or collection reference.");
  }

  await withAuditTransaction({ actor }, async (client) => {
    const access = await lockInvoice(
      client,
      actor,
      "finance.manage",
      input.invoiceId,
    );
    if (access.invoiceDirection !== "SUPPLIER") {
      throw new Error("The invoice is unavailable.");
    }
    await lockRequest(client, actor, "platform.view", access.requestId);

    const invoice = await client.query<{
      amount: number;
      direction: "CUSTOMER" | "SUPPLIER";
    }>(`
      SELECT invoice.amount::float8 AS amount,invoice.direction
      FROM public.invoices invoice
      JOIN public.requests request ON request.id=invoice.request_id
      JOIN public.lookup_values invoice_status
        ON invoice_status.id=invoice.status_id
      JOIN public.lookup_values request_status
        ON request_status.id=request.status_id
      WHERE invoice.id=$1
        AND request.id=$2
        AND invoice_status.label='Issued'
        AND request_status.label IN ('Delivered','Invoice Issued','Completed')
        AND NOT EXISTS (
          SELECT 1 FROM public.request_lines line
          WHERE line.request_id=request.id
            AND axora_received_quantity(line.id)<line.quantity
        )
      FOR UPDATE OF invoice,request
    `, [input.invoiceId, access.requestId]);
    if (!invoice.rows[0]) {
      throw new Error(
        "Record supplier payment only against an issued invoice after delivery.",
      );
    }

    const paid = await client.query<{ total: number }>(`
      SELECT COALESCE(sum(amount),0)::float8 AS total
      FROM public.payments
      WHERE invoice_id=$1
    `, [input.invoiceId]);
    if (input.amount > invoice.rows[0].amount - paid.rows[0].total) {
      throw new Error("Payment cannot exceed the outstanding invoice amount.");
    }

    const inserted = await client.query<{ id: string }>(`
      INSERT INTO public.payments(
        invoice_id,payment_date,amount,method,reference,recorded_by,
        payment_status,paid_at
      ) VALUES ($1,$2,$3,$4,$5,$6,'PAID',now())
      RETURNING id::text
    `, [
      input.invoiceId,
      input.paymentDate,
      input.amount,
      INTERNAL_PAYMENT_STRATEGY,
      reference,
      actor.id,
    ]);
    void inserted;
  });
}

export const scopedOperationInternals = {
  lockInvoice,
  lockRequest,
  lockRequestLine,
  platformOperationsActor,
};

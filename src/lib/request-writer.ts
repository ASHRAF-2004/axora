import type { PoolClient } from "pg";
import { roundMoney } from "./domain";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import {
  createRequest as createLegacyRequest,
  updateRequestStatus as updateLegacyRequestStatus,
  type NewRequestInput,
} from "./repository";
import {
  lockRequestCreationScope,
  lockRequestResourceAccess,
  requireDemoRequestCreationScope,
  requireDemoRequestPermission,
  RequestAccessUnavailableError,
} from "./request-isolation";
import type { AuthenticatedSessionUser } from "./auth";
import type { ProcurementRequest, RequestStatus } from "./types";
import { validateStatusTransition } from "./workflow";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
} from "./workflow-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUniqueProducts(input: NewRequestInput) {
  if (new Set(input.lines.map((line) => line.productId)).size
    !== input.lines.length) {
    throw new Error("Add each catalog product only once per purchase request.");
  }
}

function actorDepartmentId(actor: AuthenticatedSessionUser) {
  return actor.scopeType === "DEPARTMENT" ? actor.departmentId : undefined;
}

function validSubmissionKey(value: string) {
  return UUID_PATTERN.test(value);
}

export async function createAuthorizedRequest(
  input: NewRequestInput,
  actor: AuthenticatedSessionUser,
  submissionKey: string,
) {
  if (!canAccess(actor, "create_requests")
    || !validSubmissionKey(submissionKey)) {
    throw new RequestAccessUnavailableError();
  }
  assertUniqueProducts(input);
  const departmentId = actorDepartmentId(actor);

  if (isDemoMode()) {
    await requireDemoRequestCreationScope(actor, {
      companyId: input.companyId,
      branchId: input.branchId,
      departmentId,
    });
    const existing = getDemoStore().requests.find((request) => (
      request.createdById === actor.id
      && request.clientSubmissionKey === submissionKey
    ));
    if (existing) return existing.id;
    const requestId = await createLegacyRequest(input, actor);
    const created = getDemoStore().requests.find((request) => (
      request.id === requestId
    ));
    if (created) created.clientSubmissionKey = submissionKey;
    return requestId;
  }

  return withAuditTransaction({
    userId: actor.id,
    reason: "Submitted a retry-safe purchase request",
  }, async (client: PoolClient) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id::text
       FROM requests
       WHERE created_by=$1 AND client_submission_key=$2
       LIMIT 1`,
      [actor.id, submissionKey],
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;

    const context = await lockRequestCreationScope(client, actor, {
      companyId: input.companyId,
      branchId: input.branchId,
      departmentId,
    });

    const selectedProducts = await client.query<{
      id: string;
      minimumOrderQuantity: number;
      name: string;
    }>(
      `SELECT id::text,name,
         minimum_order_quantity::float8 AS "minimumOrderQuantity"
       FROM products
       WHERE id=ANY($1::uuid[])
         AND active=true
         AND needs_review=false
         AND (company_id IS NULL OR company_id=$2)
       FOR SHARE`,
      [input.lines.map((line) => line.productId), context.companyId],
    );
    if (selectedProducts.rows.length !== input.lines.length) {
      throw new Error(
        "One or more selected products are unavailable or still need review.",
      );
    }
    const selectedById = new Map(
      selectedProducts.rows.map((product) => [product.id, product]),
    );
    for (const line of input.lines) {
      const product = selectedById.get(line.productId);
      if (!product || line.quantity < product.minimumOrderQuantity) {
        throw new Error(
          `Order at least ${product?.minimumOrderQuantity
            ?? "the catalog minimum"} for ${product?.name ?? "each product"}.`,
        );
      }
    }

    const requestResult = await client.query<{ id: string }>(
      `INSERT INTO requests (
        order_code,request_date,request_type_id,company_id,branch_id,
        department_id,department,requested_by,requester_contact,
        needed_by_date,urgency_id,status_id,notes,created_by,
        estimated_delivery_fee,tax_rate,client_submission_key
      ) VALUES (
        next_order_code(),CURRENT_DATE,lookup_id('request_type',$1),
        $2,$3,$4,$5,$6,$7,$8,lookup_id('urgency',$9),
        lookup_id('request_status','New Request'),$10,$11,$12,$13,$14
      )
      ON CONFLICT(created_by,client_submission_key)
        WHERE created_by IS NOT NULL AND client_submission_key IS NOT NULL
      DO NOTHING
      RETURNING id::text`,
      [
        input.requestType,
        context.companyId,
        context.branchId,
        context.departmentId ?? null,
        context.departmentName ?? input.department,
        actor.name,
        actor.email,
        input.neededByDate,
        input.urgency,
        input.notes ?? null,
        actor.id,
        roundMoney(context.estimatedDeliveryFee),
        roundMoney(context.taxRate),
        submissionKey,
      ],
    );
    let requestId = requestResult.rows[0]?.id;
    if (!requestId) {
      const concurrent = await client.query<{ id: string }>(
        `SELECT id::text
         FROM requests
         WHERE created_by=$1 AND client_submission_key=$2
         LIMIT 1`,
        [actor.id, submissionKey],
      );
      requestId = concurrent.rows[0]?.id;
      if (requestId) return requestId;
      throw new RequestAccessUnavailableError();
    }

    for (const item of input.lines) {
      const insertedLine = await client.query(
        `INSERT INTO request_lines(
          request_line_code,request_id,product_id,product_name_snapshot,
          category_snapshot,subcategory_snapshot,specification,quantity,
          unit_of_measure,supplier_confirmation_status_id,unit_buy_price,
          unit_sell_price
        )
        SELECT next_request_line_code(),$1,product.id,product.name,
          product.category,product.subcategory,$3,$4,product.unit_of_measure,
          lookup_id('supplier_confirmation','Pending'),
          product.default_buy_price,product.default_sell_price
        FROM products product
        WHERE product.id=$2
          AND product.active=true
          AND product.needs_review=false
          AND (product.company_id IS NULL OR product.company_id=$5)`,
        [
          requestId,
          item.productId,
          item.specification ?? null,
          item.quantity,
          context.companyId,
        ],
      );
      if (!insertedLine.rowCount) {
        throw new Error(
          "A selected product became unavailable. Review the request and try again.",
        );
      }
    }

    await client.query(
      `UPDATE requests request
       SET tax_amount=round(
         COALESCE((
           SELECT sum(round(line.quantity*line.unit_sell_price,2))
           FROM request_lines line
           WHERE line.request_id=request.id
         ),0)*(request.tax_rate/100),
         2
       )
       WHERE request.id=$1`,
      [requestId],
    );

    const event = await appendWorkflowEvent(client, {
      companyId: context.companyId,
      branchId: context.branchId,
      requestId,
      aggregateType: "request",
      aggregateId: requestId,
      eventKey: "request.submitted",
      stableKey: "initial-submission",
      actor,
      previousState: "Draft",
      newState: "Submitted",
      source: "WEB",
      metadata: { lineCount: input.lines.length, urgency: input.urgency },
    });
    const approvalEvent = await appendWorkflowEvent(client, {
      companyId: context.companyId,
      branchId: context.branchId,
      requestId,
      aggregateType: "request",
      aggregateId: requestId,
      eventKey: "approval.needed",
      stableKey: "initial-company-approval",
      actor,
      previousState: "Submitted",
      newState: "Awaiting company approval",
      source: "WEB",
      metadata: { submittedEventId: event.id },
    });
    await notifyWorkflowAudience(client, approvalEvent, {
      actorUserId: actor.id,
      audiences: ["REQUEST_APPROVERS"],
      message: { key: "request_needs_approval", actorName: actor.name },
      routePath: `/requests/${requestId}`,
      priority: input.urgency === "Urgent" ? "HIGH" : "NORMAL",
    });

    return requestId;
  });
}

export async function updateAuthorizedRequestStatus(
  id: string,
  status: RequestStatus,
  reason: string | undefined,
  actor: AuthenticatedSessionUser,
) {
  if (!canAccess(actor, "manage_sourcing")) {
    throw new RequestAccessUnavailableError();
  }

  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === id);
    if (!request) throw new RequestAccessUnavailableError();
    await requireDemoRequestPermission(
      actor,
      request as ProcurementRequest,
      "sourcing.manage",
    );
    return updateLegacyRequestStatus(id, status, reason, actor);
  }

  await withAuditTransaction({ userId: actor.id, reason }, async (client) => {
    const access = await lockRequestResourceAccess(client, actor, {
      permission: "sourcing.manage",
      requestId: id,
    });
    if (!access.active) throw new RequestAccessUnavailableError();

    const current = await client.query<{
      status: RequestStatus;
    }>(
      `SELECT status.label AS status
       FROM requests request
       JOIN lookup_values status ON status.id=request.status_id
       WHERE request.id=$1`,
      [id],
    );
    const currentStatus = current.rows[0]?.status;
    if (!currentStatus) throw new RequestAccessUnavailableError();
    validateStatusTransition(currentStatus, status, reason);

    const permitted = await client.query(
      `SELECT 1
       FROM request_status_transitions
       WHERE from_status_id=lookup_id('request_status',$1)
         AND to_status_id=lookup_id('request_status',$2)`,
      [currentStatus, status],
    );
    if (!permitted.rowCount) {
      throw new Error(
        "This workflow transition is not configured in the database.",
      );
    }

    const approval = await client.query(
      `SELECT 1
       FROM approvals
       WHERE request_id=$1
         AND approval_type='Company approval'
         AND status='Approved'
       LIMIT 1`,
      [id],
    );
    if (!approval.rowCount) {
      throw new Error(
        "The company must approve this request before Axora starts fulfillment.",
      );
    }

    if (status === "Supplier Assigned") {
      const missing = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM request_lines
         WHERE request_id=$1 AND selected_supplier_id IS NULL`,
        [id],
      );
      if (missing.rows[0]?.count) {
        throw new Error(
          "Select a supplier quotation for every request line first.",
        );
      }
    }

    if (status === "Delivered") {
      const incomplete = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM request_lines line
         WHERE line.request_id=$1
           AND axora_received_quantity(line.id)<line.quantity`,
        [id],
      );
      if (incomplete.rows[0]?.count) {
        throw new Error(
          "Every request line must be fully received before marking the request delivered.",
        );
      }
    }

    if (status === "Invoice Issued") {
      const invoice = await client.query(
        `SELECT 1
         FROM invoices invoice
         JOIN lookup_values invoice_status
           ON invoice_status.id=invoice.status_id
         WHERE invoice.request_id=$1
           AND invoice.direction='CUSTOMER'
           AND invoice_status.label='Issued'
         LIMIT 1`,
        [id],
      );
      if (!invoice.rowCount) {
        throw new Error(
          "Issue a customer invoice before moving to Invoice Issued.",
        );
      }
    }

    if (status === "Completed") {
      const settlement = await client.query<{
        invoiceCount: number;
        unpaidCount: number;
        authorizedTotal: number;
        invoicedTotal: number;
      }>(
        `SELECT
          count(*) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>
                lookup_id('invoice_status','Cancelled')
          )::int AS "invoiceCount",
          count(*) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>
                lookup_id('invoice_status','Cancelled')
              AND balance.outstanding_amount>0
          )::int AS "unpaidCount",
          (
            COALESCE((
              SELECT sum(round(line.quantity*line.unit_sell_price,2))
              FROM request_lines line
              WHERE line.request_id=request.id
            ),0)
            + request.estimated_delivery_fee
            + request.tax_amount
          )::float8 AS "authorizedTotal",
          COALESCE(sum(balance.amount) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>
                lookup_id('invoice_status','Cancelled')
          ),0)::float8 AS "invoicedTotal"
        FROM requests request
        LEFT JOIN v_invoice_balances balance
          ON balance.request_id=request.id
        WHERE request.id=$1
        GROUP BY request.id,request.estimated_delivery_fee,
          request.tax_amount`,
        [id],
      );
      const row = settlement.rows[0];
      if (!row?.invoiceCount || row.unpaidCount) {
        throw new Error(
          "All active customer invoices must be fully paid before completing the request.",
        );
      }
      if (Math.abs(row.invoicedTotal - row.authorizedTotal) > 0.001) {
        throw new Error(
          "Customer invoices must equal the company-approved request total before completion.",
        );
      }
    }

    await client.query(
      `UPDATE requests
       SET status_id=lookup_id('request_status',$2),
         issue_reason=COALESCE(NULLIF($3,''),issue_reason),
         completed_at=CASE WHEN $2='Completed' THEN now()
           ELSE completed_at END
       WHERE id=$1`,
      [id, status, reason ?? ""],
    );

    const eventKeys: Partial<Record<RequestStatus, string>> = {
      "Waiting for Quotation": "quotation.requested",
      "Supplier Assigned": "supplier.selected",
      Ordered: "order.confirmed",
      "Preparing for Delivery": "preparation.started",
      "Out for Delivery": "delivery.out_for_delivery",
      Delivered: "delivery.completed",
      "Invoice Issued": "invoice.issued",
      Completed: "request.completed",
      "On Hold": "request.on_hold",
      Cancelled: "request.cancelled",
    };
    const event = await appendWorkflowEvent(client, {
      companyId: access.companyId,
      branchId: access.branchId,
      requestId: id,
      aggregateType: "request",
      aggregateId: id,
      eventKey: eventKeys[status] ?? "request.status_changed",
      stableKey: `${currentStatus}:${status}`,
      actor,
      previousState: currentStatus,
      newState: status,
      reason,
      source: "WEB",
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: status === "Completed"
        ? { key: "request_completed" }
        : { key: "request_status_updated", status },
      routePath: `/requests/${id}`,
      priority: ["On Hold", "Cancelled"].includes(status)
        ? "HIGH"
        : "NORMAL",
    });
  });
}

export const requestWriterInternals = {
  validSubmissionKey,
};

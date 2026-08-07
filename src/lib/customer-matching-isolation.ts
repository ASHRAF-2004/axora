import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  evaluateCustomerMatch as legacyEvaluateCustomerMatch,
  getCustomerMatchWorkspace as legacyGetCustomerMatchWorkspace,
  overrideCustomerMatch as legacyOverrideCustomerMatch,
  type CustomerMatchEvaluationResult,
  type CustomerMatchInvoiceOption,
  type CustomerMatchLineOption,
  type CustomerMatchSummary,
} from "./customer-matching";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import { evaluateThreeWayMatch } from "./receiving";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
} from "./workflow-repository";

const uuidSchema = z.string().uuid();

interface SnapshotRow extends QueryResultRow {
  snapshot: {
    requestId?: string;
    requestLineId?: string;
    invoiceId?: string;
    companyId?: string;
    branchId?: string;
  } | null;
}

interface ExistingReplay {
  id: string;
  requestLineId: string;
  customerInvoiceId: string;
  invoicedQuantity: number;
  invoicedUnitPrice: number;
  evaluatedByUserId: string;
  status: CustomerMatchSummary["status"];
  exceptionCodes: string[];
}

export class CustomerMatchAccessUnavailableError extends Error {
  constructor() {
    super("The requested three-way match evidence is unavailable.");
    this.name = "CustomerMatchAccessUnavailableError";
  }
}

function requireReviewer(actor: AuthenticatedSessionUser) {
  if (!canAccess(actor, "review_three_way_matches")
    || !actor.roleAssignmentId) {
    throw new CustomerMatchAccessUnavailableError();
  }
  return actor.roleAssignmentId;
}

async function lockRequestLine(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  requestLineId: string,
  capturedAt: Date,
) {
  if (!uuidSchema.safeParse(requestLineId).success) {
    throw new CustomerMatchAccessUnavailableError();
  }
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_lock_request_line_access(
      $1,$2,'finance.match.review',$3,$4
    ) AS snapshot
  `, [actor.id, requireReviewer(actor), requestLineId, capturedAt]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot || snapshot.requestLineId !== requestLineId) {
    throw new CustomerMatchAccessUnavailableError();
  }
  return snapshot;
}

async function lockInvoice(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  invoiceId: string,
  capturedAt: Date,
) {
  if (!uuidSchema.safeParse(invoiceId).success) {
    throw new CustomerMatchAccessUnavailableError();
  }
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_lock_invoice_access(
      $1,$2,'finance.match.review',$3,$4
    ) AS snapshot
  `, [actor.id, requireReviewer(actor), invoiceId, capturedAt]);
  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot || snapshot.invoiceId !== invoiceId) {
    throw new CustomerMatchAccessUnavailableError();
  }
  return snapshot;
}

async function replay(
  client: PoolClient,
  companyId: string,
  idempotencyKey: string,
) {
  const result = await client.query<ExistingReplay>(`
    SELECT
      id::text,
      request_line_id::text AS "requestLineId",
      customer_invoice_id::text AS "customerInvoiceId",
      invoiced_quantity_snapshot::float8 AS "invoicedQuantity",
      invoiced_unit_price_snapshot::float8 AS "invoicedUnitPrice",
      evaluated_by_user_id::text AS "evaluatedByUserId",
      status,
      exception_codes AS "exceptionCodes"
    FROM public.customer_three_way_matches
    WHERE company_id=$1 AND idempotency_key=$2
    FOR SHARE
  `, [companyId, idempotencyKey]);
  return result.rows[0];
}

function replayResult(
  existing: ExistingReplay | undefined,
  actor: AuthenticatedSessionUser,
  input: {
    requestLineId: string;
    customerInvoiceId: string;
    invoicedQuantity: number;
    invoicedUnitPrice: number;
  },
): CustomerMatchEvaluationResult | undefined {
  if (!existing) return undefined;
  if (existing.requestLineId !== input.requestLineId
    || existing.customerInvoiceId !== input.customerInvoiceId
    || Number(existing.invoicedQuantity) !== input.invoicedQuantity
    || Number(existing.invoicedUnitPrice) !== input.invoicedUnitPrice
    || existing.evaluatedByUserId !== actor.id) {
    throw new Error(
      "That three-way match submission identifier was already used for different data.",
    );
  }
  return {
    id: existing.id,
    status: existing.status,
    exceptionCodes: existing.exceptionCodes,
    created: false,
  };
}

export async function getAuthorizedCustomerMatchWorkspace(
  actor: AuthenticatedSessionUser,
) {
  requireReviewer(actor);
  if (isDemoMode()) return legacyGetCustomerMatchWorkspace(actor);
  const capturedAt = new Date();
  const values = [actor.id, actor.roleAssignmentId, capturedAt];

  return withAuditTransaction({
    userId: actor.id,
    reason: "Viewed scoped customer three-way matching",
  }, async (client) => {
    const lines = await client.query<CustomerMatchLineOption>(`
      SELECT
        line.id::text,
        line.request_id::text AS "requestId",
        request.company_id::text AS "companyId",
        request.order_code AS "orderCode",
        line.product_name_snapshot AS "productName",
        line.quantity::float8 AS quantity,
        line.unit_sell_price::float8 AS "unitPrice"
      FROM public.request_lines line
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'finance.match.review',$3
      ) access ON access.request_id=request.id
      WHERE EXISTS (
        SELECT 1 FROM public.approvals approval
        WHERE approval.request_id=request.id
          AND approval.approval_type='Company approval'
          AND approval.status='Approved'
      )
      ORDER BY
        request.request_date DESC,request.order_code,
        line.request_line_code,line.id
    `, values);
    const invoices = await client.query<CustomerMatchInvoiceOption>(`
      SELECT
        invoice.id::text,
        invoice.request_id::text AS "requestId",
        invoice.invoice_number AS "invoiceNumber",
        invoice.amount::float8 AS amount
      FROM public.invoices invoice
      JOIN public.requests request ON request.id=invoice.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'finance.match.review',$3
      ) access ON access.request_id=request.id
      JOIN public.lookup_values status ON status.id=invoice.status_id
      WHERE invoice.direction='CUSTOMER'
        AND status.label='Issued'
      ORDER BY invoice.invoice_date DESC,invoice.invoice_number,invoice.id
    `, values);
    const matches = await client.query<CustomerMatchSummary>(`
      SELECT
        match.id::text,
        request.order_code AS "orderCode",
        line.product_name_snapshot AS "productName",
        invoice.invoice_number AS "invoiceNumber",
        match.status,
        match.exception_codes AS "exceptionCodes",
        match.ordered_quantity_snapshot::float8 AS "orderedQuantity",
        match.received_quantity_snapshot::float8 AS "receivedQuantity",
        match.invoiced_quantity_snapshot::float8 AS "invoicedQuantity",
        match.ordered_unit_price_snapshot::float8 AS "orderedUnitPrice",
        match.invoiced_unit_price_snapshot::float8 AS "invoicedUnitPrice",
        evaluator.display_name AS "evaluatorName",
        match.evaluated_at::text AS "evaluatedAt",
        match.override_reason AS "overrideReason"
      FROM public.customer_three_way_matches match
      JOIN public.request_lines line ON line.id=match.request_line_id
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'finance.match.review',$3
      ) access ON access.request_id=request.id
      JOIN public.invoices invoice ON invoice.id=match.customer_invoice_id
      JOIN public.user_profiles evaluator
        ON evaluator.user_id=match.evaluated_by_user_id
      ORDER BY match.evaluated_at DESC,match.id DESC
      LIMIT 250
    `, values);
    return { lines: lines.rows, invoices: invoices.rows, matches: matches.rows };
  });
}

export async function evaluateAuthorizedCustomerMatch(
  actor: AuthenticatedSessionUser,
  input: {
    requestLineId: string;
    customerInvoiceId: string;
    invoicedQuantity: number;
    invoicedUnitPrice: number;
    idempotencyKey: string;
  },
) {
  requireReviewer(actor);
  if (isDemoMode()) return legacyEvaluateCustomerMatch(actor, input);
  if (![input.requestLineId,input.customerInvoiceId,input.idempotencyKey]
    .every((value) => uuidSchema.safeParse(value).success)) {
    throw new Error("Three-way match identifiers are invalid.");
  }
  if (!Number.isFinite(input.invoicedQuantity)
    || input.invoicedQuantity < 0
    || !Number.isFinite(input.invoicedUnitPrice)
    || input.invoicedUnitPrice < 0) {
    throw new Error(
      "Invoice quantity and unit price must be non-negative numbers.",
    );
  }

  return withAuditTransaction({
    userId: actor.id,
    reason: "Evaluated scoped customer three-way match",
  }, async (client) => {
    const capturedAt = new Date();
    const lineAccess = await lockRequestLine(
      client,
      actor,
      input.requestLineId,
      capturedAt,
    );
    const invoiceAccess = await lockInvoice(
      client,
      actor,
      input.customerInvoiceId,
      capturedAt,
    );
    if (lineAccess.requestId !== invoiceAccess.requestId) {
      throw new Error(
        "Choose a customer invoice and request line from the same request.",
      );
    }

    const evidence = await client.query<{
      requestId: string;
      companyId: string;
      branchId: string;
      orderedQuantity: number;
      orderedUnitPrice: number;
      receiptLineId?: string;
      receivedQuantity?: number;
      invoiceAmount: number;
    }>(`
      SELECT
        request.id::text AS "requestId",
        request.company_id::text AS "companyId",
        request.branch_id::text AS "branchId",
        line.quantity::float8 AS "orderedQuantity",
        line.unit_sell_price::float8 AS "orderedUnitPrice",
        receipt_line.id::text AS "receiptLineId",
        receipt_line.accepted_quantity::float8 AS "receivedQuantity",
        invoice.amount::float8 AS "invoiceAmount"
      FROM public.request_lines line
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.invoices invoice
        ON invoice.id=$2
       AND invoice.request_id=request.id
       AND invoice.direction='CUSTOMER'
       AND invoice.company_id=request.company_id
      LEFT JOIN LATERAL (
        SELECT candidate.*
        FROM public.receipt_lines candidate
        JOIN public.receipts receipt ON receipt.id=candidate.receipt_id
        WHERE candidate.request_line_id=line.id
          AND candidate.company_id=request.company_id
        ORDER BY receipt.received_at DESC,candidate.created_at DESC
        LIMIT 1
      ) receipt_line ON true
      WHERE line.id=$1
        AND request.id=$3
      FOR SHARE OF line,request,invoice
    `, [input.requestLineId,input.customerInvoiceId,lineAccess.requestId]);
    const current = evidence.rows[0];
    if (!current) {
      throw new Error(
        "Choose a customer invoice and request line from the same request.",
      );
    }

    const existing = replayResult(
      await replay(client, current.companyId, input.idempotencyKey),
      actor,
      input,
    );
    if (existing) return existing;
    if (input.invoicedQuantity * input.invoicedUnitPrice
      > current.invoiceAmount + 0.01) {
      throw new Error("The line value cannot exceed the customer invoice amount.");
    }

    const evaluation = evaluateThreeWayMatch({
      orderedQuantity: current.orderedQuantity,
      receivedQuantity: current.receivedQuantity,
      invoicedQuantity: input.invoicedQuantity,
      orderedUnitPrice: current.orderedUnitPrice,
      invoicedUnitPrice: input.invoicedUnitPrice,
    });
    const duplicate = await client.query(`
      SELECT 1 FROM public.customer_three_way_matches
      WHERE customer_invoice_id=$1
        AND request_line_id=$2
        AND company_id=$3
        AND idempotency_key<>$4
      LIMIT 1
    `, [
      input.customerInvoiceId,
      input.requestLineId,
      current.companyId,
      input.idempotencyKey,
    ]);
    const exceptionCodes = evaluation.exceptions.filter((code) =>
      code !== "MISSING_QUOTATION" && code !== "MISSING_INVOICE");
    if (duplicate.rowCount) exceptionCodes.push("DUPLICATE_INVOICE");
    const uniqueExceptions = [...new Set(exceptionCodes)];
    const status = uniqueExceptions.includes("MISSING_RECEIPT")
      ? "NOT_READY"
      : uniqueExceptions.length ? "EXCEPTION" : "MATCHED";

    const inserted = await client.query<{
      id: string;
      status: CustomerMatchSummary["status"];
      exceptionCodes: string[];
    }>(`
      INSERT INTO public.customer_three_way_matches(
        company_id,request_line_id,customer_invoice_id,receipt_line_id,status,
        exception_codes,ordered_quantity_snapshot,received_quantity_snapshot,
        invoiced_quantity_snapshot,ordered_unit_price_snapshot,
        invoiced_unit_price_snapshot,quantity_variance,price_variance,
        evaluated_by_user_id,idempotency_key
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
      )
      ON CONFLICT(company_id,idempotency_key) DO NOTHING
      RETURNING id::text,status,exception_codes AS "exceptionCodes"
    `, [
      current.companyId,
      input.requestLineId,
      input.customerInvoiceId,
      current.receiptLineId ?? null,
      status,
      uniqueExceptions,
      current.orderedQuantity,
      current.receivedQuantity ?? null,
      input.invoicedQuantity,
      current.orderedUnitPrice,
      input.invoicedUnitPrice,
      evaluation.quantityVariance ?? null,
      evaluation.priceVariance ?? 0,
      actor.id,
      input.idempotencyKey,
    ]);
    if (!inserted.rows[0]) {
      const concurrent = replayResult(
        await replay(client, current.companyId, input.idempotencyKey),
        actor,
        input,
      );
      if (!concurrent) {
        throw new Error("Three-way match replay could not be verified.");
      }
      return concurrent;
    }

    const event = await appendWorkflowEvent(client, {
      companyId: current.companyId,
      branchId: current.branchId,
      requestId: current.requestId,
      aggregateType: "request",
      aggregateId: current.requestId,
      eventKey: status === "MATCHED"
        ? "three_way_match.completed"
        : "three_way_match.exception",
      stableKey: inserted.rows[0].id,
      actor,
      newState: status,
      source: "WEB",
      metadata: { exceptionCount: uniqueExceptions.length },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["COMPANY_FINANCE"],
      message: status === "MATCHED"
        ? { key: "three_way_match_completed" }
        : {
            key: "three_way_match_exception",
            exceptionCodes: uniqueExceptions,
          },
      routePath: "/finance",
      priority: status === "MATCHED" ? "NORMAL" : "HIGH",
    });
    return {
      id: inserted.rows[0].id,
      status: inserted.rows[0].status,
      exceptionCodes: inserted.rows[0].exceptionCodes,
      created: true,
    } satisfies CustomerMatchEvaluationResult;
  });
}

export async function overrideAuthorizedCustomerMatch(
  actor: AuthenticatedSessionUser,
  matchId: string,
  reason: string,
) {
  requireReviewer(actor);
  if (isDemoMode()) return legacyOverrideCustomerMatch(actor, matchId, reason);
  if (!uuidSchema.safeParse(matchId).success
    || reason.trim().length < 3
    || reason.trim().length > 1_000) {
    throw new Error("A concise override reason is required.");
  }

  await withAuditTransaction({
    userId: actor.id,
    reason: "Independently overrode scoped customer three-way match",
  }, async (client) => {
    const match = await client.query<{
      requestId: string;
      evaluatedByUserId: string;
    }>(`
      SELECT
        request.id::text AS "requestId",
        evidence.evaluated_by_user_id::text AS "evaluatedByUserId"
      FROM public.customer_three_way_matches evidence
      JOIN public.request_lines line ON line.id=evidence.request_line_id
      JOIN public.requests request ON request.id=line.request_id
      WHERE evidence.id=$1
      FOR UPDATE OF evidence
    `, [matchId]);
    const current = match.rows[0];
    if (!current) throw new CustomerMatchAccessUnavailableError();

    const access = await client.query<SnapshotRow>(`
      SELECT public.axora_lock_request_resource_access(
        $1,$2,'finance.match.review',$3,$4
      ) AS snapshot
    `, [actor.id, requireReviewer(actor), current.requestId, new Date()]);
    if (access.rows[0]?.snapshot?.requestId !== current.requestId) {
      throw new CustomerMatchAccessUnavailableError();
    }
    if (current.evaluatedByUserId === actor.id) {
      throw new Error(
        "A different finance reviewer must approve this override.",
      );
    }

    const result = await client.query(`
      UPDATE public.customer_three_way_matches
      SET status='OVERRIDDEN',
          overridden_by_user_id=$2,
          overridden_at=now(),
          override_reason=$3,
          updated_at=now()
      WHERE id=$1 AND status IN ('NOT_READY','EXCEPTION')
    `, [matchId,actor.id,reason.trim()]);
    if (!result.rowCount) {
      throw new Error(
        "A different finance reviewer must approve this override.",
      );
    }
  });
}

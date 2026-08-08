import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { getDemoOperations } from "./demo-operations";
import { isDemoMode, query } from "./db";
import { listAuthorizedRequests } from "./request-reader";
import type {
  ApprovalRecord,
  DeliveryRecord,
  InvoiceRecord,
  PaymentRecord,
  QuotationRecord,
} from "./types";
import type { SupplierRfqActivityRecord } from "./operations";

export class OperationalAccessUnavailableError extends Error {
  constructor() {
    super("The requested operational records are unavailable.");
    this.name = "OperationalAccessUnavailableError";
  }
}

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new OperationalAccessUnavailableError();
  }
  return actor.roleAssignmentId;
}

async function visibleRequestIdentity(actor: AuthenticatedSessionUser) {
  const requests = await listAuthorizedRequests(actor);
  return {
    requestIds: new Set(requests.map((request) => request.id)),
    requestLineIds: new Set(
      requests.flatMap((request) => request.lines.map((line) => line.id)),
    ),
  };
}

export async function listAuthorizedQuotations(
  actor: AuthenticatedSessionUser,
): Promise<QuotationRecord[]> {
  if (isDemoMode()) {
    const { requestLineIds } = await visibleRequestIdentity(actor);
    return getDemoOperations().quotations.filter((quotation) =>
      requestLineIds.has(quotation.requestLineId));
  }

  const capturedAt = new Date();
  try {
    const result = await query<QuotationRecord>(`
      SELECT
        quotation.id::text,
        quotation.request_line_id::text AS "requestLineId",
        line.request_line_code AS "requestLineCode",
        request.order_code AS "orderCode",
        line.product_name_snapshot AS "productName",
        quotation.supplier_id::text AS "supplierId",
        supplier.name AS "supplierName",
        COALESCE(quotation.quotation_reference,'') AS "quotationReference",
        quotation.quotation_date::text AS "quotationDate",
        quotation.unit_price::float8 AS "unitPrice",
        quotation.delivery_charge::float8 AS "deliveryCharge",
        quotation.minimum_order_quantity::float8 AS "minimumOrderQuantity",
        quotation.lead_time_days AS "leadTimeDays",
        quotation.valid_until::text AS "validUntil",
        line.quantity::float8 AS "requestLineQuantity",
        supplier.active AS "supplierActive",
        status.label AS status,
        quotation.selected,
        quotation.selection_reason AS "selectionReason"
      FROM public.quotations quotation
      JOIN public.request_lines line
        ON line.id=quotation.request_line_id
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'sourcing.manage',$3
      ) access ON access.request_id=request.id
      JOIN public.suppliers supplier ON supplier.id=quotation.supplier_id
      JOIN public.lookup_values status ON status.id=quotation.status_id
      ORDER BY quotation.created_at DESC,quotation.id DESC
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

export async function listAuthorizedSupplierRfqs(
  actor: AuthenticatedSessionUser,
): Promise<SupplierRfqActivityRecord[]> {
  if (isDemoMode()) return [];

  const capturedAt = new Date();
  try {
    const result = await query<SupplierRfqActivityRecord>(`
      SELECT
        rfq.id::text,
        rfq.rfq_reference AS reference,
        rfq.request_line_id::text AS "requestLineId",
        line.request_line_code AS "requestLineCode",
        request.order_code AS "orderCode",
        line.product_name_snapshot AS "productName",
        supplier.name AS "supplierName",
        rfq.status,
        rfq.respond_by::text AS "respondBy",
        rfq.issued_at::text AS "issuedAt",
        count(response.id)::int AS "responseCount"
      FROM public.supplier_rfqs rfq
      JOIN public.request_lines line ON line.id=rfq.request_line_id
      JOIN public.requests request
        ON request.id=line.request_id
       AND request.company_id=rfq.company_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'sourcing.manage',$3
      ) access ON access.request_id=request.id
      JOIN public.suppliers supplier ON supplier.id=rfq.supplier_id
      LEFT JOIN public.supplier_quotation_responses response
        ON response.rfq_id=rfq.id
      GROUP BY
        rfq.id,line.request_line_code,request.order_code,
        line.product_name_snapshot,supplier.name
      ORDER BY rfq.issued_at DESC,rfq.id DESC
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

export async function listAuthorizedApprovals(
  actor: AuthenticatedSessionUser,
): Promise<ApprovalRecord[]> {
  if (isDemoMode()) {
    const { requestIds } = await visibleRequestIdentity(actor);
    return getDemoOperations().approvals.filter((approval) =>
      requestIds.has(approval.requestId));
  }

  const capturedAt = new Date();
  try {
    const result = await query<ApprovalRecord>(`
      SELECT
        approval.id::text,
        approval.request_id::text AS "requestId",
        request.order_code AS "orderCode",
        company.name AS "companyName",
        approval.approval_type AS "approvalType",
        approval.status,
        reviewer.display_name AS "reviewerName",
        approval.reason,
        approval.decided_at::text AS "decidedAt",
        approval.created_at::text AS "createdAt"
      FROM public.approvals approval
      JOIN public.requests request ON request.id=approval.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'request.approval_queue.view',$3
      ) access ON access.request_id=request.id
      JOIN public.companies company ON company.id=request.company_id
      LEFT JOIN public.users reviewer ON reviewer.id=approval.reviewer_id
      ORDER BY approval.created_at DESC,approval.id DESC
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

export async function listAuthorizedDeliveries(
  actor: AuthenticatedSessionUser,
): Promise<DeliveryRecord[]> {
  if (isDemoMode()) {
    const { requestLineIds } = await visibleRequestIdentity(actor);
    return getDemoOperations().deliveries.filter((delivery) =>
      requestLineIds.has(delivery.requestLineId));
  }

  const capturedAt = new Date();
  try {
    const result = await query<DeliveryRecord>(`
      SELECT
        delivery.id::text,
        delivery.request_line_id::text AS "requestLineId",
        line.request_line_code AS "requestLineCode",
        request.order_code AS "orderCode",
        company.name AS "companyName",
        line.product_name_snapshot AS "productName",
        delivery.expected_date::text AS "expectedDate",
        delivery.revised_date::text AS "revisedDate",
        delivery.actual_date::text AS "actualDate",
        status.label AS status,
        delivery.quantity_received::float8 AS "quantityReceived",
        delivery.received_by AS "receivedBy",
        delivery.issue_reason AS "issueReason",
        delivery.created_at::text AS "createdAt"
      FROM public.deliveries delivery
      JOIN public.request_lines line
        ON line.id=delivery.request_line_id
      JOIN public.requests request ON request.id=line.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'delivery.view',$3
      ) access ON access.request_id=request.id
      JOIN public.companies company ON company.id=request.company_id
      JOIN public.lookup_values status ON status.id=delivery.status_id
      ORDER BY delivery.created_at DESC,delivery.id DESC
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

interface InvoiceVisibilityRow extends QueryResultRow, InvoiceRecord {}

export async function listAuthorizedInvoices(
  actor: AuthenticatedSessionUser,
): Promise<InvoiceRecord[]> {
  if (isDemoMode()) {
    const { requestIds } = await visibleRequestIdentity(actor);
    const platformInternal = actor.accountKind === "PLATFORM"
      && actor.scopeType === "PLATFORM";
    return getDemoOperations().invoices.filter((invoice) =>
      requestIds.has(invoice.requestId)
      && (invoice.direction === "CUSTOMER" || platformInternal));
  }

  const capturedAt = new Date();
  try {
    const result = await query<InvoiceVisibilityRow>(`
      SELECT
        balance.id::text,
        balance.direction,
        balance.request_id::text AS "requestId",
        request.order_code AS "orderCode",
        CASE WHEN balance.direction='CUSTOMER'
          THEN company.name ELSE supplier.name END AS counterparty,
        balance.invoice_number AS "invoiceNumber",
        balance.invoice_date::text AS "invoiceDate",
        balance.due_date::text AS "dueDate",
        balance.amount::float8,
        invoice_status.label AS status,
        balance.paid_amount::float8 AS "paidAmount",
        balance.outstanding_amount::float8 AS "outstandingAmount",
        balance.payment_status AS "paymentStatus",
        request_status.label AS "requestStatus"
      FROM public.v_invoice_balances balance
      JOIN public.requests request ON request.id=balance.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'finance.invoice.view',$3
      ) access ON access.request_id=request.id
      LEFT JOIN public.axora_operation_request_access_rows(
        $1,$2,'platform.view',$3
      ) platform_access ON platform_access.request_id=request.id
      LEFT JOIN public.companies company ON company.id=balance.company_id
      LEFT JOIN public.suppliers supplier ON supplier.id=balance.supplier_id
      JOIN public.lookup_values invoice_status
        ON invoice_status.id=balance.status_id
      JOIN public.lookup_values request_status
        ON request_status.id=request.status_id
      WHERE balance.direction='CUSTOMER'
         OR platform_access.request_id IS NOT NULL
      ORDER BY balance.invoice_date DESC,balance.invoice_number,balance.id
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

export async function listAuthorizedPayments(
  actor: AuthenticatedSessionUser,
): Promise<PaymentRecord[]> {
  if (isDemoMode()) {
    const invoices = await listAuthorizedInvoices(actor);
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    return getDemoOperations().payments.filter((payment) =>
      invoiceIds.has(payment.invoiceId));
  }

  const capturedAt = new Date();
  try {
    const result = await query<PaymentRecord>(`
      SELECT
        payment.id::text,
        payment.invoice_id::text AS "invoiceId",
        invoice.invoice_number AS "invoiceNumber",
        payment.payment_date::text AS "paymentDate",
        payment.amount::float8,
        payment.method,
        payment.reference,
        recorder.display_name AS "recordedByName"
      FROM public.payments payment
      JOIN public.invoices invoice ON invoice.id=payment.invoice_id
      JOIN public.requests request ON request.id=invoice.request_id
      JOIN public.axora_operation_request_access_rows(
        $1,$2,'finance.invoice.view',$3
      ) access ON access.request_id=request.id
      LEFT JOIN public.axora_operation_request_access_rows(
        $1,$2,'platform.view',$3
      ) platform_access ON platform_access.request_id=request.id
      LEFT JOIN public.users recorder ON recorder.id=payment.recorded_by
      WHERE invoice.direction='CUSTOMER'
         OR platform_access.request_id IS NOT NULL
      ORDER BY payment.payment_date DESC,payment.created_at DESC,payment.id
    `, [actor.id, assignmentId(actor), capturedAt]);
    return result.rows;
  } catch (error) {
    if (error instanceof OperationalAccessUnavailableError) throw error;
    throw new OperationalAccessUnavailableError();
  }
}

export const operationalIsolationInternals = {
  assignmentId,
};

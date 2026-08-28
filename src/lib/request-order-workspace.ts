import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { createDeliveryEvidenceAccessUrl } from "./delivery-proof";
import { isDemoMode, withAuditTransaction } from "./db";
import type { DeliveryStatus, ProcurementRequest } from "./types";

export type CanonicalDeliveryState =
  | "AWAITING_ASSIGNMENT" | "ASSIGNED" | "ACCEPTED" | "SHOPPING"
  | "AWAITING_SUBSTITUTE_APPROVAL" | "AWAITING_ADDITIONAL_APPROVAL"
  | "ITEMS_ACQUIRED" | "OUT_FOR_DELIVERY" | "ARRIVED"
  | "PARTIALLY_DELIVERED" | "DELIVERED" | "COMPLETED"
  | "RESCHEDULED" | "FAILED" | "CANCELLED" | "RETURNED";

export function customerDeliveryStatus(state?: CanonicalDeliveryState): DeliveryStatus {
  if (!state) return "Not Scheduled";
  return ({
    AWAITING_ASSIGNMENT: "Awaiting Assignment", ASSIGNED: "Assigned", ACCEPTED: "Accepted",
    SHOPPING: "Preparing", AWAITING_SUBSTITUTE_APPROVAL: "Preparing",
    AWAITING_ADDITIONAL_APPROVAL: "Preparing", ITEMS_ACQUIRED: "Items Acquired",
    OUT_FOR_DELIVERY: "Out for Delivery", ARRIVED: "Arrived",
    PARTIALLY_DELIVERED: "Partially Delivered", DELIVERED: "Delivered",
    COMPLETED: "Completed", RESCHEDULED: "Scheduled", FAILED: "Failed",
    CANCELLED: "Cancelled", RETURNED: "Failed",
  } satisfies Record<CanonicalDeliveryState, DeliveryStatus>)[state];
}

export interface RequestOrderWorkspace {
  delivery?: {
    id: string;
    code: string;
    status: CanonicalDeliveryState;
    statusChangedAt: string;
    deliveredAt?: string;
    driverUserId?: string;
    driverName?: string;
    receiverName?: string;
    proofPolicy: string[];
    receiptId?: string;
    receiptReference?: string;
    receiptStatus?: string;
    receivedAt?: string;
    canConfirmReceipt: boolean;
    lines: Array<{
      id: string; productName: string; unit: string;
      plannedQuantity: number; deliveredQuantity?: number;
    }>;
    evidence: Array<{
      id: string;
      type: "PHOTO" | "SIGNATURE" | "DELIVERY_NOTE";
      fileName: string;
      contentType: string;
      capturedAt: string;
      recipientIdentity?: string;
      accessUrl: string;
    }>;
  };
  invoice?: {
    id: string;
    number: string;
    status: string;
    paymentStatus: "PAID" | "PARTIAL" | "UNPAID";
    amount: number;
    paidAmount: number;
    outstandingAmount: number;
    invoiceDate: string;
    finalizedAt?: string;
  };
}

interface WorkspaceRow extends QueryResultRow {
  deliveryId?: string;
  deliveryCode?: string;
  deliveryStatus?: CanonicalDeliveryState;
  statusChangedAt?: string;
  deliveredAt?: string;
  driverUserId?: string;
  driverName?: string;
  receiverName?: string;
  proofPolicy?: string[];
  receiptId?: string;
  receiptReference?: string;
  receiptStatus?: string;
  receivedAt?: string;
  canConfirmReceipt: boolean;
  deliveryLines: Array<{
    id: string; productName: string; unit: string;
    plannedQuantity: number; deliveredQuantity?: number;
  }>;
  evidence: Array<{
    id: string; type: "PHOTO" | "SIGNATURE" | "DELIVERY_NOTE";
    fileName: string; contentType: string; capturedAt: string;
    recipientIdentity?: string;
  }>;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  invoiceAmount?: number;
  invoicePaidAmount?: number;
  invoiceDate?: string;
  invoiceFinalizedAt?: string;
}

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("The request is unavailable.");
  return actor.roleAssignmentId;
}

function demoWorkspace(request: ProcurementRequest): RequestOrderWorkspace {
  const lineState = request.lines[0]?.deliveryStatus;
  const status: CanonicalDeliveryState | undefined = request.status === "Completed" ? "COMPLETED" : ({
    "Awaiting Assignment": "AWAITING_ASSIGNMENT", Assigned: "ASSIGNED", Accepted: "ACCEPTED",
    Preparing: "SHOPPING", "Items Acquired": "ITEMS_ACQUIRED",
    "Out for Delivery": "OUT_FOR_DELIVERY", Arrived: "ARRIVED",
    "Partially Delivered": "PARTIALLY_DELIVERED", Delivered: "DELIVERED",
    Completed: "COMPLETED", Failed: "FAILED", Cancelled: "CANCELLED",
  } as Record<string, CanonicalDeliveryState>)[lineState ?? ""];
  return {
    ...(status ? { delivery: {
    id: `demo-${request.id}`, code: request.orderCode, status,
    statusChangedAt: request.completedDate ?? request.requestDate,
    proofPolicy: request.id === "order-16" ? ["PHOTO", "OTP"] : ["PHOTO"],
    canConfirmReceipt: false,
    lines: request.lines.map((line) => ({
      id: line.id, productName: line.productName, unit: line.unit,
      plannedQuantity: line.quantity,
      ...(line.quantityReceived ? { deliveredQuantity: line.quantityReceived } : {}),
    })), evidence: [],
    } } : {}),
    ...(request.invoiceNumber ? { invoice: {
      id: `demo-invoice-${request.id}`, number: request.invoiceNumber,
      status: request.invoiceStatus ?? "Issued",
      paymentStatus: request.paymentStatus === "Paid" ? "PAID" as const
        : request.paymentStatus === "Partial" ? "PARTIAL" as const : "UNPAID" as const,
      amount: request.estimatedTotal,
      paidAmount: request.paymentStatus === "Paid" ? request.estimatedTotal : 0,
      outstandingAmount: request.paymentStatus === "Paid" ? 0 : request.estimatedTotal,
      invoiceDate: request.completedDate ?? request.requestDate,
    } } : {}),
  };
}

export async function getRequestOrderWorkspace(
  actor: AuthenticatedSessionUser,
  request: ProcurementRequest,
): Promise<RequestOrderWorkspace> {
  if (isDemoMode()) return demoWorkspace(request);
  const row = await withAuditTransaction({ actor, reason: "Viewed canonical request order workspace" }, async (client) => {
    const result = await client.query<WorkspaceRow>(`
      SELECT
        job.id::text AS "deliveryId",job.job_code AS "deliveryCode",
        job.status AS "deliveryStatus",job.status_changed_at::text AS "statusChangedAt",
        delivered.received_at::text AS "deliveredAt",
        assigned.driver_user_id::text AS "driverUserId",assigned.driver_name AS "driverName",
        NULLIF(delivered.metadata->>'receiverName','') AS "receiverName",
        job.proof_policy AS "proofPolicy",
        receipt.id::text AS "receiptId",receipt.receipt_reference AS "receiptReference",
        receipt.status AS "receiptStatus",receipt.received_at::text AS "receivedAt",
        ($4::boolean AND receipt.id IS NULL AND delivered.received_at IS NOT NULL
          AND public.axora_request_resource_access(
            $1,$2,'receiving.confirm',request.id,$3
          ) IS NOT NULL) AS "canConfirmReceipt",
        COALESCE(delivery_lines.items,'[]'::jsonb) AS "deliveryLines",
        COALESCE(proof.items,'[]'::jsonb) AS evidence,
        invoice.id::text AS "invoiceId",invoice.invoice_number AS "invoiceNumber",
        invoice.invoice_status AS "invoiceStatus",invoice.amount::float8 AS "invoiceAmount",
        invoice.paid_amount::float8 AS "invoicePaidAmount",
        invoice.invoice_date::text AS "invoiceDate",
        invoice.finalized_at::text AS "invoiceFinalizedAt"
      FROM public.requests request
      LEFT JOIN LATERAL (
        SELECT delivery_job.*
        FROM public.delivery_jobs delivery_job
        WHERE delivery_job.request_id=request.id
          AND public.axora_request_resource_access(
            $1,$2,'delivery.view',request.id,$3
          ) IS NOT NULL
        ORDER BY delivery_job.status_changed_at DESC,delivery_job.id DESC
        LIMIT 1
      ) job ON true
      LEFT JOIN LATERAL (
        SELECT event.received_at,event.metadata
        FROM public.delivery_job_events event
        JOIN public.delivery_job_assignments evidence_assignment
          ON evidence_assignment.id=event.assignment_id
         AND evidence_assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
        WHERE event.delivery_job_id=job.id
          AND event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')
        ORDER BY event.received_at DESC,event.id DESC LIMIT 1
      ) delivered ON true
      LEFT JOIN LATERAL (
        SELECT assignment.driver_user_id,profile.display_name AS driver_name
        FROM public.delivery_job_assignments assignment
        JOIN public.user_profiles profile ON profile.user_id=assignment.driver_user_id
        WHERE assignment.delivery_job_id=job.id
        ORDER BY (assignment.status IN ('ASSIGNED','ACCEPTED')) DESC,
          assignment.assigned_at DESC,assignment.id DESC LIMIT 1
      ) assigned ON true
      LEFT JOIN LATERAL (
        SELECT customer_receipt.* FROM public.receipts customer_receipt
        WHERE customer_receipt.delivery_job_id=job.id
        ORDER BY customer_receipt.recorded_at DESC,customer_receipt.id DESC LIMIT 1
      ) receipt ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id',job_line.id::text,'productName',request_line.product_name_snapshot,
          'unit',job_line.unit_of_measure_snapshot,
          'plannedQuantity',job_line.quantity_to_deliver::float8,
          'deliveredQuantity',(outcome.value->>'deliveredQuantity')::float8
        )) ORDER BY request_line.product_name_snapshot,job_line.id) AS items
        FROM public.delivery_job_lines job_line
        JOIN public.request_lines request_line ON request_line.id=job_line.request_line_id
        LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(delivered.metadata->'lineOutcomes')='array'
            THEN delivered.metadata->'lineOutcomes' ELSE '[]'::jsonb END
        ) outcome(value) ON outcome.value->>'deliveryJobLineId'=job_line.id::text
        WHERE job_line.delivery_job_id=job.id
      ) delivery_lines ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id',evidence.id::text,'type',evidence.evidence_type,
          'fileName',evidence.file_name,'contentType',evidence.content_type,
          'capturedAt',evidence.captured_at,
          'recipientIdentity',evidence.recipient_identity
        ) ORDER BY evidence.captured_at,evidence.id) AS items
        FROM public.delivery_evidence evidence
        WHERE evidence.delivery_job_id=job.id
          AND evidence.evidence_type<>'LOCATION'
          AND evidence.validation_status='ACCEPTED'
          AND evidence.malware_status<>'QUARANTINED'
          AND (evidence.retention_until>$3 OR evidence.legal_hold)
          AND NOT EXISTS (
            SELECT 1 FROM public.delivery_evidence newer
            WHERE newer.supersedes_evidence_id=evidence.id
          )
      ) proof ON true
      LEFT JOIN LATERAL (
        SELECT customer_invoice.id,customer_invoice.invoice_number,
          COALESCE(customer_invoice.lifecycle_status,status.label) AS invoice_status,
          customer_invoice.amount,customer_invoice.invoice_date,
          customer_invoice.finalized_at,COALESCE(sum(payment.amount),0) AS paid_amount
        FROM public.invoices customer_invoice
        JOIN public.lookup_values status ON status.id=customer_invoice.status_id
        LEFT JOIN public.payments payment ON payment.invoice_id=customer_invoice.id
        WHERE customer_invoice.request_id=request.id
          AND customer_invoice.direction='CUSTOMER'
          AND COALESCE(customer_invoice.lifecycle_status,status.label)<>'CANCELLED'
          AND public.axora_request_resource_access(
            $1,$2,'finance.invoice.view',request.id,$3
          ) IS NOT NULL
        GROUP BY customer_invoice.id,status.label
        ORDER BY customer_invoice.invoice_date DESC,customer_invoice.id DESC LIMIT 1
      ) invoice ON true
      WHERE request.id=$5
        AND public.axora_request_resource_access(
          $1,$2,'request.view',request.id,$3
        ) IS NOT NULL
    `, [actor.id, assignmentId(actor), new Date(), actor.accountKind === "COMPANY", request.id]);
    return result.rows[0];
  });
  if (!row) return {};
  const paidAmount = Number(row.invoicePaidAmount ?? 0);
  const amount = Number(row.invoiceAmount ?? 0);
  return {
    ...(row.deliveryId && row.deliveryCode && row.deliveryStatus && row.statusChangedAt ? { delivery: {
      id: row.deliveryId, code: row.deliveryCode, status: row.deliveryStatus,
      statusChangedAt: row.statusChangedAt,
      ...(row.deliveredAt ? { deliveredAt: row.deliveredAt } : {}),
      ...(row.driverUserId ? { driverUserId: row.driverUserId } : {}),
      ...(row.driverName ? { driverName: row.driverName } : {}),
      ...(row.receiverName ? { receiverName: row.receiverName } : {}),
      proofPolicy: row.proofPolicy ?? [],
      ...(row.receiptId ? { receiptId: row.receiptId } : {}),
      ...(row.receiptReference ? { receiptReference: row.receiptReference } : {}),
      ...(row.receiptStatus ? { receiptStatus: row.receiptStatus } : {}),
      ...(row.receivedAt ? { receivedAt: row.receivedAt } : {}),
      canConfirmReceipt: row.canConfirmReceipt,
      lines: (row.deliveryLines ?? []).map((line) => ({
        ...line,
        plannedQuantity: Number(line.plannedQuantity),
        ...(line.deliveredQuantity === undefined ? {}
          : { deliveredQuantity: Number(line.deliveredQuantity) }),
      })),
      evidence: row.evidence.map((item) => ({
        ...item,
        accessUrl: createDeliveryEvidenceAccessUrl({ actorId: actor.id, evidenceId: item.id }),
      })),
    } } : {}),
    ...(row.invoiceId && row.invoiceNumber && row.invoiceStatus && row.invoiceDate ? { invoice: {
      id: row.invoiceId, number: row.invoiceNumber, status: row.invoiceStatus,
      paymentStatus: paidAmount >= amount ? "PAID" : paidAmount > 0 ? "PARTIAL" : "UNPAID",
      amount, paidAmount, outstandingAmount: Math.max(amount - paidAmount, 0),
      invoiceDate: row.invoiceDate,
      ...(row.invoiceFinalizedAt ? { finalizedAt: row.invoiceFinalizedAt } : {}),
    } } : {}),
  };
}

export const requestOrderWorkspaceInternals = { demoWorkspace };

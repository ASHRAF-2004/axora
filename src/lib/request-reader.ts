import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { calculateTotals } from "./domain";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import { loadOrganizationDirectory } from "./organization-access";
import { canAccess } from "./permissions";
import {
  filterVisibleDemoRequests,
  findVisibleDemoRequest,
  RequestAccessUnavailableError,
} from "./request-isolation";
import { listSuppliers } from "./repository";
import type {
  DashboardData,
  ProcurementRequest,
} from "./types";
import type {
  WorkflowActorKind,
  WorkflowJson,
  WorkflowMetadata,
} from "./workflow-events";
import type { RequestWorkflowEvent } from "./workflow-repository";

interface RequestRow extends QueryResultRow {
  id: string;
  createdById?: string;
  orderCode: string;
  requestDate: string;
  requestType: ProcurementRequest["requestType"];
  companyId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  department: string;
  requestedBy: string;
  requesterContact: string;
  neededByDate: string;
  urgency: ProcurementRequest["urgency"];
  status: ProcurementRequest["status"];
  notes?: string;
  issueReason?: string;
  approvalStatus: ProcurementRequest["approvalStatus"];
  approvalReason?: string;
  approvedByName?: string;
  subtotal: number;
  estimatedDeliveryFee: number;
  taxRate: number;
  taxAmount: number;
  estimatedTotal: number;
  invoiceStatus?: ProcurementRequest["invoiceStatus"];
  paymentStatus?: ProcurementRequest["paymentStatus"];
  invoiceNumber?: string;
  completedDate?: string;
  lineId?: string;
  lineCode?: string;
  productId?: string;
  productCode?: string;
  productName?: string;
  category?: string;
  subcategory?: string;
  specification?: string;
  quantity?: number;
  unit?: string;
  supplierId?: string;
  supplierName?: string;
  quotationReference?: string;
  supplierConfirmationStatus?: string;
  unitBuyPrice?: number;
  unitSellPrice?: number;
  deliveryCharge?: number;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  deliveryStatus?: ProcurementRequest["lines"][number]["deliveryStatus"];
  quantityReceived?: number;
}

function requireAssignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new RequestAccessUnavailableError();
  return actor.roleAssignmentId;
}

function groupRequestRows(rows: RequestRow[]): ProcurementRequest[] {
  const requests = new Map<string, ProcurementRequest>();
  for (const row of rows) {
    if (!requests.has(row.id)) {
      requests.set(row.id, {
        id: row.id,
        createdById: row.createdById,
        orderCode: row.orderCode,
        requestDate: row.requestDate,
        requestType: row.requestType,
        companyId: row.companyId,
        companyName: row.companyName,
        branchId: row.branchId,
        branchName: row.branchName,
        department: row.department,
        requestedBy: row.requestedBy,
        requesterContact: row.requesterContact,
        neededByDate: row.neededByDate,
        urgency: row.urgency,
        status: row.status,
        notes: row.notes,
        issueReason: row.issueReason,
        approvalStatus: row.approvalStatus,
        approvalReason: row.approvalReason,
        approvedByName: row.approvedByName,
        subtotal: Number(row.subtotal ?? 0),
        estimatedDeliveryFee: Number(row.estimatedDeliveryFee ?? 0),
        taxRate: Number(row.taxRate ?? 0),
        taxAmount: Number(row.taxAmount ?? 0),
        estimatedTotal: Number(row.estimatedTotal ?? 0),
        invoiceStatus: row.invoiceStatus,
        paymentStatus: row.paymentStatus,
        invoiceNumber: row.invoiceNumber,
        completedDate: row.completedDate,
        lines: [],
      });
    }
    if (row.lineId && row.productName && row.category
      && row.unit && row.deliveryStatus) {
      requests.get(row.id)!.lines.push({
        id: row.lineId,
        code: row.lineCode ?? "",
        productId: row.productId,
        productCode: row.productCode,
        productName: row.productName,
        category: row.category,
        subcategory: row.subcategory,
        specification: row.specification,
        quantity: Number(row.quantity ?? 0),
        unit: row.unit,
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        quotationReference: row.quotationReference,
        supplierConfirmationStatus: row.supplierConfirmationStatus,
        unitBuyPrice: Number(row.unitBuyPrice ?? 0),
        unitSellPrice: Number(row.unitSellPrice ?? 0),
        deliveryCharge: Number(row.deliveryCharge ?? 0),
        expectedDeliveryDate: row.expectedDeliveryDate,
        actualDeliveryDate: row.actualDeliveryDate,
        deliveryStatus: row.deliveryStatus,
        quantityReceived: Number(row.quantityReceived ?? 0),
      });
    }
  }
  return [...requests.values()];
}

const requestSelect = `SELECT
  r.id::text,
  r.created_by::text AS "createdById",
  r.order_code AS "orderCode",
  r.request_date::text AS "requestDate",
  rt.label AS "requestType",
  r.company_id::text AS "companyId",
  c.name AS "companyName",
  r.branch_id::text AS "branchId",
  b.name AS "branchName",
  r.department,
  r.requested_by AS "requestedBy",
  r.requester_contact AS "requesterContact",
  r.needed_by_date::text AS "neededByDate",
  u.label AS urgency,
  rs.label AS status,
  r.notes,
  r.issue_reason AS "issueReason",
  COALESCE(approval.status,'Pending') AS "approvalStatus",
  approval.reason AS "approvalReason",
  approval.reviewer_name AS "approvedByName",
  COALESCE(request_total.subtotal,0)::float8 AS subtotal,
  r.estimated_delivery_fee::float8 AS "estimatedDeliveryFee",
  r.tax_rate::float8 AS "taxRate",
  r.tax_amount::float8 AS "taxAmount",
  (
    COALESCE(request_total.subtotal,0)
    + r.estimated_delivery_fee
    + r.tax_amount
  )::float8 AS "estimatedTotal",
  CASE WHEN access.can_view_finance
    THEN COALESCE(invoice.invoice_status,'Not Issued') END
    AS "invoiceStatus",
  CASE WHEN access.can_view_finance
    THEN COALESCE(invoice.payment_status,'Unpaid') END
    AS "paymentStatus",
  CASE WHEN access.can_view_finance
    THEN invoice.invoice_number END AS "invoiceNumber",
  r.completed_at::date::text AS "completedDate",
  line.id::text AS "lineId",
  line.request_line_code AS "lineCode",
  line.product_id::text AS "productId",
  product.product_code AS "productCode",
  line.product_name_snapshot AS "productName",
  line.category_snapshot AS category,
  line.subcategory_snapshot AS subcategory,
  line.specification,
  line.quantity::float8,
  line.unit_of_measure AS unit,
  CASE WHEN access.can_view_sourcing
    THEN line.selected_supplier_id::text END AS "supplierId",
  CASE WHEN access.can_view_sourcing
    THEN supplier.name END AS "supplierName",
  CASE WHEN access.can_view_sourcing
    THEN line.quotation_reference END AS "quotationReference",
  CASE WHEN access.can_view_sourcing
    THEN confirmation.label END AS "supplierConfirmationStatus",
  CASE WHEN access.can_view_commercial
    THEN line.unit_buy_price::float8 ELSE 0::float8 END AS "unitBuyPrice",
  line.unit_sell_price::float8 AS "unitSellPrice",
  CASE WHEN access.can_view_commercial
    THEN line.delivery_charge::float8 ELSE 0::float8 END AS "deliveryCharge",
  delivery.expected_date::text AS "expectedDeliveryDate",
  delivery.actual_date::text AS "actualDeliveryDate",
  CASE
    WHEN received.quantity>=line.quantity THEN 'Delivered'
    WHEN received.quantity>0 THEN 'Partially Delivered'
    WHEN delivery.actual_date IS NULL
      AND COALESCE(delivery.revised_date,delivery.expected_date)<current_date
      THEN 'Delayed'
    ELSE COALESCE(delivery_status.label,'Not Scheduled')
  END AS "deliveryStatus",
  COALESCE(received.quantity,0)::float8 AS "quantityReceived"
FROM requests r
JOIN public.axora_request_access_rows($1,$2,$3) access
  ON access.request_id=r.id
JOIN companies c ON c.id=r.company_id
JOIN branches b
  ON b.id=r.branch_id AND b.company_id=r.company_id
JOIN lookup_values rt ON rt.id=r.request_type_id
JOIN lookup_values u ON u.id=r.urgency_id
JOIN lookup_values rs ON rs.id=r.status_id
LEFT JOIN request_lines line ON line.request_id=r.id
LEFT JOIN products product ON product.id=line.product_id
LEFT JOIN suppliers supplier ON supplier.id=line.selected_supplier_id
LEFT JOIN lookup_values confirmation
  ON confirmation.id=line.supplier_confirmation_status_id
LEFT JOIN LATERAL (
  SELECT approval_row.status,approval_row.reason,
    reviewer.display_name AS reviewer_name
  FROM approvals approval_row
  LEFT JOIN users reviewer ON reviewer.id=approval_row.reviewer_id
  WHERE approval_row.request_id=r.id
    AND approval_row.approval_type='Company approval'
  ORDER BY approval_row.created_at DESC
  LIMIT 1
) approval ON true
LEFT JOIN LATERAL (
  SELECT sum(round(total_line.quantity*total_line.unit_sell_price,2))
    AS subtotal
  FROM request_lines total_line
  WHERE total_line.request_id=r.id
) request_total ON true
LEFT JOIN LATERAL (
  SELECT delivery_row.*
  FROM deliveries delivery_row
  WHERE delivery_row.request_line_id=line.id
  ORDER BY delivery_row.created_at DESC
  LIMIT 1
) delivery ON true
LEFT JOIN LATERAL (
  SELECT axora_received_quantity(line.id) AS quantity
  WHERE line.id IS NOT NULL
) received ON true
LEFT JOIN lookup_values delivery_status
  ON delivery_status.id=delivery.status_id
LEFT JOIN LATERAL (
  SELECT
    (array_agg(invoice_row.invoice_number
      ORDER BY invoice_row.invoice_date DESC))[1] AS invoice_number,
    (array_agg(invoice_row.invoice_status
      ORDER BY invoice_row.invoice_date DESC))[1] AS invoice_status,
    CASE
      WHEN sum(invoice_row.paid_amount)>=sum(invoice_row.amount) THEN 'Paid'
      WHEN sum(invoice_row.paid_amount)>0 THEN 'Partial'
      ELSE 'Unpaid'
    END AS payment_status
  FROM (
    SELECT invoice_record.invoice_number,invoice_record.invoice_date,
      invoice_status.label AS invoice_status,invoice_record.amount,
      COALESCE(sum(payment.amount),0) AS paid_amount
    FROM invoices invoice_record
    JOIN lookup_values invoice_status
      ON invoice_status.id=invoice_record.status_id
    LEFT JOIN payments payment ON payment.invoice_id=invoice_record.id
    WHERE invoice_record.request_id=r.id
      AND invoice_record.direction='CUSTOMER'
      AND invoice_status.label<>'Cancelled'
    GROUP BY invoice_record.id,invoice_status.label
  ) invoice_row
) invoice ON true`;

export async function listAuthorizedRequests(
  actor: AuthenticatedSessionUser,
): Promise<ProcurementRequest[]> {
  if (!canAccess(actor,"view_requests")) {
    throw new RequestAccessUnavailableError();
  }
  const capturedAt = new Date();
  if (isDemoMode()) {
    return filterVisibleDemoRequests(
      actor,
      getDemoStore().requests,
      capturedAt,
    );
  }
  const assignmentId = requireAssignment(actor);
  try {
    const result = await withAuditTransaction(
      { userId: actor.id, reason: "Viewed scoped purchase requests" },
      (client) => client.query<RequestRow>(
        `${requestSelect}
         ORDER BY r.request_date DESC,r.order_code,line.request_line_code`,
        [actor.id,assignmentId,capturedAt],
      ),
    );
    return groupRequestRows(result.rows);
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export async function getAuthorizedRequest(
  actor: AuthenticatedSessionUser,
  requestId: string,
): Promise<ProcurementRequest | undefined> {
  if (!canAccess(actor,"view_requests")) {
    throw new RequestAccessUnavailableError();
  }
  const capturedAt = new Date();
  if (isDemoMode()) {
    return findVisibleDemoRequest(
      actor,
      getDemoStore().requests,
      requestId,
      capturedAt,
    );
  }
  const assignmentId = requireAssignment(actor);
  try {
    const result = await withAuditTransaction(
      { userId: actor.id, reason: "Viewed scoped purchase request" },
      (client) => client.query<RequestRow>(
        `${requestSelect}
         WHERE r.id=$4
         ORDER BY line.request_line_code`,
        [actor.id,assignmentId,capturedAt,requestId],
      ),
    );
    return groupRequestRows(result.rows)[0];
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

function metadataText(metadata: unknown,key: string) {
  if (!metadata || typeof metadata!=="object" || Array.isArray(metadata)) {
    return undefined;
  }
  const value=(metadata as Record<string,WorkflowJson>)[key];
  return typeof value==="string" ? value : undefined;
}

function visibleActorName(
  actorKind: WorkflowActorKind,
  actorName: string | undefined,
) {
  return actorKind==="SUPPLIER" ? undefined : actorName;
}

export async function listAuthorizedRequestWorkflowEvents(
  actor: AuthenticatedSessionUser,
  requestId: string,
): Promise<RequestWorkflowEvent[]> {
  if (!canAccess(actor,"view_requests") || isDemoMode()) return [];
  const assignmentId = requireAssignment(actor);
  const capturedAt = new Date();
  try {
    return withAuditTransaction(
      { userId: actor.id, reason: "Viewed scoped request workflow timeline" },
      async (client) => {
        const result = await client.query<{
          id: string;
          eventKey: string;
          actorKind: WorkflowActorKind;
          actorName?: string;
          occurredAt: string;
          recordedAt: string;
          metadata: WorkflowMetadata;
        }>(`
          SELECT event.id::text,event.event_key AS "eventKey",
            event.actor_kind AS "actorKind",
            profile.display_name AS "actorName",
            event.occurred_at::text AS "occurredAt",
            event.recorded_at::text AS "recordedAt",event.metadata
          FROM workflow_events event
          JOIN public.axora_request_access_rows($2,$3,$4) access
            ON access.request_id=event.request_id
          LEFT JOIN user_profiles profile
            ON profile.user_id=event.actor_user_id
          WHERE event.request_id=$1
          ORDER BY event.occurred_at,event.event_version,event.id
        `,[requestId,actor.id,assignmentId,capturedAt]);
        return result.rows.map((row) => ({
          id: row.id,
          eventKey: row.eventKey,
          ...(metadataText(row.metadata,"previousState")
            ? { previousState: metadataText(row.metadata,"previousState") }
            : {}),
          ...(metadataText(row.metadata,"newState")
            ? { newState: metadataText(row.metadata,"newState") }
            : {}),
          ...(metadataText(row.metadata,"reason")
            ? { reason: metadataText(row.metadata,"reason") }
            : {}),
          source: metadataText(row.metadata,"source") ?? "SYSTEM",
          ...(visibleActorName(row.actorKind,row.actorName)
            ? { actorName: row.actorName }
            : {}),
          ...(metadataText(row.metadata,"actorRole")
            ? { actorRole: metadataText(row.metadata,"actorRole") }
            : {}),
          occurredAt: row.occurredAt,
          recordedAt: row.recordedAt,
        }));
      },
    );
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export async function getAuthorizedDashboardData(
  actor: AuthenticatedSessionUser,
): Promise<DashboardData> {
  if (!canAccess(actor,"view_dashboard")) {
    throw new RequestAccessUnavailableError();
  }
  const [requests,organization,suppliers] = await Promise.all([
    listAuthorizedRequests(actor),
    loadOrganizationDirectory(actor),
    listSuppliers(actor),
  ]);
  const totals=calculateTotals(requests);
  const byStatus=Object.entries(requests.reduce<Record<string,number>>(
    (acc,request) => ({
      ...acc,
      [request.status]:(acc[request.status] ?? 0)+1,
    }),
    {},
  )).map(([label,value]) => ({ label,value }));
  const byCompany=Object.entries(requests.reduce<Record<string,number>>(
    (acc,request) => ({
      ...acc,
      [request.companyName]:(acc[request.companyName] ?? 0)+1,
    }),
    {},
  )).map(([label,value]) => ({ label,value }));
  const topProducts=Object.entries(requests.flatMap((request) => request.lines)
    .reduce<Record<string,number>>((acc,line) => ({
      ...acc,
      [line.productName]:(acc[line.productName] ?? 0)+line.quantity,
    }),{}))
    .map(([label,value]) => ({ label,value }))
    .sort((left,right) => right.value-left.value)
    .slice(0,5);
  const today=new Date().toISOString().slice(0,10);
  const attention=requests.filter((request) => request.urgency==="Urgent"
    || (request.neededByDate<today
      && !["Completed","Cancelled"].includes(request.status))
    || request.lines.some((line) => [
      "Delayed","Partially Delivered","Failed",
    ].includes(line.deliveryStatus))
    || (request.invoiceStatus
      && ["Issued","Disputed"].includes(request.invoiceStatus)
      && request.paymentStatus!=="Paid")).slice(0,6);
  return {
    ...totals,
    requestCount: requests.length,
    openRequestCount: requests.filter((request) => ![
      "Completed","Cancelled",
    ].includes(request.status)).length,
    urgentRequestCount: requests.filter((request) => (
      request.urgency==="Urgent"
    )).length,
    delayedDeliveryCount: requests.flatMap((request) => request.lines)
      .filter((line) => line.deliveryStatus==="Delayed").length,
    outstandingInvoiceCount: requests.filter((request) => (
      request.invoiceStatus==="Issued" && request.paymentStatus!=="Paid"
    )).length,
    activeCompanyCount: organization.companies.filter((company) => (
      company.status==="Active"
    )).length,
    activeSupplierCount: suppliers.filter((supplier) => (
      supplier.status==="Active"
    )).length,
    byStatus,
    byCompany,
    topProducts,
    attention,
  };
}

export const requestReaderInternals = {
  groupRequestRows,
  requestSelect,
};

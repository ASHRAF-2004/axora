import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { calculateTotals } from "./domain";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import { loadOrganizationDirectory } from "./organization-access";
import {
  filterVisibleDemoRequests,
  findVisibleDemoRequest,
  RequestAccessUnavailableError,
} from "./request-isolation";
import { listSuppliers } from "./repository";
import { canAccess } from "./permissions";
import type {
  RequestFilterDimension,
  RequestFilters,
} from "./request-filters";
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
  departmentId?: string;
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
        departmentId: row.departmentId,
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
  r.department_id::text AS "departmentId",
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

const requestCustomerTotal = `(
  COALESCE(request_total.subtotal,0)
  +r.estimated_delivery_fee+r.tax_amount
)`;

const requestBudgetException = `CASE
  WHEN latest_escalation.id IS NULL THEN 'NONE'
  WHEN r.approval_state IN ('PENDING_COMPANY','PENDING_AXORA')
    THEN latest_escalation.escalation_type
  ELSE 'RESOLVED'
END`;

const requestSearchFrom = `FROM public.requests r
JOIN public.axora_request_access_rows($1,$2,$3) access
  ON access.request_id=r.id
JOIN public.companies c ON c.id=r.company_id
JOIN public.branches b ON b.id=r.branch_id AND b.company_id=r.company_id
JOIN public.lookup_values rs ON rs.id=r.status_id
LEFT JOIN LATERAL (
  SELECT sum(round(total_line.quantity*total_line.unit_sell_price,2)) AS subtotal
  FROM public.request_lines total_line
  WHERE total_line.request_id=r.id
) request_total ON true
LEFT JOIN LATERAL (
  SELECT escalation.id,escalation.escalation_type
  FROM public.request_approval_escalations escalation
  WHERE escalation.request_id=r.id
    AND escalation.request_version=r.request_version
  ORDER BY escalation.created_at DESC,escalation.id DESC
  LIMIT 1
) latest_escalation ON true`;

function buildRequestSearchSpec(
  filters: RequestFilters,
  timeZone: string,
  canFilterSupplier: boolean,
) {
  const values: unknown[] = [];
  const conditions: string[] = [];
  function bind(value: unknown) {
    values.push(value);
    return `$${values.length + 3}`;
  }
  let timeZoneParameter: string | undefined;
  function zone() {
    timeZoneParameter ??= bind(timeZone);
    return timeZoneParameter;
  }
  function uuidArray(column: string, selected: string[]) {
    if (selected.length) conditions.push(`${column}=ANY(${bind(selected)}::uuid[])`);
  }
  uuidArray("r.company_id", filters.companyIds);
  uuidArray("r.branch_id", filters.branchIds);
  uuidArray("r.department_id", filters.departmentIds);
  uuidArray("r.cost_centre_id", filters.costCentreIds);
  uuidArray("r.created_by", filters.requesterIds);
  if (filters.categories.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.request_lines category_line
      WHERE category_line.request_id=r.id
        AND category_line.category_snapshot=ANY(${bind(filters.categories)}::text[])
    )`);
  }
  if (filters.statuses.length) {
    const exact = filters.statuses.filter((status) => status !== "open");
    const alternatives: string[] = [];
    if (filters.statuses.includes("open")) {
      alternatives.push("rs.label NOT IN ('Completed','Cancelled')");
    }
    if (exact.length) alternatives.push(`rs.label=ANY(${bind(exact)}::text[])`);
    conditions.push(`(${alternatives.join(" OR ")})`);
  }
  if (filters.managerIds.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.company_leads lead
      JOIN public.company_lead_assignments manager_assignment
        ON manager_assignment.lead_id=lead.id
       AND manager_assignment.status='ACTIVE'
      WHERE lead.converted_company_id=r.company_id
        AND manager_assignment.manager_user_id=ANY(${bind(filters.managerIds)}::uuid[])
    )`);
  }
  if (filters.approverIds.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.approvals filter_approval
      WHERE filter_approval.request_id=r.id
        AND filter_approval.reviewer_id=ANY(${bind(filters.approverIds)}::uuid[])
    )`);
  }
  if (filters.deliveryAgentIds.length) {
    conditions.push(`EXISTS (
      SELECT 1 FROM public.delivery_jobs filter_job
      JOIN public.delivery_job_assignments filter_assignment
        ON filter_assignment.delivery_job_id=filter_job.id
       AND filter_assignment.ended_at IS NULL
       AND filter_assignment.status IN ('ASSIGNED','ACCEPTED')
      WHERE filter_job.request_id=r.id
        AND filter_assignment.driver_user_id=ANY(${bind(filters.deliveryAgentIds)}::uuid[])
    )`);
  }
  if (filters.supplierIds.length) {
    if (!canFilterSupplier) {
      conditions.push("FALSE");
    } else {
      conditions.push(`EXISTS (
        SELECT 1 FROM public.request_lines supplier_line
        WHERE supplier_line.request_id=r.id
          AND supplier_line.selected_supplier_id=ANY(${bind(filters.supplierIds)}::uuid[])
      )`);
    }
  }
  if (filters.budgetExceptionStatuses.length) {
    const alternatives: string[] = [];
    const exact = filters.budgetExceptionStatuses.filter((status) => status !== "ACTIVE");
    if (filters.budgetExceptionStatuses.includes("ACTIVE")) {
      alternatives.push("(latest_escalation.id IS NOT NULL AND r.approval_state IN ('PENDING_COMPANY','PENDING_AXORA'))");
    }
    if (exact.length) alternatives.push(`${requestBudgetException}=ANY(${bind(exact)}::text[])`);
    conditions.push(`(${alternatives.join(" OR ")})`);
  }
  const dateFilters: Array<[string | undefined, string, ">=" | "<=", boolean]> = [
    [filters.neededFrom, "r.needed_by_date", ">=", false],
    [filters.neededTo, "r.needed_by_date", "<=", false],
    [filters.submittedFrom, "COALESCE(r.approval_submitted_at,r.created_at)", ">=", true],
    [filters.submittedTo, "COALESCE(r.approval_submitted_at,r.created_at)", "<=", true],
    [filters.approvedFrom, "r.approval_decided_at", ">=", true],
    [filters.approvedTo, "r.approval_decided_at", "<=", true],
    [filters.completedFrom, "r.completed_at", ">=", true],
    [filters.completedTo, "r.completed_at", "<=", true],
  ];
  for (const [value, column, operator, zoned] of dateFilters) {
    if (!value) continue;
    const expression = zoned ? `((${column}) AT TIME ZONE ${zone()})::date` : column;
    conditions.push(`${expression}${operator}${bind(value)}::date`);
  }
  if (filters.minAmount !== undefined) {
    conditions.push(`${requestCustomerTotal}>=${bind(filters.minAmount)}::numeric`);
  }
  if (filters.maxAmount !== undefined) {
    conditions.push(`${requestCustomerTotal}<=${bind(filters.maxAmount)}::numeric`);
  }
  if (filters.query) {
    const search = bind(filters.query);
    conditions.push(`(
      r.order_code ILIKE '%'||${search}||'%'
      OR c.name ILIKE '%'||${search}||'%'
      OR b.name ILIKE '%'||${search}||'%'
      OR EXISTS (
        SELECT 1 FROM public.request_lines search_line
        LEFT JOIN public.products search_product ON search_product.id=search_line.product_id
        WHERE search_line.request_id=r.id AND (
          search_line.product_name_snapshot ILIKE '%'||${search}||'%'
          OR COALESCE(search_product.product_code,'') ILIKE '%'||${search}||'%'
          OR to_tsvector('simple',concat_ws(' ',search_line.product_name_snapshot,
            search_line.category_snapshot,search_line.subcategory_snapshot,
            search_line.specification)) @@ plainto_tsquery('simple',${search})
        )
      )
    )`);
  }
  const orderBy: Record<RequestFilters["sort"], string> = {
    "submitted-desc": "COALESCE(r.approval_submitted_at,r.created_at) DESC,r.id DESC",
    "submitted-asc": "COALESCE(r.approval_submitted_at,r.created_at),r.id",
    "needed-asc": "r.needed_by_date,r.id",
    "needed-desc": "r.needed_by_date DESC,r.id DESC",
    "amount-desc": `${requestCustomerTotal} DESC,r.request_date DESC,r.id`,
    "amount-asc": `${requestCustomerTotal},r.request_date DESC,r.id`,
  };
  return {
    values,
    where: conditions.length ? conditions.join(" AND ") : "TRUE",
    orderBy: orderBy[filters.sort],
  };
}

export interface AuthorizedRequestSearchResult {
  requests: ProcurementRequest[];
  filters: RequestFilters;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuthorizedRequestFilterOption {
  value: string;
  label: string;
  count: number;
}

function demoRequestMatches(request: ProcurementRequest, filters: RequestFilters) {
  const searchable = [request.orderCode,request.companyName,request.branchName,
    ...request.lines.flatMap((line) => [line.productCode ?? "",line.productName,line.category])]
    .join(" ").toLowerCase();
  if (filters.query && !searchable.includes(filters.query.toLowerCase())) return false;
  if (filters.companyIds.length && !filters.companyIds.includes(request.companyId)) return false;
  if (filters.branchIds.length && !filters.branchIds.includes(request.branchId)) return false;
  if (filters.departmentIds.length && (!request.departmentId || !filters.departmentIds.includes(request.departmentId))) return false;
  if (filters.requesterIds.length && (!request.createdById || !filters.requesterIds.includes(request.createdById))) return false;
  if (filters.categories.length && !request.lines.some((line) => filters.categories.includes(line.category))) return false;
  if (filters.statuses.length && !filters.statuses.some((status) => (
    status === "open" ? !["Completed","Cancelled"].includes(request.status) : request.status === status
  ))) return false;
  if (filters.supplierIds.length && !request.lines.some((line) => line.supplierId && filters.supplierIds.includes(line.supplierId))) return false;
  if (filters.managerIds.length || filters.costCentreIds.length || filters.approverIds.length || filters.deliveryAgentIds.length) return false;
  if (filters.budgetExceptionStatuses.length && !filters.budgetExceptionStatuses.includes("NONE")) return false;
  if (filters.neededFrom && request.neededByDate < filters.neededFrom) return false;
  if (filters.neededTo && request.neededByDate > filters.neededTo) return false;
  if (filters.submittedFrom && request.requestDate < filters.submittedFrom) return false;
  if (filters.submittedTo && request.requestDate > filters.submittedTo) return false;
  if (filters.completedFrom && (!request.completedDate || request.completedDate < filters.completedFrom)) return false;
  if (filters.completedTo && (!request.completedDate || request.completedDate > filters.completedTo)) return false;
  if (filters.approvedFrom && (request.approvalStatus !== "Approved" || request.requestDate < filters.approvedFrom)) return false;
  if (filters.approvedTo && (request.approvalStatus !== "Approved" || request.requestDate > filters.approvedTo)) return false;
  if (filters.minAmount !== undefined && request.estimatedTotal < filters.minAmount) return false;
  if (filters.maxAmount !== undefined && request.estimatedTotal > filters.maxAmount) return false;
  return true;
}

function sortDemoRequests(requests: ProcurementRequest[], filters: RequestFilters) {
  return [...requests].sort((left,right) => {
    if (filters.sort === "submitted-asc") return left.requestDate.localeCompare(right.requestDate) || left.id.localeCompare(right.id);
    if (filters.sort === "needed-asc") return left.neededByDate.localeCompare(right.neededByDate) || left.id.localeCompare(right.id);
    if (filters.sort === "needed-desc") return right.neededByDate.localeCompare(left.neededByDate) || right.id.localeCompare(left.id);
    if (filters.sort === "amount-asc") return left.estimatedTotal-right.estimatedTotal || left.id.localeCompare(right.id);
    if (filters.sort === "amount-desc") return right.estimatedTotal-left.estimatedTotal || left.id.localeCompare(right.id);
    return right.requestDate.localeCompare(left.requestDate) || right.id.localeCompare(left.id);
  });
}

async function searchDemoRequests(
  actor: AuthenticatedSessionUser,
  filters: RequestFilters,
  paginate: boolean,
) {
  if (filters.supplierIds.length && !canAccess(actor,"manage_sourcing")) return [];
  const visible = (await filterVisibleDemoRequests(actor,getDemoStore().requests,new Date()))
    .filter((request) => demoRequestMatches(request,filters));
  const sorted = sortDemoRequests(visible,filters);
  if (!paginate) return sorted;
  const start=(filters.page-1)*filters.pageSize;
  return sorted.slice(start,start+filters.pageSize);
}

async function loadAuthorizedFilteredRequests(
  actor: AuthenticatedSessionUser,
  filters: RequestFilters,
  paginate: boolean,
): Promise<AuthorizedRequestSearchResult> {
  if (isDemoMode()) {
    const all = await searchDemoRequests(actor,filters,false);
    const total=all.length;
    const totalPages=Math.max(Math.ceil(total/filters.pageSize),1);
    const page=paginate ? Math.min(filters.page,totalPages) : 1;
    const requests=paginate
      ? all.slice((page-1)*filters.pageSize,page*filters.pageSize)
      : all;
    return { requests,filters:{...filters,page},total,page,
      pageSize:filters.pageSize,totalPages };
  }
  const assignmentId=requireAssignment(actor);
  const capturedAt=new Date();
  const spec=buildRequestSearchSpec(
    filters,actor.timezone ?? "Asia/Kuala_Lumpur",canAccess(actor,"manage_sourcing"),
  );
  const baseValues=[actor.id,assignmentId,capturedAt,...spec.values];
  try {
    return await withAuditTransaction(
      { actor,reason:paginate ? "Filtered scoped purchase requests" : "Exported filtered scoped purchase requests" },
      async (client) => {
        const countResult=await client.query<{total:number}>(
          `SELECT count(*)::int AS total ${requestSearchFrom} WHERE ${spec.where}`,
          baseValues,
        );
        const total=Number(countResult.rows[0]?.total ?? 0);
        const totalPages=Math.max(Math.ceil(total/filters.pageSize),1);
        const page=paginate ? Math.min(filters.page,totalPages) : 1;
        const paginationValues=paginate
          ? [...baseValues,filters.pageSize,(page-1)*filters.pageSize]
          : baseValues;
        const paginationSql=paginate
          ? `LIMIT $${baseValues.length+1} OFFSET $${baseValues.length+2}`
          : "";
        const idResult=await client.query<{id:string}>(
          `SELECT r.id::text AS id ${requestSearchFrom}
           WHERE ${spec.where} ORDER BY ${spec.orderBy} ${paginationSql}`,
          paginationValues,
        );
        const ids=idResult.rows.map((row) => row.id);
        if (!ids.length) {
          return {requests:[],filters:{...filters,page},total,page,
            pageSize:filters.pageSize,totalPages};
        }
        const detailResult=await client.query<RequestRow>(
          `${requestSelect}
           WHERE r.id=ANY($4::uuid[])
           ORDER BY array_position($4::uuid[],r.id),line.request_line_code`,
          [actor.id,assignmentId,capturedAt,ids],
        );
        return {requests:groupRequestRows(detailResult.rows),filters:{...filters,page},
          total,page,pageSize:filters.pageSize,totalPages};
      },
    );
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export function searchAuthorizedRequests(
  actor: AuthenticatedSessionUser,
  filters: RequestFilters,
) {
  return loadAuthorizedFilteredRequests(actor,filters,true);
}

export async function listAuthorizedFilteredRequests(
  actor: AuthenticatedSessionUser,
  filters: RequestFilters,
) {
  return (await loadAuthorizedFilteredRequests(actor,filters,false)).requests;
}

async function demoFilterOptions(
  actor: AuthenticatedSessionUser,
  dimension: RequestFilterDimension,
  queryText: string,
  selectedValues: string[],
) {
  if (dimension==="supplier" && !canAccess(actor,"manage_sourcing")) return [];
  const counts=new Map<string,{label:string;requests:Set<string>}>();
  function add(value:string|undefined,label:string|undefined,requestId:string) {
    if (!value || !label) return;
    const entry=counts.get(value) ?? {label,requests:new Set<string>()};
    entry.requests.add(requestId);counts.set(value,entry);
  }
  const visible=await filterVisibleDemoRequests(actor,getDemoStore().requests,new Date());
  for (const request of visible) {
    if (dimension==="company") add(request.companyId,request.companyName,request.id);
    if (dimension==="branch") add(request.branchId,request.branchName,request.id);
    if (dimension==="department") add(request.departmentId,request.department,request.id);
    if (dimension==="requester") add(request.createdById,request.requestedBy,request.id);
    if (dimension==="category") for (const category of new Set(request.lines.map((line) => line.category))) add(category,category,request.id);
    if (dimension==="supplier") for (const line of request.lines) add(line.supplierId,line.supplierName,request.id);
    if (dimension==="budgetException") add("NONE","NONE",request.id);
  }
  const normalizedQuery=queryText.toLowerCase();
  return [...counts.entries()].map(([value,entry]) => ({value,label:entry.label,count:entry.requests.size}))
    .filter((option) => selectedValues.length
      ? selectedValues.includes(option.value)
      : !normalizedQuery || option.label.toLowerCase().includes(normalizedQuery))
    .sort((left,right) => right.count-left.count || left.label.localeCompare(right.label))
    .slice(0,25);
}

const optionConfigurations: Record<RequestFilterDimension,{value:string;label:string;joins:string}> = {
  company:{value:"r.company_id::text",label:"c.name",joins:""},
  category:{value:"option_line.category_snapshot",label:"option_line.category_snapshot",joins:"JOIN public.request_lines option_line ON option_line.request_id=r.id"},
  manager:{value:"option_manager_assignment.manager_user_id::text",label:"option_manager.display_name",joins:`JOIN public.company_leads option_lead ON option_lead.converted_company_id=r.company_id
    JOIN public.company_lead_assignments option_manager_assignment ON option_manager_assignment.lead_id=option_lead.id AND option_manager_assignment.status='ACTIVE'
    JOIN public.users option_manager ON option_manager.id=option_manager_assignment.manager_user_id`},
  branch:{value:"r.branch_id::text",label:"b.name",joins:""},
  department:{value:"option_department.id::text",label:"option_department.name",joins:"JOIN public.departments option_department ON option_department.id=r.department_id AND option_department.company_id=r.company_id"},
  costCentre:{value:"option_cost_centre.id::text",label:"option_cost_centre.name",joins:"JOIN public.cost_centres option_cost_centre ON option_cost_centre.id=r.cost_centre_id AND option_cost_centre.company_id=r.company_id"},
  requester:{value:"option_requester.id::text",label:"option_requester.display_name",joins:"JOIN public.users option_requester ON option_requester.id=r.created_by"},
  approver:{value:"option_approval.reviewer_id::text",label:"option_approver.display_name",joins:"JOIN public.approvals option_approval ON option_approval.request_id=r.id AND option_approval.reviewer_id IS NOT NULL JOIN public.users option_approver ON option_approver.id=option_approval.reviewer_id"},
  deliveryAgent:{value:"option_delivery_assignment.driver_user_id::text",label:"option_driver.display_name",joins:`JOIN public.delivery_jobs option_job ON option_job.request_id=r.id
    JOIN public.delivery_job_assignments option_delivery_assignment ON option_delivery_assignment.delivery_job_id=option_job.id AND option_delivery_assignment.ended_at IS NULL AND option_delivery_assignment.status IN ('ASSIGNED','ACCEPTED')
    JOIN public.users option_driver ON option_driver.id=option_delivery_assignment.driver_user_id`},
  supplier:{value:"option_supplier.id::text",label:"option_supplier.name",joins:"JOIN public.request_lines option_supplier_line ON option_supplier_line.request_id=r.id AND option_supplier_line.selected_supplier_id IS NOT NULL JOIN public.suppliers option_supplier ON option_supplier.id=option_supplier_line.selected_supplier_id"},
  budgetException:{value:requestBudgetException,label:requestBudgetException,joins:""},
};

export async function listAuthorizedRequestFilterOptions(
  actor: AuthenticatedSessionUser,
  dimension: RequestFilterDimension,
  queryText="",
  selectedValues:string[]=[],
): Promise<AuthorizedRequestFilterOption[]> {
  if (isDemoMode()) return demoFilterOptions(actor,dimension,queryText,selectedValues);
  if (dimension==="supplier" && !canAccess(actor,"manage_sourcing")) return [];
  const assignmentId=requireAssignment(actor);
  const capturedAt=new Date();
  const config=optionConfigurations[dimension];
  const values:unknown[]=[actor.id,assignmentId,capturedAt];
  const conditions=[`(${config.value}) IS NOT NULL`,`btrim((${config.label})::text)<>''`];
  if (selectedValues.length) {
    values.push(selectedValues);
    conditions.push(`(${config.value})::text=ANY($${values.length}::text[])`);
  } else if (queryText) {
    values.push(`%${queryText}%`);
    conditions.push(`(${config.label})::text ILIKE $${values.length}`);
  }
  try {
    return await withAuditTransaction(
      {actor,reason:`Viewed scoped request filter options: ${dimension}`},
      async (client) => {
        const result=await client.query<{value:string;label:string;count:number}>(`
          SELECT (${config.value})::text AS value,(${config.label})::text AS label,
            count(DISTINCT r.id)::int AS count
          ${requestSearchFrom}
          ${config.joins}
          WHERE ${conditions.join(" AND ")}
          GROUP BY ${config.value},${config.label}
          ORDER BY count DESC,label
          LIMIT 25
        `,values);
        return result.rows.map((row) => ({...row,count:Number(row.count)}));
      },
    );
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export async function listAuthorizedRequests(
  actor: AuthenticatedSessionUser,
): Promise<ProcurementRequest[]> {
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
      { actor, reason: "Viewed scoped purchase requests" },
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
      { actor, reason: "Viewed scoped purchase request" },
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
  if (isDemoMode()) return [];
  const assignmentId = requireAssignment(actor);
  const capturedAt = new Date();
  try {
    return withAuditTransaction(
      { actor, reason: "Viewed scoped request workflow timeline" },
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
  if (!isPlatformAnalyticsActor(actor)) {
    return buildCompanyDashboardData(await listAuthorizedRequests(actor));
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
    scope: "platform",
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
  requestSearchFrom,
  buildRequestSearchSpec,
  demoRequestMatches,
};
import { buildCompanyDashboardData, isPlatformAnalyticsActor } from "@/lib/dashboard-data";

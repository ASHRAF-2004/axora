import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { calculateTotals, roundMoney } from "./domain";
import { getDemoStore } from "./demo-data";
import { getDemoOperations } from "./demo-operations";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { requireSession, type SessionUser } from "./auth";
import { canAccess, canManageCommercialCatalog } from "./permissions";
import type { Branch, Company, DashboardData, ProcurementRequest, Product, RequestStatus } from "./types";
import { validateStatusTransition } from "./workflow";
import { appendWorkflowEvent, notifyWorkflowAudience } from "./workflow-repository";
import { calculateCommercialSellingPrice, withDemoCommercialDefaults } from "./procurement-rules";
import { demoCompanyVisibleToActor } from "./company-lifecycle";

function nextCode(prefix: string, count: number, digits = 3) {
  return `${prefix}-${String(count + 1).padStart(digits, "0")}`;
}

async function actorOrSession(actor?: SessionUser) {
  return actor ?? requireSession();
}

function isPlatformProcurementActor(actor: SessionUser) {
  return (actor.isOwner && ["ADMIN", "PLATFORM_OWNER"].includes(actor.role))
    || (actor.accountKind === "PLATFORM"
    && actor.scopeType === "PLATFORM"
    && ["PLATFORM_OWNER", "PLATFORM_OPERATIONS", "ADMIN"].includes(actor.role));
}

function hasPlatformWideCompanyVisibility(actor: SessionUser) {
  return actor.isOwner || canAccess(actor, "view_all_companies");
}

function tenantClause(actor: SessionUser, column: string) {
  if (actor.isOwner || canAccess(actor, "view_all_companies")) {
    return { sql: "", values: [] as unknown[] };
  }
  if (actor.accountKind === "PLATFORM") {
    if (!actor.roleAssignmentId) return { sql: " WHERE false", values: [] as unknown[] };
    return {
      sql: ` WHERE public.axora_actor_company_accessible($1,$2,${column},now())`,
      values: [actor.id, actor.roleAssignmentId],
    };
  }
  return { sql: ` WHERE ${column} = $1`, values: [actor.companyId] };
}

function tenantAndBranchClause(actor: SessionUser, companyColumn: string, branchColumn: string) {
  if (actor.isOwner || canAccess(actor, "view_all_companies")) {
    return { sql: "", values: [] as unknown[] };
  }
  if (actor.accountKind === "PLATFORM") {
    if (!actor.roleAssignmentId) return { sql: " WHERE false", values: [] as unknown[] };
    return {
      sql: ` WHERE public.axora_actor_company_accessible($1,$2,${companyColumn},now())`,
      values: [actor.id, actor.roleAssignmentId],
    };
  }
  if (actor.branchId) {
    return { sql: ` WHERE ${companyColumn} = $1 AND ${branchColumn} = $2`, values: [actor.companyId, actor.branchId] };
  }
  return { sql: ` WHERE ${companyColumn} = $1`, values: [actor.companyId] };
}

function isSelfScopedRequester(actor: Pick<SessionUser, "isOwner" | "role">) {
  return !actor.isOwner && ["REQUESTER", "OPERATIONS"].includes(actor.role);
}

function requestVisibilityScope(actor: SessionUser, alias: string, startIndex = 1) {
  if (actor.isOwner || canAccess(actor, "view_all_companies")) {
    return { sql: "", values: [] as unknown[] };
  }
  if (actor.accountKind === "PLATFORM") {
    if (!actor.roleAssignmentId) return { sql: "false", values: [] as unknown[] };
    return {
      sql: `public.axora_actor_company_accessible($${startIndex},$${startIndex + 1},${alias}.company_id,now())`,
      values: [actor.id, actor.roleAssignmentId],
    };
  }
  const conditions = [`${alias}.company_id=$${startIndex}`];
  const values: unknown[] = [actor.companyId];
  if (actor.branchId) {
    values.push(actor.branchId);
    conditions.push(`${alias}.branch_id=$${startIndex + values.length - 1}`);
  }
  if (isSelfScopedRequester(actor)) {
    values.push(actor.id);
    conditions.push(`${alias}.created_by=$${startIndex + values.length - 1}`);
  }
  return { sql: conditions.join(" AND "), values };
}

function demoRequestVisibleToActor(request: ProcurementRequest, actor: SessionUser) {
  return isPlatformProcurementActor(actor) || (
    request.companyId === actor.companyId
    && (!actor.branchId || request.branchId === actor.branchId)
    && (!isSelfScopedRequester(actor) || request.createdById === actor.id)
  );
}

function requireCompany(actor: SessionUser, requestedCompanyId?: string) {
  const platformActor = isPlatformProcurementActor(actor);
  const companyId = platformActor ? requestedCompanyId : actor.companyId;
  if (!companyId) throw new Error("Select a company.");
  if (!platformActor && requestedCompanyId && requestedCompanyId !== actor.companyId) throw new Error("You cannot access another company.");
  return companyId;
}

export async function listCompanies(providedActor?: SessionUser): Promise<Company[]> {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode() && actor.role === "CLIENT_ACCOUNT_MANAGER") {
    return getDemoStore().companies.filter((company) => (
      demoCompanyVisibleToActor(actor, company.id)
    ));
  }
  if (isDemoMode()) return hasPlatformWideCompanyVisibility(actor)
    ? getDemoStore().companies
    : getDemoStore().companies.filter((item) => item.id === actor.companyId);
  const scope = tenantClause(actor, "id");
  const result = await query<Company>(`SELECT id::text, company_code AS code, name, industry,
    main_contact_name AS "mainContactName", main_contact_email AS "mainContactEmail", main_contact_phone AS "mainContactPhone",
    billing_contact_name AS "billingContactName", billing_contact_email AS "billingContactEmail", billing_contact_phone AS "billingContactPhone",
    billing_address AS "billingAddress", payment_terms AS "paymentTerms", billing_cycle AS "billingCycle",
    tax_rate::float8 AS "taxRate", estimated_delivery_fee::float8 AS "estimatedDeliveryFee", notes,
    CASE WHEN active THEN 'Active' ELSE 'Inactive' END AS status
    FROM companies${scope.sql} ORDER BY name`, scope.values);
  return result.rows;
}

export async function listBranches(providedActor?: SessionUser): Promise<Branch[]> {
  const actor = await actorOrSession(providedActor);
  if (!canAccess(actor, "view_branches")) throw new Error("Your account cannot view branch information.");
  if (isDemoMode()) {
    if (actor.role === "CLIENT_ACCOUNT_MANAGER") {
      return getDemoStore().branches.filter((branch) => (
        demoCompanyVisibleToActor(actor, branch.companyId)
      ));
    }
    return hasPlatformWideCompanyVisibility(actor)
      ? getDemoStore().branches
      : getDemoStore().branches.filter((item) =>
          item.companyId === actor.companyId && (!actor.branchId || item.id === actor.branchId),
        );
  }
  const scope = tenantAndBranchClause(actor, "b.company_id", "b.id");
  const result = await query<Branch>(`SELECT b.id::text, b.branch_code_id AS code, b.company_id::text AS "companyId", c.name AS "companyName",
    b.name, b.branch_code AS "branchCode", b.delivery_address AS "deliveryAddress", b.city,
    b.contact_name AS "contactName", b.contact_phone AS "contactPhone", b.contact_email AS "contactEmail",
    b.delivery_instructions AS "deliveryInstructions", b.notes, b.monthly_budget::float8 AS "monthlyBudget",
    COALESCE(budget.committed_amount,0)::float8 AS "committedAmount",
    budget.remaining_amount::float8 AS "remainingAmount",
    CASE WHEN b.active THEN 'Active' ELSE 'Inactive' END AS status
    FROM branches b JOIN companies c ON c.id = b.company_id
    LEFT JOIN v_branch_budget_usage budget ON budget.branch_id=b.id
    ${scope.sql} ORDER BY c.name, b.name`, scope.values);
  return result.rows;
}

export async function listProducts(providedActor?: SessionUser): Promise<Product[]> {
  const actor = await actorOrSession(providedActor);
  if (!canAccess(actor, "view_catalog")) throw new Error("Your account cannot view the product catalog.");
  if (isDemoMode()) {
    const managesCatalog = canAccess(actor, "manage_catalog");
    const products = getDemoStore().products.filter((product) =>
      managesCatalog || (product.status === "Active" && (!product.companyId || product.companyId === actor.companyId)),
    );
    const priced = products.map(withDemoCommercialDefaults);
    return managesCatalog ? priced : priced.map((product) => ({
      ...product,
      defaultBuyPrice: 0,
      duplicateWarning: false,
    }));
  }
  const platformActor = canManageCommercialCatalog(actor);
  if (platformActor) {
    if (!actor.roleAssignmentId) throw new Error("Product catalog is unavailable.");
    const privileged = await query<{ products: Product[] }>(
      "SELECT public.axora_product_administration_catalog($1,$2,now()) AS products",
      [actor.id, actor.roleAssignmentId],
    );
    return privileged.rows[0]?.products ?? [];
  }
  const result = await query<Product>(`SELECT offer.id::text,offer.company_id::text AS "companyId",c.name AS "companyName",offer.product_code AS code, offer.name, offer.category, offer.subcategory, offer.brand, offer.product_size AS size,
    offer.unit_of_measure AS unit, offer.packaging, offer.description, 0::float8 AS "defaultBuyPrice",
    offer.default_sell_price::float8 AS "defaultSellPrice",
    offer.price_rule_version AS "priceRuleVersion",offer.price_effective_from::text AS "priceEffectiveFrom",
    offer.price_changed_at::text AS "priceChangedAt",offer.price_currency AS "priceCurrency",
    offer.delivery_sla_days AS "deliverySlaDays",offer.has_image AS "hasImage",
    offer.image_alt_text AS "imageAltText",'Active'::text AS status,
    false AS "duplicateWarning"
    FROM v_customer_catalog_products offer
    LEFT JOIN companies c ON c.id=offer.company_id
    WHERE offer.active=true AND offer.needs_review=false
      AND (offer.company_id IS NULL OR offer.company_id=$1)
    ORDER BY offer.name`, [actor.companyId]);
  return result.rows;
}

interface RequestRow {
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
  invoiceStatus: ProcurementRequest["invoiceStatus"];
  paymentStatus: ProcurementRequest["paymentStatus"];
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
    if (row.lineId && row.productName && row.category && row.unit && row.deliveryStatus) {
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

function hideAxoraCommercialData(requests: ProcurementRequest[], canViewInvoices: boolean) {
  return requests.map((request) => ({
    ...request,
    invoiceStatus: canViewInvoices ? request.invoiceStatus : undefined,
    paymentStatus: canViewInvoices ? request.paymentStatus : undefined,
    invoiceNumber: canViewInvoices ? request.invoiceNumber : undefined,
    lines: request.lines.map((line) => ({
      ...line,
      supplierId: undefined,
      supplierName: undefined,
      quotationReference: undefined,
      supplierConfirmationStatus: undefined,
      unitBuyPrice: 0,
      deliveryCharge: 0,
    })),
  }));
}

const requestSelect = `SELECT r.id::text, r.created_by::text AS "createdById", r.order_code AS "orderCode", r.request_date::text AS "requestDate",
  rt.label AS "requestType", r.company_id::text AS "companyId", c.name AS "companyName", r.branch_id::text AS "branchId", b.name AS "branchName",
  r.department, r.requested_by AS "requestedBy", r.requester_contact AS "requesterContact", r.needed_by_date::text AS "neededByDate",
  u.label AS urgency, rs.label AS status, r.notes, r.issue_reason AS "issueReason",
  COALESCE(approval.status, 'Pending') AS "approvalStatus", approval.reason AS "approvalReason",
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
  COALESCE(i.invoice_status, 'Not Issued') AS "invoiceStatus", COALESCE(i.payment_status, 'Unpaid') AS "paymentStatus",
  i.invoice_number AS "invoiceNumber", r.completed_at::date::text AS "completedDate",
  l.id::text AS "lineId", l.request_line_code AS "lineCode", l.product_id::text AS "productId", p.product_code AS "productCode",
  l.product_name_snapshot AS "productName", l.category_snapshot AS category, l.subcategory_snapshot AS subcategory,
  l.specification, l.quantity::float8, l.unit_of_measure AS unit, l.selected_supplier_id::text AS "supplierId", s.name AS "supplierName",
  l.quotation_reference AS "quotationReference", sc.label AS "supplierConfirmationStatus", l.unit_buy_price::float8 AS "unitBuyPrice",
  l.unit_sell_price::float8 AS "unitSellPrice", l.delivery_charge::float8 AS "deliveryCharge",
  d.expected_date::text AS "expectedDeliveryDate", d.actual_date::text AS "actualDeliveryDate",
  CASE
    WHEN received.quantity>=l.quantity THEN 'Delivered'
    WHEN received.quantity>0 THEN 'Partially Delivered'
    WHEN d.actual_date IS NULL
      AND COALESCE(d.revised_date,d.expected_date) < current_date THEN 'Delayed'
    ELSE COALESCE(ds.label, 'Not Scheduled')
  END AS "deliveryStatus",
  COALESCE(received.quantity,0)::float8 AS "quantityReceived"
  FROM requests r
  JOIN companies c ON c.id = r.company_id JOIN branches b ON b.id = r.branch_id
  JOIN lookup_values rt ON rt.id = r.request_type_id JOIN lookup_values u ON u.id = r.urgency_id JOIN lookup_values rs ON rs.id = r.status_id
  LEFT JOIN request_lines l ON l.request_id = r.id LEFT JOIN products p ON p.id = l.product_id LEFT JOIN suppliers s ON s.id = l.selected_supplier_id
  LEFT JOIN lookup_values sc ON sc.id = l.supplier_confirmation_status_id
  LEFT JOIN LATERAL (
    SELECT a.status,a.reason,reviewer.display_name AS reviewer_name
    FROM approvals a LEFT JOIN users reviewer ON reviewer.id=a.reviewer_id
    WHERE a.request_id=r.id AND a.approval_type='Company approval'
    ORDER BY a.created_at DESC LIMIT 1
  ) approval ON true
  LEFT JOIN LATERAL (
    SELECT sum(
      round(total_line.quantity * total_line.unit_sell_price,2)
    ) AS subtotal
    FROM request_lines total_line
    WHERE total_line.request_id=r.id
  ) request_total ON true
  LEFT JOIN LATERAL (
    SELECT d1.* FROM deliveries d1
    WHERE d1.request_line_id=l.id
    ORDER BY d1.created_at DESC LIMIT 1
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT axora_received_quantity(l.id) AS quantity
    WHERE l.id IS NOT NULL
  ) received ON true
  LEFT JOIN lookup_values ds ON ds.id = d.status_id
  LEFT JOIN LATERAL (
    SELECT (array_agg(x.invoice_number ORDER BY x.invoice_date DESC))[1] AS invoice_number,
      (array_agg(x.invoice_status ORDER BY x.invoice_date DESC))[1] AS invoice_status,
      CASE WHEN sum(x.paid_amount) >= sum(x.amount) THEN 'Paid' WHEN sum(x.paid_amount) > 0 THEN 'Partial' ELSE 'Unpaid' END AS payment_status
    FROM (
      SELECT inv.invoice_number,inv.invoice_date,iv.label AS invoice_status,inv.amount,COALESCE(sum(pay.amount),0) AS paid_amount
      FROM invoices inv JOIN lookup_values iv ON iv.id=inv.status_id LEFT JOIN payments pay ON pay.invoice_id=inv.id
      WHERE inv.request_id=r.id AND inv.direction='CUSTOMER' AND iv.label<>'Cancelled'
      GROUP BY inv.id,iv.label
    ) x
  ) i ON true`;

export async function listRequests(providedActor?: SessionUser): Promise<ProcurementRequest[]> {
  const actor = await actorOrSession(providedActor);
  if (!canAccess(actor, "view_requests")) throw new Error("Your account cannot view purchase requests.");
  if (isDemoMode()) {
    const requests = hasPlatformWideCompanyVisibility(actor)
      ? getDemoStore().requests
      : getDemoStore().requests.filter((item) => demoRequestVisibleToActor(item, actor));
    return canAccess(actor, "view_internal_cost")
      ? requests
      : hideAxoraCommercialData(requests, canAccess(actor, "view_invoices"));
  }
  const scope = requestVisibilityScope(actor, "r");
  const result = await withAuditTransaction(
    { actor, reason: "Viewed purchase requests" },
    (client) => client.query<RequestRow>(
      `${requestSelect}${scope.sql ? ` WHERE ${scope.sql}` : ""} ORDER BY r.request_date DESC, r.order_code, l.request_line_code`,
      scope.values,
    ),
  );
  const requests = groupRequestRows(result.rows);
  return canAccess(actor, "view_internal_cost")
    ? requests
    : hideAxoraCommercialData(requests, canAccess(actor, "view_invoices"));
}

export async function getRequest(id: string, providedActor?: SessionUser) {
  const actor = await actorOrSession(providedActor);
  if (!canAccess(actor, "view_requests")) throw new Error("Your account cannot view purchase requests.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) =>
      item.id === id
      && demoRequestVisibleToActor(item, actor),
    );
    if (!request || canAccess(actor, "view_internal_cost")) return request;
    return hideAxoraCommercialData([request], canAccess(actor, "view_invoices"))[0];
  }
  const scope = requestVisibilityScope(actor, "r", 2);
  const result = await withAuditTransaction(
    { actor, reason: "Viewed purchase request" },
    (client) => client.query<RequestRow>(
      `${requestSelect} WHERE r.id=$1${scope.sql ? ` AND ${scope.sql}` : ""} ORDER BY l.request_line_code`,
      [id, ...scope.values],
    ),
  );
  const request = groupRequestRows(result.rows)[0];
  if (!request || canAccess(actor, "view_internal_cost")) return request;
  return hideAxoraCommercialData([request], canAccess(actor, "view_invoices"))[0];
}

export async function getDashboardData(providedActor?: SessionUser): Promise<DashboardData> {
  const actor = await actorOrSession(providedActor);
  if (!canAccess(actor, "view_dashboard")) throw new Error("Your account cannot view procurement dashboard data.");
  if (!isPlatformAnalyticsActor(actor)) return buildCompanyDashboardData(await listRequests(actor));
  const [requests, companies] = await Promise.all([listRequests(actor), listCompanies(actor)]);
  const totals = calculateTotals(requests);
  const byStatus = Object.entries(requests.reduce<Record<string, number>>((acc, request) => ({ ...acc, [request.status]: (acc[request.status] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value }));
  const byCompany = Object.entries(requests.reduce<Record<string, number>>((acc, request) => ({ ...acc, [request.companyName]: (acc[request.companyName] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value }));
  const topProducts = Object.entries(requests.flatMap((request) => request.lines).reduce<Record<string, number>>((acc, line) => ({ ...acc, [line.productName]: (acc[line.productName] ?? 0) + line.quantity }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const today = new Date().toISOString().slice(0, 10);
  const attention = requests.filter((request) => request.urgency === "Urgent"
    || (request.neededByDate < today
      && !["Completed", "Cancelled"].includes(request.status))
    || request.lines.some((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus))
    || (request.invoiceStatus && ["Issued", "Disputed"].includes(request.invoiceStatus) && request.paymentStatus !== "Paid")).slice(0, 6);
  return {
    scope: "platform",
    ...totals,
    requestCount: requests.length,
    openRequestCount: requests.filter((request) => !["Completed", "Cancelled"].includes(request.status)).length,
    urgentRequestCount: requests.filter((request) => request.urgency === "Urgent").length,
    delayedDeliveryCount: requests.flatMap((request) => request.lines).filter((line) => line.deliveryStatus === "Delayed").length,
    outstandingInvoiceCount: requests.filter((request) => request.invoiceStatus === "Issued" && request.paymentStatus !== "Paid").length,
    activeCompanyCount: companies.filter((company) => company.status === "Active").length,
    byStatus,
    byCompany,
    topProducts,
    attention,
  };
}

export async function createCompany(
  input: Omit<
    Company,
    "id" | "code" | "status" | "taxRate" | "estimatedDeliveryFee"
  >,
  actor: SessionUser,
) {
  if (!actor.isOwner) throw new Error("Only the Axora owner can create companies.");
  if (isDemoMode()) {
    const store = getDemoStore();
    if (store.companies.some((company) => company.name.toLowerCase() === input.name.toLowerCase())) throw new Error("A company with this name already exists.");
    store.companies.push({
      ...input,
      id: randomUUID(),
      code: nextCode("C", store.companies.length),
      taxRate: 0,
      estimatedDeliveryFee: 0,
      status: "Active",
    });
    return;
  }
  await withAuditTransaction({ actor }, (client) => client.query(`INSERT INTO companies (company_code, name, industry, main_contact_name, main_contact_email, main_contact_phone,
      billing_contact_name, billing_contact_email, billing_contact_phone, billing_address, payment_terms, billing_cycle, notes)
      VALUES (next_company_code(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [input.name, input.industry, input.mainContactName, input.mainContactEmail, input.mainContactPhone, input.billingContactName, input.billingContactEmail, input.billingContactPhone, input.billingAddress, input.paymentTerms, input.billingCycle, input.notes ?? null]));
}

export async function updateCompanyPricingConfiguration(
  companyId: string,
  input: {
    taxRate: number;
    estimatedDeliveryFee: number;
  },
  actor: SessionUser,
) {
  if (!canAccess(actor, "manage_commercial_pricing")) {
    throw new Error(
      "Your account cannot manage company pricing settings.",
    );
  }

  const resolvedCompanyId = requireCompany(actor, companyId);

  if (
    !Number.isFinite(input.taxRate) ||
    input.taxRate < 0 ||
    input.taxRate > 100
  ) {
    throw new Error("Enter a tax/SST rate from 0% to 100%.");
  }

  if (
    !Number.isFinite(input.estimatedDeliveryFee) ||
    input.estimatedDeliveryFee < 0
  ) {
    throw new Error(
      "Estimated delivery fee cannot be negative.",
    );
  }

  if (isDemoMode()) {
    const company = getDemoStore().companies.find(
      (item) => item.id === resolvedCompanyId,
    );

    if (!company) throw new Error("Company not found.");

    company.taxRate = roundMoney(input.taxRate);
    company.estimatedDeliveryFee = roundMoney(
      input.estimatedDeliveryFee,
    );
    return;
  }

  await withAuditTransaction(
    { actor },
    async (client) => {
      const result = await client.query(
        `UPDATE companies
         SET
           tax_rate=$2,
           estimated_delivery_fee=$3,
           updated_at=now()
         WHERE id=$1
           AND active=true
           AND public.axora_actor_company_accessible($4,$5,id,now())`,
        [
          resolvedCompanyId,
          roundMoney(input.taxRate),
          roundMoney(input.estimatedDeliveryFee),
          actor.id,
          actor.roleAssignmentId,
        ],
      );

      if (!result.rowCount) {
        throw new Error(
          "The selected company is unavailable or inactive.",
        );
      }
    },
  );
}

export async function createBranch(input: Omit<Branch, "id" | "code" | "companyName" | "status" | "monthlyBudget" | "committedAmount" | "remainingAmount">, actor: SessionUser) {
  if (!canAccess(actor, "manage_branches")) {
    throw new Error("Only a company administrator can create branches.");
  }
  const companyId = requireCompany(actor, input.companyId);
  if (isDemoMode()) {
    const store = getDemoStore();
    const company = store.companies.find((item) => item.id === companyId);
    if (!company) throw new Error("Select a valid company for this branch.");
    if (store.branches.some((branch) => branch.companyId === input.companyId && (branch.name.toLowerCase() === input.name.toLowerCase() || branch.branchCode.toLowerCase() === input.branchCode.toLowerCase()))) throw new Error("This company already has a branch with the same name or code.");
    store.branches.push({ ...input, id: randomUUID(), code: nextCode("B", store.branches.length), companyName: company?.name ?? "Unknown",
      committedAmount: 0, status: "Active" });
    return;
  }
  await withAuditTransaction({ actor }, async (client) => {
    const result = await client.query(`INSERT INTO branches (branch_code_id, company_id, name, branch_code, delivery_address, city, contact_name, contact_phone, contact_email, delivery_instructions, notes)
      SELECT next_branch_code(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10 FROM companies
      WHERE id=$1 AND active=true
        AND public.axora_actor_company_accessible($11,$12,id,now())`,
    [companyId, input.name, input.branchCode, input.deliveryAddress, input.city, input.contactName, input.contactPhone, input.contactEmail, input.deliveryInstructions ?? null, input.notes ?? null, actor.id, actor.roleAssignmentId]);
    if (!result.rowCount) throw new Error("The selected company is not active.");
  });
}

export async function createProduct(
  input: Pick<Product,
    "name" | "category" | "subcategory" | "brand" | "size" | "unit"
    | "packaging" | "description" | "defaultBuyPrice" | "defaultSellPrice"
    | "deliverySlaDays"
  >,
  actor: SessionUser,
) {
  if (!canManageCommercialCatalog(actor)) throw new Error("Only authorized Axora commercial operations users can manage the product catalog.");
  if (isDemoMode()) {
    const store = getDemoStore();
    if (store.products.some((product) => product.name.trim().toLowerCase() === input.name.trim().toLowerCase())) {
      throw new Error("A product with this name already exists. Use the existing catalog record.");
    }
    const id = randomUUID();
    store.products.push(withDemoCommercialDefaults({
      ...input,
      defaultSellPrice: calculateCommercialSellingPrice(input.defaultBuyPrice),
      id,
      code: nextCode("AX-NEW", store.products.length),
      hasImage: false,
      status: "Active",
      duplicateWarning: false,
    }));
    return id;
  }
  return withAuditTransaction({ actor, reason: "PRODUCT_CREATED" }, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [input.name]);
    const duplicate = await client.query(
      "SELECT 1 FROM products WHERE lower(btrim(name))=lower(btrim($1)) LIMIT 1",
      [input.name],
    );
    if (duplicate.rowCount) {
      throw new Error("A product with this name already exists. Use the existing catalog record.");
    }
    const product = await client.query<{ id: string }>(`INSERT INTO products
      (product_code,name,category,subcategory,brand,product_size,unit_of_measure,packaging,description,
       default_buy_price,default_sell_price,minimum_order_quantity,delivery_sla_days,needs_review,company_id)
      VALUES (next_product_code($2),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,NULL) RETURNING id::text`,
    [input.name, input.category, input.subcategory, input.brand ?? null, input.size ?? null, input.unit,
      input.packaging ?? null, input.description ?? null, input.defaultBuyPrice,
      calculateCommercialSellingPrice(input.defaultBuyPrice), 1, input.deliverySlaDays]);
    return product.rows[0].id;
  });
}

export interface NewRequestInput {
  companyId: string;
  branchId: string;
  requestType: ProcurementRequest["requestType"];
  department: string;
  neededByDate: string;
  urgency: ProcurementRequest["urgency"];
  notes?: string;
  lines: Array<{ productId: string; quantity: number; specification?: string }>;
}

export async function createRequest(input: NewRequestInput, actor: SessionUser) {
  if (!canAccess(actor, "create_requests")) {
    throw new Error("Only an authorized company user can submit purchase requests.");
  }
  const companyId = requireCompany(actor, input.companyId);
  if (actor.branchId && actor.branchId !== input.branchId) {
    throw new Error("You can submit requests only for your assigned branch.");
  }
  if (new Set(input.lines.map((line) => line.productId)).size !== input.lines.length) {
    throw new Error("Add each catalog product only once per purchase request.");
  }
  if (isDemoMode()) {
    const store = getDemoStore();
    const company = store.companies.find((item) => item.id === input.companyId);
    const branch = store.branches.find((item) => item.id === input.branchId);
    if (!company || !branch || branch.companyId !== company.id) throw new Error("The selected branch does not belong to the selected company.");
    if (input.lines.some((item) => !store.products.some((product) =>
      product.id === item.productId
      && product.status === "Active"
      && (!product.companyId || product.companyId === companyId),
    ))) throw new Error("One or more products are unavailable.");
    const subtotal = input.lines.reduce((total, item) => {
      const product = store.products.find(
        (candidate) => candidate.id === item.productId,
      );

      return total + roundMoney(
        item.quantity * (product ? calculateCommercialSellingPrice(product.defaultBuyPrice) : 0),
      );
    }, 0);

    const estimatedDeliveryFee =
      company.estimatedDeliveryFee ?? 0;
    const taxRate = company.taxRate ?? 0;
    const taxAmount = roundMoney(subtotal * (taxRate / 100));
    const estimatedTotal = roundMoney(
      subtotal + estimatedDeliveryFee + taxAmount,
    );

    const requestNumber = store.requests.length + 1;
    const request: ProcurementRequest = {
      id: randomUUID(), orderCode: `ORD-2026-${String(requestNumber).padStart(3, "0")}`, requestDate: new Date().toISOString().slice(0, 10),
      requestType: input.requestType, companyId: input.companyId, companyName: company?.name ?? "Unknown", branchId: input.branchId, branchName: branch?.name ?? "Unknown",
      department: input.department, requestedBy: actor.name, requesterContact: actor.email, neededByDate: input.neededByDate,
      urgency: input.urgency,
      status: "New Request",
      notes: input.notes,
      approvalStatus: "Pending",
      approvalRevision: 1,
      subtotal,
      estimatedDeliveryFee,
      taxRate,
      taxAmount,
      estimatedTotal,
      invoiceStatus: "Not Issued",
      paymentStatus: "Unpaid",
      createdById: actor.id,
      lines: input.lines.map((item, index) => {
        const product = store.products.find((candidate) => candidate.id === item.productId)!;
        return { id: randomUUID(), code: `REQ-2026-${String(requestNumber * 10 + index).padStart(5, "0")}`, productId: product.id, productCode: product.code, productName: product.name,
          category: product.category, subcategory: product.subcategory, specification: item.specification, quantity: item.quantity, unit: product.unit,
          supplierConfirmationStatus: "Pending",
          unitBuyPrice: product.defaultBuyPrice, unitSellPrice: calculateCommercialSellingPrice(product.defaultBuyPrice), deliveryCharge: 0, deliveryStatus: "Not Scheduled", quantityReceived: 0 };
      }),
    };
    store.requests.unshift(request);
    return request.id;
  }
  return withAuditTransaction({ actor }, async (client: PoolClient) => {
    const company = await client.query<{
      taxRate: number;
      estimatedDeliveryFee: number;
    }>(
      `SELECT
        tax_rate::float8 AS "taxRate",
        estimated_delivery_fee::float8 AS "estimatedDeliveryFee"
       FROM companies
       WHERE id=$1 AND active=true
         AND public.axora_actor_company_accessible($2,$3,id,now())
       FOR SHARE`,
      [companyId, actor.id, actor.roleAssignmentId],
    );

    if (!company.rowCount) {
      throw new Error("The selected company is not active.");
    }
    const branchMatch = await client.query(
      "SELECT 1 FROM branches WHERE id=$1 AND company_id=$2 AND active=true FOR SHARE",
      [input.branchId, companyId],
    );
    if (!branchMatch.rowCount) throw new Error("The selected branch does not belong to the selected company.");
    const selectedProducts = await client.query<{ id: string; name: string }>(
      `SELECT id::text,name FROM products
       WHERE id = ANY($1::uuid[]) AND active=true AND needs_review=false
         AND (company_id IS NULL OR company_id=$2)
       FOR SHARE`,
      [input.lines.map((line) => line.productId), companyId],
    );
    if (selectedProducts.rows.length !== input.lines.length) {
      throw new Error("One or more selected products are unavailable or still need review.");
    }
    const requestResult = await client.query<{ id: string }>(
      `INSERT INTO requests (
        order_code,
        request_date,
        request_type_id,
        company_id,
        branch_id,
        department,
        requested_by,
        requester_contact,
        needed_by_date,
        urgency_id,
        status_id,
        notes,
        created_by,
        estimated_delivery_fee,
        tax_rate
      )
      VALUES (
        next_order_code(),
        CURRENT_DATE,
        lookup_id('request_type',$1),
        $2,$3,$4,$5,$6,$7,
        lookup_id('urgency',$8),
        lookup_id('request_status','New Request'),
        $9,$10,$11,$12
      )
      RETURNING id::text`,
      [
        input.requestType,
        companyId,
        input.branchId,
        input.department,
        actor.name,
        actor.email,
        input.neededByDate,
        input.urgency,
        input.notes ?? null,
        actor.id,
        company.rows[0].estimatedDeliveryFee,
        company.rows[0].taxRate,
      ],
    );
    const requestId = requestResult.rows[0].id;
    for (const item of input.lines) {
      const insertedLine = await client.query(`INSERT INTO request_lines
        (request_line_code,request_id,product_id,product_name_snapshot,category_snapshot,subcategory_snapshot,
         specification,quantity,unit_of_measure,supplier_confirmation_status_id,unit_buy_price,unit_sell_price)
        SELECT next_request_line_code(),$1,p.id,p.name,p.category,p.subcategory,$3,$4,p.unit_of_measure,
          lookup_id('supplier_confirmation','Pending'),0,p.default_sell_price
        FROM v_customer_catalog_products p
        WHERE p.id=$2 AND p.active=true AND p.needs_review=false
          AND (p.company_id IS NULL OR p.company_id=$5)`,
      [requestId, item.productId, item.specification ?? null, item.quantity, companyId]);
      if (!insertedLine.rowCount) {
        throw new Error("A selected product became unavailable. Review the request and try again.");
      }
    }

    await client.query(
      `UPDATE requests request
       SET tax_amount = round(
         COALESCE((
           SELECT sum(
             round(line.quantity * line.unit_sell_price, 2)
           )
           FROM request_lines line
           WHERE line.request_id=request.id
         ),0) * (request.tax_rate / 100),
         2
       )
       WHERE request.id=$1`,
      [requestId],
    );

    const event = await appendWorkflowEvent(client, {
      companyId,
      branchId: input.branchId,
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
      companyId,
      branchId: input.branchId,
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

export async function updateRequestStatus(id: string, status: RequestStatus, reason: string | undefined, actor: SessionUser) {
  if (!canAccess(actor, "manage_deliveries")) throw new Error("Only authorized delivery operations users can manage the fulfillment workflow.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === id);
    if (!request) throw new Error("Request not found.");
    validateStatusTransition(request.status, status, reason);
    if (request.approvalStatus !== "Approved") {
      throw new Error("The company must approve this request before Axora starts fulfillment.");
    }
    if (status === "Delivered" && request.lines.some((line) => line.quantityReceived < line.quantity)) {
      throw new Error("Every request line must be fully received before marking the request delivered.");
    }
    if (status === "Invoice Issued" && request.invoiceStatus !== "Issued") {
      throw new Error("Issue a customer invoice before moving to Invoice Issued.");
    }
    if (status === "Completed") {
      const invoices = getDemoOperations().invoices.filter((invoice) =>
        invoice.requestId === request.id && invoice.direction === "CUSTOMER" && invoice.status !== "Cancelled");
      const authorizedTotal = request.estimatedTotal;
      const invoicedTotal = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
      if (!invoices.length || invoices.some((invoice) => invoice.outstandingAmount > 0)) {
        throw new Error("All active customer invoices must be fully paid before completing the request.");
      }
      if (Math.abs(invoicedTotal - authorizedTotal) > 0.001) {
        throw new Error("Customer invoices must equal the company-approved request total before completion.");
      }
    }
    request.status = status;
    request.issueReason = reason || request.issueReason;
    if (status === "Completed") request.completedDate = new Date().toISOString().slice(0, 10);
    return;
  }
  await withAuditTransaction({ actor, reason }, async (client) => {
    const current = await client.query<{ status: RequestStatus; companyId: string; branchId: string }>(
      `SELECT lv.label AS status,r.company_id::text AS "companyId",
         r.branch_id::text AS "branchId"
       FROM requests r JOIN lookup_values lv ON lv.id=r.status_id
       WHERE r.id=$1 FOR UPDATE`,
      [id],
    );
    if (!current.rows[0]) throw new Error("Request not found.");
    validateStatusTransition(current.rows[0].status, status, reason);
    const permitted = await client.query(`SELECT 1 FROM request_status_transitions WHERE from_status_id=lookup_id('request_status',$1) AND to_status_id=lookup_id('request_status',$2)`, [current.rows[0].status, status]);
    if (!permitted.rowCount) throw new Error("This workflow transition is not configured in the database.");
    const evidence = await client.query(
      "SELECT 1 FROM approvals WHERE request_id=$1 AND approval_type='Company approval' AND status='Approved' LIMIT 1",
      [id],
    );
    if (!evidence.rowCount) throw new Error("The company must approve this request before Axora starts fulfillment.");
    if (status === "Delivered") {
      const incomplete = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM request_lines l
        WHERE l.request_id=$1 AND axora_received_quantity(l.id)<l.quantity`, [id]);
      if (incomplete.rows[0].count) throw new Error("Every request line must be fully received before marking the request delivered.");
    }
    if (status === "Invoice Issued") {
      const invoice = await client.query(`SELECT 1 FROM invoices i JOIN lookup_values s ON s.id=i.status_id
        WHERE i.request_id=$1 AND i.direction='CUSTOMER' AND s.label='Issued' LIMIT 1`, [id]);
      if (!invoice.rowCount) throw new Error("Issue a customer invoice before moving to Invoice Issued.");
    }
    if (status === "Completed") {
      const settlement = await client.query<{ invoiceCount: number; unpaidCount: number; authorizedTotal: number; invoicedTotal: number }>(
        `SELECT
          count(*) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>lookup_id('invoice_status','Cancelled')
          )::int AS "invoiceCount",
          count(*) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>lookup_id('invoice_status','Cancelled')
              AND balance.outstanding_amount>0
          )::int AS "unpaidCount",
          (
            COALESCE((
              SELECT sum(
                round(line.quantity * line.unit_sell_price, 2)
              )
              FROM request_lines line
              WHERE line.request_id=request.id
            ),0)
            + request.estimated_delivery_fee
            + request.tax_amount
          )::float8 AS "authorizedTotal",
          COALESCE(sum(balance.amount) FILTER (
            WHERE balance.direction='CUSTOMER'
              AND balance.status_id<>lookup_id('invoice_status','Cancelled')
          ),0)::float8 AS "invoicedTotal"
        FROM requests request
        LEFT JOIN v_invoice_balances balance
          ON balance.request_id=request.id
        WHERE request.id=$1
        GROUP BY
          request.id,
          request.estimated_delivery_fee,
          request.tax_amount`,
        [id],
      );
      if (!settlement.rows[0].invoiceCount || settlement.rows[0].unpaidCount) {
        throw new Error("All active customer invoices must be fully paid before completing the request.");
      }
      if (Math.abs(settlement.rows[0].invoicedTotal - settlement.rows[0].authorizedTotal) > 0.001) {
        throw new Error("Customer invoices must equal the company-approved request total before completion.");
      }
    }
    await client.query(`UPDATE requests SET status_id=lookup_id('request_status',$2), issue_reason=COALESCE(NULLIF($3,''),issue_reason), completed_at=CASE WHEN $2='Completed' THEN now() ELSE completed_at END WHERE id=$1`, [id, status, reason ?? ""]);
    const eventKeys: Partial<Record<RequestStatus, string>> = {
      Ordered: "order.confirmed",
      "Preparing for Delivery": "preparation.started",
      "Out for Delivery": "delivery.out_for_delivery",
      Delivered: "delivery.completed",
      "Invoice Issued": "invoice.issued",
      Completed: "request.completed",
      "On Hold": "request.on_hold",
      Cancelled: "request.cancelled",
    };
    const eventKey = eventKeys[status] ?? "request.status_changed";
    const event = await appendWorkflowEvent(client, {
      companyId: current.rows[0].companyId,
      branchId: current.rows[0].branchId,
      requestId: id,
      aggregateType: "request",
      aggregateId: id,
      eventKey,
      stableKey: `${current.rows[0].status}:${status}`,
      actor,
      previousState: current.rows[0].status,
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
      priority: ["On Hold", "Cancelled"].includes(status) ? "HIGH" : "NORMAL",
    });
  });
}

export type MasterEntity = "companies" | "branches" | "products";

export async function setMasterActive(entity: MasterEntity, id: string, active: boolean, actor: SessionUser) {
  if (entity === "companies") {
    throw new Error("Company activation is controlled by the onboarding lifecycle.");
  }
  const requiredPermission = entity === "branches"
    ? "manage_branches"
    : "manage_catalog";
  if (!canAccess(actor, requiredPermission)) throw new Error("Your account cannot change this record.");
  if (isDemoMode()) {
    const store = getDemoStore();
    if (entity === "products") {
      const product = store.products.find((item) => item.id === id);
      if (!product) throw new Error("Master record not found.");
      if (active && product.status === "Needs Review") {
        throw new Error("Reject the duplicate review record or keep it out of the customer catalog.");
      }
      product.status = active ? "Active" : "Inactive";
      if (!active) product.duplicateWarning = false;
      return;
    }
    const record = store[entity].find((item) => item.id === id);
    if (!record) throw new Error("Master record not found.");
    record.status = active ? "Active" : "Inactive";
    return;
  }
  const allowedTables: Record<MasterEntity, string> = { companies: "companies", branches: "branches", products: "products" };
  const table = allowedTables[entity];
  await withAuditTransaction({ actor, reason: entity === "products" ? (active ? "PRODUCT_ACTIVATED" : "PRODUCT_ARCHIVED") : (active ? "BRANCH_ACTIVATED" : "BRANCH_DEACTIVATED") }, async (client) => {
    const platformActor = isPlatformProcurementActor(actor);
    const companyPredicate = platformActor ? "" : " AND company_id=$3";
    if (entity === "products" && active) {
      const review = await client.query<{ needsReview: boolean }>("SELECT needs_review AS \"needsReview\" FROM products WHERE id=$1", [id]);
      if (review.rows[0]?.needsReview) {
        throw new Error("Reject the duplicate review record or keep it out of the customer catalog.");
      }
    }
    const reviewReset = entity === "products" && !active ? ", needs_review=false" : "";
    const result = await client.query(`UPDATE ${table} SET active=$2${reviewReset} WHERE id=$1${companyPredicate}`, platformActor ? [id, active] : [id, active, actor.companyId]);
    if (!result.rowCount) throw new Error("Master record not found.");
  });
}
import { buildCompanyDashboardData, isPlatformAnalyticsActor } from "@/lib/dashboard-data";

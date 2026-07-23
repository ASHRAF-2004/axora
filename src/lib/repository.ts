import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { calculateTotals } from "./domain";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { requireSession, type SessionUser } from "./auth";
import type { Branch, Company, DashboardData, ProcurementRequest, Product, RequestStatus, Supplier } from "./types";
import { validateStatusTransition } from "./workflow";

function nextCode(prefix: string, count: number, digits = 3) {
  return `${prefix}-${String(count + 1).padStart(digits, "0")}`;
}

async function actorOrSession(actor?: SessionUser) {
  return actor ?? requireSession();
}

function tenantClause(actor: SessionUser, column: string) {
  return actor.isOwner ? { sql: "", values: [] as unknown[] } : { sql: ` WHERE ${column} = $1`, values: [actor.companyId] };
}

function requireCompany(actor: SessionUser, requestedCompanyId?: string) {
  const companyId = actor.isOwner ? requestedCompanyId : actor.companyId;
  if (!companyId) throw new Error("Select a company.");
  if (!actor.isOwner && requestedCompanyId && requestedCompanyId !== actor.companyId) throw new Error("You cannot access another company.");
  return companyId;
}

export async function listCompanies(providedActor?: SessionUser): Promise<Company[]> {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode()) return actor.isOwner ? getDemoStore().companies : getDemoStore().companies.filter((item) => item.id === actor.companyId);
  const scope = tenantClause(actor, "id");
  const result = await query<Company>(`SELECT id::text, company_code AS code, name, industry,
    main_contact_name AS "mainContactName", main_contact_email AS "mainContactEmail", main_contact_phone AS "mainContactPhone",
    billing_contact_name AS "billingContactName", billing_contact_email AS "billingContactEmail", billing_contact_phone AS "billingContactPhone",
    billing_address AS "billingAddress", payment_terms AS "paymentTerms", billing_cycle AS "billingCycle", notes,
    CASE WHEN active THEN 'Active' ELSE 'Inactive' END AS status
    FROM companies${scope.sql} ORDER BY name`, scope.values);
  return result.rows;
}

export async function listBranches(providedActor?: SessionUser): Promise<Branch[]> {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode()) return actor.isOwner ? getDemoStore().branches : getDemoStore().branches.filter((item) => item.companyId === actor.companyId);
  const scope = tenantClause(actor, "b.company_id");
  const result = await query<Branch>(`SELECT b.id::text, b.branch_code_id AS code, b.company_id::text AS "companyId", c.name AS "companyName",
    b.name, b.branch_code AS "branchCode", b.delivery_address AS "deliveryAddress", b.city,
    b.contact_name AS "contactName", b.contact_phone AS "contactPhone", b.contact_email AS "contactEmail",
    b.delivery_instructions AS "deliveryInstructions", b.notes,
    CASE WHEN b.active THEN 'Active' ELSE 'Inactive' END AS status
    FROM branches b JOIN companies c ON c.id = b.company_id${scope.sql} ORDER BY c.name, b.name`, scope.values);
  return result.rows;
}

export async function listProducts(providedActor?: SessionUser): Promise<Product[]> {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode()) return getDemoStore().products;
  const scope = tenantClause(actor, "p.company_id");
  const result = await query<Product>(`SELECT p.id::text,p.company_id::text AS "companyId",c.name AS "companyName",p.product_code AS code, p.name, p.category, p.subcategory, p.brand, p.product_size AS size,
    p.unit_of_measure AS unit, p.packaging, p.description, p.default_buy_price::float8 AS "defaultBuyPrice",
    p.default_sell_price::float8 AS "defaultSellPrice", p.minimum_order_quantity::float8 AS "minimumOrderQuantity",
    p.delivery_sla_days AS "deliverySlaDays", ps.supplier_id::text AS "preferredSupplierId", s.name AS "preferredSupplierName",
    CASE WHEN p.needs_review THEN 'Needs Review' WHEN p.active THEN 'Active' ELSE 'Inactive' END AS status,
    EXISTS (SELECT 1 FROM products p2 WHERE p2.company_id=p.company_id AND lower(p2.name) = lower(p.name) AND p2.id <> p.id) AS "duplicateWarning"
    FROM products p
    LEFT JOIN companies c ON c.id=p.company_id
    LEFT JOIN product_suppliers ps ON ps.product_id = p.id AND ps.preferred = true
    LEFT JOIN suppliers s ON s.id = ps.supplier_id
    ${scope.sql} ORDER BY p.name`, scope.values);
  return result.rows;
}

export async function listSuppliers(providedActor?: SessionUser): Promise<Supplier[]> {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode()) return getDemoStore().suppliers;
  const scope = tenantClause(actor, "s.company_id");
  const result = await query<Supplier>(`SELECT s.id::text,s.company_id::text AS "companyId",c.name AS "companyName",s.supplier_code AS code,s.name,s.category,
    s.contact_name AS "contactName",s.phone,s.email,s.address,s.coverage_area AS "coverageArea",s.payment_terms AS "paymentTerms",
    s.lead_time_days AS "leadTimeDays",s.minimum_order_quantity::float8 AS "minimumOrderQuantity",s.main_products AS "mainProducts",s.notes,
    CASE WHEN s.active THEN 'Active' ELSE 'Inactive' END AS status
    FROM suppliers s LEFT JOIN companies c ON c.id=s.company_id${scope.sql} ORDER BY s.name`, scope.values);
  return result.rows;
}

interface RequestRow {
  id: string;
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

const requestSelect = `SELECT r.id::text, r.order_code AS "orderCode", r.request_date::text AS "requestDate",
  rt.label AS "requestType", r.company_id::text AS "companyId", c.name AS "companyName", r.branch_id::text AS "branchId", b.name AS "branchName",
  r.department, r.requested_by AS "requestedBy", r.requester_contact AS "requesterContact", r.needed_by_date::text AS "neededByDate",
  u.label AS urgency, rs.label AS status, r.notes, r.issue_reason AS "issueReason",
  COALESCE(i.invoice_status, 'Not Issued') AS "invoiceStatus", COALESCE(i.payment_status, 'Unpaid') AS "paymentStatus",
  i.invoice_number AS "invoiceNumber", r.completed_at::date::text AS "completedDate",
  l.id::text AS "lineId", l.request_line_code AS "lineCode", l.product_id::text AS "productId", p.product_code AS "productCode",
  l.product_name_snapshot AS "productName", l.category_snapshot AS category, l.subcategory_snapshot AS subcategory,
  l.specification, l.quantity::float8, l.unit_of_measure AS unit, l.selected_supplier_id::text AS "supplierId", s.name AS "supplierName",
  l.quotation_reference AS "quotationReference", sc.label AS "supplierConfirmationStatus", l.unit_buy_price::float8 AS "unitBuyPrice",
  l.unit_sell_price::float8 AS "unitSellPrice", l.delivery_charge::float8 AS "deliveryCharge",
  d.expected_date::text AS "expectedDeliveryDate", d.actual_date::text AS "actualDeliveryDate",
  COALESCE(ds.label, 'Not Scheduled') AS "deliveryStatus", COALESCE(d.total_received, 0)::float8 AS "quantityReceived"
  FROM requests r
  JOIN companies c ON c.id = r.company_id JOIN branches b ON b.id = r.branch_id
  JOIN lookup_values rt ON rt.id = r.request_type_id JOIN lookup_values u ON u.id = r.urgency_id JOIN lookup_values rs ON rs.id = r.status_id
  LEFT JOIN request_lines l ON l.request_id = r.id LEFT JOIN products p ON p.id = l.product_id LEFT JOIN suppliers s ON s.id = l.selected_supplier_id
  LEFT JOIN lookup_values sc ON sc.id = l.supplier_confirmation_status_id
  LEFT JOIN LATERAL (SELECT d1.*,(SELECT COALESCE(sum(d2.quantity_received),0) FROM deliveries d2 WHERE d2.request_line_id=l.id) AS total_received
    FROM deliveries d1 WHERE d1.request_line_id = l.id ORDER BY d1.created_at DESC LIMIT 1) d ON true
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
  if (isDemoMode()) return actor.isOwner ? getDemoStore().requests : getDemoStore().requests.filter((item) => item.companyId === actor.companyId);
  const scope = tenantClause(actor, "r.company_id");
  const result = await query<RequestRow>(`${requestSelect}${scope.sql} ORDER BY r.request_date DESC, r.order_code, l.request_line_code`, scope.values);
  return groupRequestRows(result.rows);
}

export async function getRequest(id: string, providedActor?: SessionUser) {
  const actor = await actorOrSession(providedActor);
  if (isDemoMode()) return getDemoStore().requests.find((request) => request.id === id && (actor.isOwner || request.companyId === actor.companyId));
  const result = await query<RequestRow>(`${requestSelect} WHERE r.id = $1${actor.isOwner ? "" : " AND r.company_id = $2"} ORDER BY l.request_line_code`, actor.isOwner ? [id] : [id, actor.companyId]);
  return groupRequestRows(result.rows)[0];
}

export async function getDashboardData(): Promise<DashboardData> {
  const actor = await requireSession();
  const [requests, companies, suppliers] = await Promise.all([listRequests(actor), listCompanies(actor), listSuppliers(actor)]);
  const totals = calculateTotals(requests);
  const byStatus = Object.entries(requests.reduce<Record<string, number>>((acc, request) => ({ ...acc, [request.status]: (acc[request.status] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value }));
  const byCompany = Object.entries(requests.reduce<Record<string, number>>((acc, request) => ({ ...acc, [request.companyName]: (acc[request.companyName] ?? 0) + 1 }), {})).map(([label, value]) => ({ label, value }));
  const topProducts = Object.entries(requests.flatMap((request) => request.lines).reduce<Record<string, number>>((acc, line) => ({ ...acc, [line.productName]: (acc[line.productName] ?? 0) + line.quantity }), {}))
    .map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const attention = requests.filter((request) => request.urgency === "Urgent" || request.lines.some((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus)) || (["Issued", "Disputed"].includes(request.invoiceStatus) && request.paymentStatus !== "Paid")).slice(0, 6);
  return {
    ...totals,
    requestCount: requests.length,
    openRequestCount: requests.filter((request) => !["Completed", "Cancelled"].includes(request.status)).length,
    urgentRequestCount: requests.filter((request) => request.urgency === "Urgent").length,
    delayedDeliveryCount: requests.flatMap((request) => request.lines).filter((line) => line.deliveryStatus === "Delayed").length,
    outstandingInvoiceCount: requests.filter((request) => request.invoiceStatus === "Issued" && request.paymentStatus !== "Paid").length,
    activeCompanyCount: companies.filter((company) => company.status === "Active").length,
    activeSupplierCount: suppliers.filter((supplier) => supplier.status === "Active").length,
    byStatus,
    byCompany,
    topProducts,
    attention,
  };
}

export async function createCompany(input: Omit<Company, "id" | "code" | "status">, actor: SessionUser) {
  if (!actor.isOwner) throw new Error("Only the Axora owner can create companies.");
  if (isDemoMode()) {
    const store = getDemoStore();
    if (store.companies.some((company) => company.name.toLowerCase() === input.name.toLowerCase())) throw new Error("A company with this name already exists.");
    store.companies.push({ ...input, id: randomUUID(), code: nextCode("C", store.companies.length), status: "Active" });
    return;
  }
  await withAuditTransaction({ userId: actor.id }, (client) => client.query(`INSERT INTO companies (company_code, name, industry, main_contact_name, main_contact_email, main_contact_phone,
      billing_contact_name, billing_contact_email, billing_contact_phone, billing_address, payment_terms, billing_cycle, notes)
      VALUES (next_company_code(), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [input.name, input.industry, input.mainContactName, input.mainContactEmail, input.mainContactPhone, input.billingContactName, input.billingContactEmail, input.billingContactPhone, input.billingAddress, input.paymentTerms, input.billingCycle, input.notes ?? null]));
}

export async function createBranch(input: Omit<Branch, "id" | "code" | "companyName" | "status">, actor: SessionUser) {
  const companyId = requireCompany(actor, input.companyId);
  if (isDemoMode()) {
    const store = getDemoStore();
    const company = store.companies.find((item) => item.id === companyId);
    if (!company) throw new Error("Select a valid company for this branch.");
    if (store.branches.some((branch) => branch.companyId === input.companyId && (branch.name.toLowerCase() === input.name.toLowerCase() || branch.branchCode.toLowerCase() === input.branchCode.toLowerCase()))) throw new Error("This company already has a branch with the same name or code.");
    store.branches.push({ ...input, id: randomUUID(), code: nextCode("B", store.branches.length), companyName: company?.name ?? "Unknown", status: "Active" });
    return;
  }
  await withAuditTransaction({ userId: actor.id }, (client) => client.query(`INSERT INTO branches (branch_code_id, company_id, name, branch_code, delivery_address, city, contact_name, contact_phone, contact_email, delivery_instructions, notes)
      VALUES (next_branch_code(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [companyId, input.name, input.branchCode, input.deliveryAddress, input.city, input.contactName, input.contactPhone, input.contactEmail, input.deliveryInstructions ?? null, input.notes ?? null]));
}

export async function createSupplier(input: Omit<Supplier, "id" | "code" | "status"> & { companyId?: string }, actor: SessionUser) {
  const companyId = requireCompany(actor, input.companyId);
  if (isDemoMode()) {
    const store = getDemoStore();
    if (store.suppliers.some((supplier) => supplier.name.toLowerCase() === input.name.toLowerCase())) throw new Error("A supplier with this name already exists.");
    store.suppliers.push({ ...input, id: randomUUID(), code: nextCode("S", store.suppliers.length), status: "Active" });
    return;
  }
  await withAuditTransaction({ userId: actor.id }, (client) => client.query(`INSERT INTO suppliers (supplier_code,name,category,contact_name,phone,email,address,coverage_area,payment_terms,lead_time_days,minimum_order_quantity,main_products,notes,company_id)
      VALUES (next_supplier_code(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [input.name, input.category, input.contactName, input.phone, input.email, input.address, input.coverageArea, input.paymentTerms, input.leadTimeDays, input.minimumOrderQuantity, input.mainProducts, input.notes ?? null, companyId]));
}

export async function createProduct(input: Omit<Product, "id" | "code" | "status" | "duplicateWarning" | "preferredSupplierName"> & { companyId?: string }, actor: SessionUser) {
  const companyId = requireCompany(actor, input.companyId);
  if (isDemoMode()) {
    const store = getDemoStore();
    const duplicateWarning = store.products.some((product) => product.name.toLowerCase() === input.name.toLowerCase());
    const supplier = store.suppliers.find((item) => item.id === input.preferredSupplierId);
    store.products.push({ ...input, id: randomUUID(), code: nextCode("AX-NEW", store.products.length), status: duplicateWarning ? "Needs Review" : "Active", duplicateWarning, preferredSupplierName: supplier?.name });
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const duplicate = await client.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM products WHERE company_id=$2 AND lower(name)=lower($1)) AS exists", [input.name, companyId]);
    const product = await client.query<{ id: string }>(`INSERT INTO products (product_code,name,category,subcategory,brand,product_size,unit_of_measure,packaging,description,default_buy_price,default_sell_price,minimum_order_quantity,delivery_sla_days,needs_review,company_id)
      VALUES (next_product_code($2),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text`, [input.name, input.category, input.subcategory, input.brand ?? null, input.size ?? null, input.unit, input.packaging ?? null, input.description ?? null, input.defaultBuyPrice, input.defaultSellPrice, input.minimumOrderQuantity, input.deliverySlaDays, duplicate.rows[0].exists, companyId]);
    if (input.preferredSupplierId) {
      await client.query(`INSERT INTO product_suppliers (product_id,supplier_id,preferred,indicative_buy_price,supplier_moq,lead_time_days)
        SELECT $1,$2,true,$3,$4,$5 FROM suppliers WHERE id=$2 AND company_id=$6`, [product.rows[0].id, input.preferredSupplierId, input.defaultBuyPrice, input.minimumOrderQuantity, input.deliverySlaDays, companyId]);
    }
  });
}

export interface NewRequestInput {
  companyId: string;
  branchId: string;
  requestType: ProcurementRequest["requestType"];
  department: string;
  requestedBy: string;
  requesterContact: string;
  neededByDate: string;
  urgency: ProcurementRequest["urgency"];
  notes?: string;
  lines: Array<{ productId: string; quantity: number; specification?: string }>;
}

export async function createRequest(input: NewRequestInput, actor: SessionUser) {
  const companyId = requireCompany(actor, input.companyId);
  if (isDemoMode()) {
    const store = getDemoStore();
    const company = store.companies.find((item) => item.id === input.companyId);
    const branch = store.branches.find((item) => item.id === input.branchId);
    if (!company || !branch || branch.companyId !== company.id) throw new Error("The selected branch does not belong to the selected company.");
    if (input.lines.some((item) => !store.products.some((product) => product.id === item.productId && product.status === "Active"))) throw new Error("One or more selected products are unavailable.");
    const requestNumber = store.requests.length + 1;
    const request: ProcurementRequest = {
      id: randomUUID(), orderCode: `ORD-2026-${String(requestNumber).padStart(3, "0")}`, requestDate: new Date().toISOString().slice(0, 10),
      requestType: input.requestType, companyId: input.companyId, companyName: company?.name ?? "Unknown", branchId: input.branchId, branchName: branch?.name ?? "Unknown",
      department: input.department, requestedBy: input.requestedBy, requesterContact: input.requesterContact, neededByDate: input.neededByDate,
      urgency: input.urgency, status: "New Request", notes: input.notes, invoiceStatus: "Not Issued", paymentStatus: "Unpaid",
      lines: input.lines.map((item, index) => {
        const product = store.products.find((candidate) => candidate.id === item.productId)!;
        return { id: randomUUID(), code: `REQ-2026-${String(requestNumber * 10 + index).padStart(5, "0")}`, productId: product.id, productCode: product.code, productName: product.name,
          category: product.category, subcategory: product.subcategory, specification: item.specification, quantity: item.quantity, unit: product.unit,
          supplierId: product.preferredSupplierId, supplierName: product.preferredSupplierName, supplierConfirmationStatus: "Pending",
          unitBuyPrice: product.defaultBuyPrice, unitSellPrice: product.defaultSellPrice, deliveryCharge: 0, deliveryStatus: "Not Scheduled", quantityReceived: 0 };
      }),
    };
    store.requests.unshift(request);
    return request.id;
  }
  return withAuditTransaction({ userId: actor.id }, async (client: PoolClient) => {
    const branchMatch = await client.query("SELECT 1 FROM branches WHERE id=$1 AND company_id=$2 AND active=true", [input.branchId, companyId]);
    if (!branchMatch.rowCount) throw new Error("The selected branch does not belong to the selected company.");
    const selectedProducts = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM products WHERE id = ANY($1::uuid[]) AND company_id=$2 AND active=true AND needs_review=false", [input.lines.map((line) => line.productId), companyId]);
    if (selectedProducts.rows[0].count !== new Set(input.lines.map((line) => line.productId)).size) throw new Error("One or more selected products are unavailable or still need review.");
    const requestResult = await client.query<{ id: string }>(`INSERT INTO requests (order_code,request_date,request_type_id,company_id,branch_id,department,requested_by,requester_contact,needed_by_date,urgency_id,status_id,notes,created_by)
      VALUES (next_order_code(),CURRENT_DATE,lookup_id('request_type',$1),$2,$3,$4,$5,$6,$7,lookup_id('urgency',$8),lookup_id('request_status','New Request'),$9,$10) RETURNING id::text`,
      [input.requestType, companyId, input.branchId, input.department, input.requestedBy, input.requesterContact, input.neededByDate, input.urgency, input.notes ?? null, actor.id]);
    const requestId = requestResult.rows[0].id;
    for (const item of input.lines) {
      await client.query(`INSERT INTO request_lines (request_line_code,request_id,product_id,product_name_snapshot,category_snapshot,subcategory_snapshot,specification,quantity,unit_of_measure,selected_supplier_id,supplier_confirmation_status_id,unit_buy_price,unit_sell_price)
        SELECT next_request_line_code(),$1,p.id,p.name,p.category,p.subcategory,$3,$4,p.unit_of_measure,ps.supplier_id,lookup_id('supplier_confirmation','Pending'),p.default_buy_price,p.default_sell_price
        FROM products p LEFT JOIN product_suppliers ps ON ps.product_id=p.id AND ps.preferred=true WHERE p.id=$2 AND p.company_id=$5`,
      [requestId, item.productId, item.specification ?? null, item.quantity, companyId]);
    }
    return requestId;
  });
}

export async function updateRequestStatus(id: string, status: RequestStatus, reason: string | undefined, actor: SessionUser) {
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === id);
    if (!request) throw new Error("Request not found.");
    validateStatusTransition(request.status, status, reason);
    request.status = status;
    request.issueReason = reason || request.issueReason;
    if (status === "Completed") request.completedDate = new Date().toISOString().slice(0, 10);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason }, async (client) => {
    const current = await client.query<{ status: RequestStatus }>(`SELECT lv.label AS status FROM requests r JOIN lookup_values lv ON lv.id=r.status_id WHERE r.id=$1${actor.isOwner ? "" : " AND r.company_id=$2"} FOR UPDATE`, actor.isOwner ? [id] : [id, actor.companyId]);
    if (!current.rows[0]) throw new Error("Request not found.");
    validateStatusTransition(current.rows[0].status, status, reason);
    const permitted = await client.query(`SELECT 1 FROM request_status_transitions WHERE from_status_id=lookup_id('request_status',$1) AND to_status_id=lookup_id('request_status',$2)`, [current.rows[0].status, status]);
    if (!permitted.rowCount) throw new Error("This workflow transition is not configured in the database.");
    await client.query(`UPDATE requests SET status_id=lookup_id('request_status',$2), issue_reason=COALESCE(NULLIF($3,''),issue_reason), completed_at=CASE WHEN $2='Completed' THEN now() ELSE completed_at END WHERE id=$1`, [id, status, reason ?? ""]);
  });
}

export type MasterEntity = "companies" | "branches" | "products" | "suppliers";

export async function setMasterActive(entity: MasterEntity, id: string, active: boolean, actor: SessionUser) {
  if (entity === "companies" && !actor.isOwner) throw new Error("Only the Axora owner can change company status.");
  if (isDemoMode()) {
    const store = getDemoStore();
    const collection = store[entity];
    const record = collection.find((item) => item.id === id);
    if (!record) throw new Error("Master record not found.");
    record.status = active ? "Active" : "Inactive";
    return;
  }
  const allowedTables: Record<MasterEntity, string> = { companies: "companies", branches: "branches", products: "products", suppliers: "suppliers" };
  const table = allowedTables[entity];
  await withAuditTransaction({ userId: actor.id, reason: active ? "Master record activated" : "Master record deactivated" }, async (client) => {
    const companyPredicate = actor.isOwner ? "" : entity === "branches" ? " AND company_id=$3" : entity === "products" || entity === "suppliers" ? " AND company_id=$3" : " AND id=$3";
    const result = await client.query(`UPDATE ${table} SET active=$2 WHERE id=$1${companyPredicate}`, actor.isOwner ? [id, active] : [id, active, actor.companyId]);
    if (!result.rowCount) throw new Error("Master record not found.");
  });
}

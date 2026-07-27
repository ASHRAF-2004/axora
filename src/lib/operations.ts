import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDemoStore } from "./demo-data";
import { addDemoAudit, getDemoOperations } from "./demo-operations";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { requirePermission } from "./auth";
import { canAccess, type Permission } from "./permissions";
import { COD_PAYMENT_METHOD } from "./types";
import { roundMoney } from "./domain";
import type { ApprovalRecord, AttachmentRecord, AuditRecord, DeliveryRecord, DeliveryStatus, InvoiceRecord, InvoiceStatus, PaymentRecord, QuotationRecord, UserRole } from "./types";

const RECEIPT_DELIVERY_STATUSES: DeliveryStatus[] = ["Partially Delivered", "Delivered"];

interface OperationActor {
  id: string;
  name: string;
  role?: UserRole;
  companyId?: string;
  branchId?: string;
  isOwner?: boolean;
}

function operationActorCanAccess(actor: OperationActor, permission: Permission) {
  return Boolean(
    actor.role
    && canAccess({
      role: actor.role,
      isOwner: Boolean(actor.isOwner),
      branchId: actor.branchId,
    }, permission),
  );
}

function isSelfScopedRequester(actor: OperationActor) {
  return !actor.isOwner && ["REQUESTER", "OPERATIONS"].includes(actor.role ?? "");
}

function operationRequestScope(
  actor: OperationActor,
  companyColumn: string,
  branchColumn: string,
  createdByColumn: string,
) {
  if (actor.isOwner) return { where: "", values: [] as unknown[] };
  const values: unknown[] = [actor.companyId];
  const conditions = [`${companyColumn}=$1`];
  if (actor.branchId) {
    values.push(actor.branchId);
    conditions.push(`${branchColumn}=$${values.length}`);
  }
  if (isSelfScopedRequester(actor)) {
    values.push(actor.id);
    conditions.push(`${createdByColumn}=$${values.length}`);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, values };
}

function demoRequestVisibleToActor(request: ReturnType<typeof getDemoStore>["requests"][number], actor: OperationActor) {
  return actor.isOwner || (
    request.companyId === actor.companyId
    && (!actor.branchId || request.branchId === actor.branchId)
    && (!isSelfScopedRequester(actor) || request.createdById === actor.id)
  );
}

export async function listQuotations(): Promise<QuotationRecord[]> {
  await requirePermission("manage_sourcing");
  if (isDemoMode()) return getDemoOperations().quotations;
  const result = await query<QuotationRecord>(`SELECT q.id::text, q.request_line_id::text AS "requestLineId", l.request_line_code AS "requestLineCode",
    r.order_code AS "orderCode", l.product_name_snapshot AS "productName", q.supplier_id::text AS "supplierId", s.name AS "supplierName",
    COALESCE(q.quotation_reference,'') AS "quotationReference", q.quotation_date::text AS "quotationDate", q.unit_price::float8 AS "unitPrice",
    q.delivery_charge::float8 AS "deliveryCharge", q.minimum_order_quantity::float8 AS "minimumOrderQuantity", q.lead_time_days AS "leadTimeDays",
    q.valid_until::text AS "validUntil", l.quantity::float8 AS "requestLineQuantity", s.active AS "supplierActive",
    st.label AS status, q.selected, q.selection_reason AS "selectionReason"
    FROM quotations q JOIN request_lines l ON l.id=q.request_line_id JOIN requests r ON r.id=l.request_id
    JOIN suppliers s ON s.id=q.supplier_id JOIN lookup_values st ON st.id=q.status_id
    ORDER BY q.created_at DESC`);
  return result.rows;
}

export interface NewQuotationInput { requestLineId: string; supplierId: string; quotationReference: string; quotationDate: string; unitPrice: number; deliveryCharge: number; minimumOrderQuantity?: number; leadTimeDays?: number; validUntil?: string; }

export async function createQuotation(input: NewQuotationInput, actor: OperationActor) {
  if (!actor.isOwner) throw new Error("Only Axora platform owners can manage supplier quotations.");
  if (input.validUntil && input.validUntil < input.quotationDate) {
    throw new Error("Quotation validity cannot end before the quotation date.");
  }
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === input.requestLineId));
    const line = request?.lines.find((item) => item.id === input.requestLineId);
    const supplier = getDemoStore().suppliers.find((item) => item.id === input.supplierId);
    if (!request || !line || !supplier || supplier.status !== "Active") throw new Error("Select a valid request line and active supplier.");
    if (request.status !== "Waiting for Quotation" || request.approvalStatus !== "Approved") {
      throw new Error("The company must approve this request before Axora records quotations.");
    }
    getDemoOperations().quotations.unshift({ id: randomUUID(), requestLineId: line.id, requestLineCode: line.code, orderCode: request.orderCode,
      productName: line.productName, supplierId: supplier.id, supplierName: supplier.name, quotationReference: input.quotationReference,
      quotationDate: input.quotationDate, unitPrice: input.unitPrice, deliveryCharge: input.deliveryCharge, minimumOrderQuantity: input.minimumOrderQuantity,
      leadTimeDays: input.leadTimeDays, validUntil: input.validUntil, status: "Received", selected: false });
    addDemoAudit("quotations", line.id, "INSERT", actor.name, `Quotation ${input.quotationReference}`);
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const result = await client.query(`INSERT INTO quotations
      (request_line_id,supplier_id,quotation_reference,quotation_date,unit_price,delivery_charge,minimum_order_quantity,lead_time_days,valid_until,status_id)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,lookup_id('quotation_status','Received')
      FROM request_lines l JOIN requests r ON r.id=l.request_id JOIN suppliers s ON s.id=$2 JOIN lookup_values rs ON rs.id=r.status_id
      WHERE l.id=$1 AND s.active=true AND s.company_id IS NULL AND rs.label='Waiting for Quotation'
        AND EXISTS (
          SELECT 1 FROM approvals a
          WHERE a.request_id=r.id AND a.approval_type='Company approval' AND a.status='Approved'
        )`,
      [input.requestLineId, input.supplierId, input.quotationReference, input.quotationDate, input.unitPrice, input.deliveryCharge,
        input.minimumOrderQuantity ?? null, input.leadTimeDays ?? null, input.validUntil || null]);
    if (!result.rowCount) throw new Error("Request line or supplier not found.");
  });
}

export async function selectQuotation(id: string, reason: string, actor: OperationActor) {
  if (!actor.isOwner) throw new Error("Only Axora platform owners can select supplier quotations.");
  if (!reason.trim()) throw new Error("Explain why this quotation was selected.");
  if (isDemoMode()) {
    const ops = getDemoOperations();
    const selected = ops.quotations.find((item) => item.id === id);
    if (!selected) throw new Error("Quotation not found.");
    const request = getDemoStore().requests.find((item) => item.lines.some((candidate) => candidate.id === selected.requestLineId));
    const line = request?.lines.find((item) => item.id === selected.requestLineId);
    const supplier = getDemoStore().suppliers.find((item) => item.id === selected.supplierId);
    if (request?.status !== "Waiting for Quotation" || request.approvalStatus !== "Approved") {
      throw new Error("The company must approve this request before Axora selects a quotation.");
    }
    if (!line || !supplier || supplier.status !== "Active") {
      throw new Error("This quotation's supplier is no longer active.");
    }
    if (selected.minimumOrderQuantity && selected.minimumOrderQuantity > line.quantity) {
      throw new Error("This quotation's minimum order quantity exceeds the requested quantity.");
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    if (selected.validUntil && selected.validUntil < today) {
      throw new Error("This quotation has expired. Record a current supplier quotation.");
    }
    ops.quotations.forEach((item) => { if (item.requestLineId === selected.requestLineId) item.selected = item.id === id; });
    selected.status = "Selected"; selected.selectionReason = reason;
    if (line) { line.supplierId = selected.supplierId; line.supplierName = selected.supplierName; line.quotationReference = selected.quotationReference; line.unitBuyPrice = selected.unitPrice; line.deliveryCharge = selected.deliveryCharge; line.supplierConfirmationStatus = "Confirmed"; }
    if (request?.status === "Waiting for Quotation" && request.lines.every((candidate) => candidate.supplierId)) {
      request.status = "Supplier Assigned";
    }
    addDemoAudit("quotations", id, "SELECT", actor.name, "Axora supplier quotation selected");
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: "Axora supplier quotation selected" }, async (client) => {
    const quotation = await client.query<{
      requestLineId: string;
      supplierId: string;
      reference: string;
      unitPrice: number;
      deliveryCharge: number;
      lineQuantity: number;
      minimumOrderQuantity?: number;
      validUntil?: string;
      supplierActive: boolean;
    }>(
      `SELECT q.request_line_id::text AS "requestLineId",q.supplier_id::text AS "supplierId",
         COALESCE(q.quotation_reference,'') AS reference,q.unit_price::float8 AS "unitPrice",
         q.delivery_charge::float8 AS "deliveryCharge",l.quantity::float8 AS "lineQuantity",
         q.minimum_order_quantity::float8 AS "minimumOrderQuantity",q.valid_until::text AS "validUntil",
         s.active AS "supplierActive"
       FROM quotations q
       JOIN request_lines l ON l.id=q.request_line_id
       JOIN requests r ON r.id=l.request_id
       JOIN lookup_values rs ON rs.id=r.status_id
       JOIN suppliers s ON s.id=q.supplier_id
       WHERE q.id=$1 AND rs.label='Waiting for Quotation'
         AND EXISTS (
           SELECT 1 FROM approvals a
           WHERE a.request_id=r.id AND a.approval_type='Company approval' AND a.status='Approved'
         )
       FOR UPDATE OF q,l,r,s`,
      [id],
    );
    if (!quotation.rows[0]) throw new Error("Quotation not found.");
    const q = quotation.rows[0];
    if (!q.supplierActive) throw new Error("This quotation's supplier is no longer active.");
    if (q.minimumOrderQuantity && q.minimumOrderQuantity > q.lineQuantity) {
      throw new Error("This quotation's minimum order quantity exceeds the requested quantity.");
    }
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
    if (q.validUntil && q.validUntil < today) {
      throw new Error("This quotation has expired. Record a current supplier quotation.");
    }
    await client.query("UPDATE quotations SET selected=false,status_id=lookup_id('quotation_status','Rejected') WHERE request_line_id=$1 AND id<>$2", [q.requestLineId, id]);
    await client.query("UPDATE quotations SET selected=true,status_id=lookup_id('quotation_status','Selected'),selection_reason=$2 WHERE id=$1", [id, reason]);
    await client.query(`UPDATE request_lines SET selected_supplier_id=$2,quotation_reference=$3,unit_buy_price=$4,delivery_charge=$5,
      supplier_confirmation_status_id=lookup_id('supplier_confirmation','Confirmed') WHERE id=$1`, [q.requestLineId, q.supplierId, q.reference, q.unitPrice, q.deliveryCharge]);
    await client.query(`UPDATE requests r
      SET status_id=lookup_id('request_status','Supplier Assigned')
      WHERE r.id=(SELECT request_id FROM request_lines WHERE id=$1)
        AND r.status_id=lookup_id('request_status','Waiting for Quotation')
        AND NOT EXISTS (
          SELECT 1 FROM request_lines pending
          WHERE pending.request_id=r.id AND pending.selected_supplier_id IS NULL
        )`, [q.requestLineId]);
  });
}

export async function listApprovals(): Promise<ApprovalRecord[]> {
  const actor = await requirePermission("view_approvals");
  if (isDemoMode()) return getDemoOperations().approvals;
  const result = await query<ApprovalRecord>(`SELECT a.id::text,a.request_id::text AS "requestId",r.order_code AS "orderCode",c.name AS "companyName",
    a.approval_type AS "approvalType",a.status,u.display_name AS "reviewerName",a.reason,a.decided_at::text AS "decidedAt",a.created_at::text AS "createdAt"
    FROM approvals a JOIN requests r ON r.id=a.request_id JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=a.reviewer_id
    ${actor.isOwner ? "" : actor.branchId ? "WHERE r.company_id=$1 AND r.branch_id=$2" : "WHERE r.company_id=$1"}
    ORDER BY a.created_at DESC`, actor.isOwner ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId]);
  return result.rows;
}

export async function recordApproval(input: { requestId: string; approvalType: string; status: ApprovalRecord["status"]; reason?: string }, actor: OperationActor) {
  if (input.status === "Rejected" && !input.reason?.trim()) throw new Error("A rejection reason is required.");
  if (input.status === "Pending") throw new Error("Choose Approve or Reject.");
  if (actor.isOwner || !actor.companyId || !["ADMIN", "BRANCH_ADMIN", "APPROVER"].includes(actor.role ?? "")) {
    throw new Error("Only an assigned company approver can decide this request.");
  }
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    if (!request) throw new Error("Request not found.");
    const branch = getDemoStore().branches.find((item) => item.id === request.branchId);
    if (!branch || branch.status !== "Active") throw new Error("This branch is inactive and cannot approve new spending.");
    getDemoOperations().approvals.unshift({ id: randomUUID(), requestId: request.id, orderCode: request.orderCode, companyName: request.companyName,
      approvalType: "Company approval", status: input.status, reviewerName: actor.name, reason: input.reason,
      decidedAt: new Date().toISOString(), createdAt: new Date().toISOString() });
    request.approvalStatus = input.status;
    request.approvalReason = input.reason;
    request.approvedByName = actor.name;
    if (input.status === "Rejected") {
      request.status = "Cancelled";
      request.issueReason = input.reason;
    }
    addDemoAudit("approvals", request.id, "INSERT", actor.name, input.reason);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: input.reason }, async (client) => {
    const request = await client.query<{
      createdBy?: string;
      branchId: string;
      monthlyBudget?: number;
      estimatedTotal: number;
    }>(`SELECT r.created_by::text AS "createdBy",r.branch_id::text AS "branchId",
        b.monthly_budget::float8 AS "monthlyBudget",
        COALESCE((SELECT sum(round(l.quantity*l.unit_sell_price,2)) FROM request_lines l WHERE l.request_id=r.id),0)::float8 AS "estimatedTotal"
      FROM requests r
      JOIN branches b ON b.id=r.branch_id
      JOIN lookup_values rs ON rs.id=r.status_id
      WHERE r.id=$1 AND r.company_id=$2 AND ($3::uuid IS NULL OR r.branch_id=$3)
        AND rs.label='New Request' AND b.active=true
      FOR UPDATE OF r,b`,
    [input.requestId, actor.companyId, actor.branchId ?? null]);
    const current = request.rows[0];
    if (!current) throw new Error("This request is not pending approval for your branch.");
    if (current.createdBy === actor.id) throw new Error("You cannot approve your own purchase request.");

    const prior = await client.query(
      "SELECT 1 FROM approvals WHERE request_id=$1 AND approval_type='Company approval' AND status IN ('Approved','Rejected') LIMIT 1",
      [input.requestId],
    );
    if (prior.rowCount) throw new Error("This purchase request already has a final company decision.");

    if (input.status === "Approved" && current.monthlyBudget !== undefined && current.monthlyBudget !== null) {
      const usage = await client.query<{ committed: number }>(
        "SELECT committed_amount::float8 AS committed FROM v_branch_budget_usage WHERE branch_id=$1",
        [current.branchId],
      );
      const committed = Number(usage.rows[0]?.committed ?? 0);
      if (committed + current.estimatedTotal > current.monthlyBudget) {
        throw new Error("This request exceeds the branch's available monthly budget.");
      }
    }

    await client.query(`INSERT INTO approvals
      (request_id,approval_type,status,reviewer_id,reason,decided_at)
      VALUES ($1,'Company approval',$2,$3,$4,now())`,
    [input.requestId, input.status, actor.id, input.reason ?? null]);

    if (input.status === "Rejected") {
      await client.query(`UPDATE requests
        SET status_id=lookup_id('request_status','Cancelled'),issue_reason=$2
        WHERE id=$1`, [input.requestId, input.reason]);
    }
  });
}

export async function listDeliveries(): Promise<DeliveryRecord[]> {
  const actor = await requirePermission("view_deliveries");
  if (isDemoMode()) {
    if (actor.isOwner) return getDemoOperations().deliveries;
    return getDemoOperations().deliveries.filter((delivery) => {
      const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === delivery.requestLineId));
      return Boolean(request && demoRequestVisibleToActor(request, actor));
    });
  }
  const scope = operationRequestScope(actor, "r.company_id", "r.branch_id", "r.created_by");
  const result = await query<DeliveryRecord>(`SELECT d.id::text,d.request_line_id::text AS "requestLineId",l.request_line_code AS "requestLineCode",r.order_code AS "orderCode",
    c.name AS "companyName",l.product_name_snapshot AS "productName",d.expected_date::text AS "expectedDate",d.revised_date::text AS "revisedDate",
    d.actual_date::text AS "actualDate",st.label AS status,d.quantity_received::float8 AS "quantityReceived",d.received_by AS "receivedBy",
    d.issue_reason AS "issueReason",d.created_at::text AS "createdAt"
    FROM deliveries d JOIN request_lines l ON l.id=d.request_line_id JOIN requests r ON r.id=l.request_id JOIN companies c ON c.id=r.company_id
    JOIN lookup_values st ON st.id=d.status_id ${scope.where} ORDER BY d.created_at DESC`, scope.values);
  return result.rows;
}

export async function recordDelivery(input: { requestLineId: string; expectedDate?: string; revisedDate?: string; actualDate?: string; status: DeliveryStatus; quantityReceived: number; receivedBy?: string; issueReason?: string }, actor: OperationActor) {
  if (!actor.isOwner) throw new Error("Only Axora platform owners can record delivery updates.");
  if (!Number.isFinite(input.quantityReceived) || input.quantityReceived < 0) throw new Error("Enter a valid received quantity.");
  const isReceipt = RECEIPT_DELIVERY_STATUSES.includes(input.status);
  if (isReceipt && input.quantityReceived <= 0) throw new Error("A partial or full delivery must record a received quantity greater than zero.");
  if (isReceipt && (!input.actualDate || !input.receivedBy?.trim())) {
    throw new Error("A partial or full delivery requires the actual date and receiver's name.");
  }
  if (!isReceipt && input.quantityReceived !== 0) {
    throw new Error("Only a partial or full delivery can add to the received quantity.");
  }
  if (["Delayed", "Failed", "Cancelled"].includes(input.status) && !input.issueReason?.trim()) throw new Error("An issue reason is required for this delivery status.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === input.requestLineId));
    const line = request?.lines.find((item) => item.id === input.requestLineId);
    if (!request || !line) throw new Error("Request line not found.");
    const alreadyReceived = getDemoOperations().deliveries
      .filter((item) => item.requestLineId === line.id && RECEIPT_DELIVERY_STATUSES.includes(item.status))
      .reduce((sum, item) => sum + item.quantityReceived, 0);
    if (alreadyReceived >= line.quantity - 0.0001) {
      throw new Error("This request line is already fully delivered and cannot receive another delivery update.");
    }
    const receivedAfterUpdate = alreadyReceived + input.quantityReceived;
    if (receivedAfterUpdate > line.quantity) throw new Error("Received quantity cannot exceed the ordered quantity.");
    if (input.status === "Delivered" && Math.abs(receivedAfterUpdate - line.quantity) > 0.0001) {
      throw new Error("Use Partially Delivered until the full ordered quantity is accepted.");
    }
    if (input.status === "Partially Delivered" && receivedAfterUpdate >= line.quantity - 0.0001) {
      throw new Error("Use Delivered when this receipt completes the ordered quantity.");
    }
    getDemoOperations().deliveries.unshift({ id: randomUUID(), requestLineId: line.id, requestLineCode: line.code, orderCode: request.orderCode,
      companyName: request.companyName, productName: line.productName, expectedDate: input.expectedDate, revisedDate: input.revisedDate,
      actualDate: input.actualDate, status: input.status, quantityReceived: input.quantityReceived, receivedBy: input.receivedBy,
      issueReason: input.issueReason, createdAt: new Date().toISOString() });
    line.deliveryStatus = input.status; line.quantityReceived = alreadyReceived + input.quantityReceived; line.expectedDeliveryDate = input.revisedDate || input.expectedDate; line.actualDeliveryDate = input.actualDate;
    addDemoAudit("deliveries", line.id, "INSERT", actor.name, input.issueReason);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: input.issueReason }, async (client) => {
    const line = await client.query<{ quantity: number }>(`SELECT l.quantity::float8 AS quantity FROM request_lines l JOIN requests r ON r.id=l.request_id
      JOIN lookup_values rs ON rs.id=r.status_id WHERE l.id=$1 AND rs.label IN ('Ordered','Preparing for Delivery','Out for Delivery')
      FOR UPDATE`, [input.requestLineId]);
    if (!line.rows[0]) throw new Error("Request line not found.");
    const received = await client.query<{ total: number }>(`SELECT COALESCE(sum(d.quantity_received),0)::float8 AS total
      FROM deliveries d JOIN lookup_values ds ON ds.id=d.status_id
      WHERE d.request_line_id=$1 AND ds.label IN ('Partially Delivered','Delivered')`, [input.requestLineId]);
    if (received.rows[0].total >= line.rows[0].quantity - 0.0001) {
      throw new Error("This request line is already fully delivered and cannot receive another delivery update.");
    }
    const receivedAfterUpdate = received.rows[0].total + input.quantityReceived;
    if (receivedAfterUpdate > line.rows[0].quantity) throw new Error("Received quantity cannot exceed the ordered quantity.");
    if (input.status === "Delivered" && Math.abs(receivedAfterUpdate - line.rows[0].quantity) > 0.0001) {
      throw new Error("Use Partially Delivered until the full ordered quantity is accepted.");
    }
    if (input.status === "Partially Delivered" && receivedAfterUpdate >= line.rows[0].quantity - 0.0001) {
      throw new Error("Use Delivered when this receipt completes the ordered quantity.");
    }
    await client.query(`INSERT INTO deliveries (request_line_id,expected_date,revised_date,actual_date,status_id,quantity_received,received_by,issue_reason)
      VALUES ($1,$2,$3,$4,lookup_id('delivery_status',$5),$6,$7,$8)`, [input.requestLineId, input.expectedDate || null, input.revisedDate || null,
        input.actualDate || null, input.status, input.quantityReceived, input.receivedBy || null, input.issueReason || null]);
  });
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  const actor = await requirePermission("view_invoices");
  if (isDemoMode()) return actor.isOwner
    ? getDemoOperations().invoices
    : getDemoOperations().invoices.filter((invoice) => invoice.direction === "CUSTOMER");
  const visibilityClause = actor.isOwner
    ? ""
    : actor.branchId
      ? "WHERE r.company_id=$1 AND r.branch_id=$2 AND b.direction='CUSTOMER'"
      : "WHERE r.company_id=$1 AND b.direction='CUSTOMER'";
  const visibilityParams = actor.isOwner ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId];
  const result = await query<InvoiceRecord>(`SELECT b.id::text,b.direction,b.request_id::text AS "requestId",r.order_code AS "orderCode",
    CASE WHEN b.direction='CUSTOMER' THEN c.name ELSE s.name END AS counterparty,b.invoice_number AS "invoiceNumber",b.invoice_date::text AS "invoiceDate",
    b.due_date::text AS "dueDate",b.amount::float8,b.status::text,b.paid_amount::float8 AS "paidAmount",b.outstanding_amount::float8 AS "outstandingAmount",
    CASE WHEN b.payment_status='Void' THEN 'Void' ELSE b.payment_status END AS "paymentStatus",
    rs.label AS "requestStatus"
    FROM (SELECT v.*,lv.label AS status FROM v_invoice_balances v JOIN lookup_values lv ON lv.id=v.status_id) b
    JOIN requests r ON r.id=b.request_id LEFT JOIN companies c ON c.id=b.company_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    JOIN lookup_values rs ON rs.id=r.status_id
    ${visibilityClause} ORDER BY b.invoice_date DESC,b.invoice_number`, visibilityParams);
  return result.rows;
}

export async function createInvoice(input: { direction: "CUSTOMER" | "SUPPLIER"; requestId: string; supplierId?: string; invoiceNumber: string; invoiceDate: string; dueDate?: string; amount: number; status: InvoiceStatus }, actor: OperationActor) {
  if (!actor.isOwner) throw new Error("Only Axora platform owners can create invoices.");
  if (input.direction === "SUPPLIER" && !input.supplierId) throw new Error("Select the supplier for a supplier invoice.");
  if (input.status !== "Issued") throw new Error("New invoices must be issued records.");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a positive invoice amount.");
  if (!input.invoiceNumber.trim()) throw new Error("Enter the invoice number.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    const supplier = getDemoStore().suppliers.find((item) => item.id === input.supplierId);
    if (!request) throw new Error("Request not found.");
    if (request.approvalStatus !== "Approved"
        || !["Delivered", "Invoice Issued"].includes(request.status)
        || request.lines.some((line) => line.quantityReceived < line.quantity)) {
      throw new Error("Invoices can be issued only after the approved request is fully delivered.");
    }
    if (input.direction === "SUPPLIER" && (!supplier || !request.lines.some((line) => line.supplierId === supplier.id))) {
      throw new Error("The supplier must be selected on this request.");
    }
    if (input.direction === "CUSTOMER") {
      const authorizedTotal = request.lines.reduce((sum, line) => sum + roundMoney(line.quantity * line.unitSellPrice), 0);
      const invoicedTotal = getDemoOperations().invoices
        .filter((invoice) => invoice.requestId === request.id && invoice.direction === "CUSTOMER" && invoice.status !== "Cancelled")
        .reduce((sum, invoice) => sum + invoice.amount, 0);
      if (invoicedTotal + input.amount > authorizedTotal + 0.001) {
        throw new Error("Customer invoices cannot exceed the total approved by the company.");
      }
    }
    getDemoOperations().invoices.unshift({ id: randomUUID(), direction: input.direction, requestId: request.id, orderCode: request.orderCode,
      counterparty: input.direction === "CUSTOMER" ? request.companyName : supplier?.name ?? "Unknown supplier", invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate, dueDate: input.dueDate, amount: input.amount, status: "Issued", paidAmount: 0,
      outstandingAmount: input.amount, paymentStatus: "Unpaid", requestStatus: input.direction === "CUSTOMER" ? "Invoice Issued" : request.status });
    if (input.direction === "CUSTOMER") {
      request.status = "Invoice Issued";
      request.invoiceStatus = "Issued";
      request.invoiceNumber = input.invoiceNumber;
    }
    addDemoAudit("invoices", request.id, "INSERT", actor.name, input.invoiceNumber);
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const request = await client.query<{ companyId: string; status: string }>(
      `SELECT r.company_id::text AS "companyId",rs.label AS status
       FROM requests r JOIN lookup_values rs ON rs.id=r.status_id
       WHERE r.id=$1
         AND rs.label IN ('Delivered','Invoice Issued')
         AND EXISTS (
           SELECT 1 FROM approvals a
           WHERE a.request_id=r.id AND a.approval_type='Company approval' AND a.status='Approved'
         )
         AND NOT EXISTS (
           SELECT 1 FROM request_lines line
           WHERE line.request_id=r.id
             AND COALESCE((
               SELECT sum(delivery.quantity_received)
               FROM deliveries delivery
               JOIN lookup_values delivery_status ON delivery_status.id=delivery.status_id
               WHERE delivery.request_line_id=line.id
                 AND delivery_status.label IN ('Partially Delivered','Delivered')
             ),0) < line.quantity
         )
       FOR UPDATE OF r`,
      [input.requestId],
    );
    if (!request.rows[0]) throw new Error("Invoices can be issued only after the approved request is fully delivered.");
    if (input.direction === "SUPPLIER") {
      const supplier = await client.query(
        `SELECT 1 FROM suppliers s
         WHERE s.id=$1 AND s.company_id IS NULL AND s.active=true
           AND EXISTS (
             SELECT 1 FROM request_lines l
             WHERE l.request_id=$2 AND l.selected_supplier_id=s.id
           )
         FOR SHARE`,
        [input.supplierId, input.requestId],
      );
      if (!supplier.rowCount) throw new Error("The supplier must be selected on this request.");
    }
    if (input.direction === "CUSTOMER") {
      const totals = await client.query<{ authorizedTotal: number; invoicedTotal: number }>(
        `SELECT
           COALESCE((SELECT sum(round(l.quantity*l.unit_sell_price,2)) FROM request_lines l WHERE l.request_id=$1),0)::float8 AS "authorizedTotal",
           COALESCE((SELECT sum(i.amount) FROM invoices i JOIN lookup_values invoice_status ON invoice_status.id=i.status_id
             WHERE i.request_id=$1 AND i.direction='CUSTOMER' AND invoice_status.label<>'Cancelled'),0)::float8 AS "invoicedTotal"`,
        [input.requestId],
      );
      if (totals.rows[0].invoicedTotal + input.amount > totals.rows[0].authorizedTotal + 0.001) {
        throw new Error("Customer invoices cannot exceed the total approved by the company.");
      }
    }
    await client.query(`INSERT INTO invoices (direction,request_id,company_id,supplier_id,invoice_number,invoice_date,due_date,amount,status_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,lookup_id('invoice_status',$9))`, [input.direction, input.requestId,
        input.direction === "CUSTOMER" ? request.rows[0].companyId : null, input.direction === "SUPPLIER" ? input.supplierId : null,
        input.invoiceNumber, input.invoiceDate, input.dueDate || null, input.amount, input.status]);
    if (input.direction === "CUSTOMER" && request.rows[0].status === "Delivered") {
      await client.query(
        "UPDATE requests SET status_id=lookup_id('request_status','Invoice Issued') WHERE id=$1",
        [input.requestId],
      );
    }
  });
}

export async function listPayments(): Promise<PaymentRecord[]> {
  const actor = await requirePermission("view_invoices");
  if (isDemoMode()) {
    if (actor.isOwner) return getDemoOperations().payments;
    const customerInvoiceIds = new Set(getDemoOperations().invoices
      .filter((invoice) => invoice.direction === "CUSTOMER")
      .map((invoice) => invoice.id));
    return getDemoOperations().payments.filter((payment) => customerInvoiceIds.has(payment.invoiceId));
  }
  const visibilityClause = actor.isOwner
    ? ""
    : actor.branchId
      ? "WHERE r.company_id=$1 AND r.branch_id=$2 AND i.direction='CUSTOMER'"
      : "WHERE r.company_id=$1 AND i.direction='CUSTOMER'";
  const visibilityParams = actor.isOwner ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId];
  const result = await query<PaymentRecord>(`SELECT p.id::text,p.invoice_id::text AS "invoiceId",i.invoice_number AS "invoiceNumber",p.payment_date::text AS "paymentDate",
    p.amount::float8,p.method,p.reference,u.display_name AS "recordedByName" FROM payments p JOIN invoices i ON i.id=p.invoice_id
    JOIN requests r ON r.id=i.request_id LEFT JOIN users u ON u.id=p.recorded_by
    ${visibilityClause} ORDER BY p.payment_date DESC,p.created_at DESC`, visibilityParams);
  return result.rows;
}

export async function recordPayment(input: { invoiceId: string; paymentDate: string; amount: number; method: string; reference?: string }, actor: OperationActor) {
  if (!actor.isOwner) throw new Error("Only Axora platform owners can record payments.");
  if (input.method !== COD_PAYMENT_METHOD) throw new Error(`Only ${COD_PAYMENT_METHOD} is currently supported.`);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a positive payment amount.");
  const reference = input.reference?.trim();
  if (!reference) throw new Error("Enter the numbered receipt or collection reference.");
  if (isDemoMode()) {
    const invoice = getDemoOperations().invoices.find((item) => item.id === input.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    const request = getDemoStore().requests.find((item) => item.id === invoice.requestId);
    if (invoice.status !== "Issued"
        || !request
        || !["Delivered", "Invoice Issued", "Completed"].includes(request.status)
        || request.lines.some((line) => line.quantityReceived < line.quantity)) {
      throw new Error("Record COD only against an issued invoice after delivery.");
    }
    if (input.amount > invoice.outstandingAmount) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    getDemoOperations().payments.unshift({ id: randomUUID(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentDate: input.paymentDate,
      amount: input.amount, method: COD_PAYMENT_METHOD, reference, recordedByName: actor.name });
    invoice.paidAmount += input.amount; invoice.outstandingAmount -= input.amount; invoice.paymentStatus = invoice.outstandingAmount === 0 ? "Paid" : "Partial";
    addDemoAudit("payments", invoice.id, "INSERT", actor.name, reference);
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const invoice = await client.query<{ amount: number }>(
      `SELECT i.amount::float8 AS amount
       FROM invoices i
       JOIN requests r ON r.id=i.request_id
       JOIN lookup_values invoice_status ON invoice_status.id=i.status_id
       JOIN lookup_values request_status ON request_status.id=r.status_id
       WHERE i.id=$1
         AND invoice_status.label='Issued'
         AND request_status.label IN ('Delivered','Invoice Issued','Completed')
         AND NOT EXISTS (
           SELECT 1 FROM request_lines line
           WHERE line.request_id=r.id
             AND COALESCE((
               SELECT sum(delivery.quantity_received)
               FROM deliveries delivery
               JOIN lookup_values delivery_status ON delivery_status.id=delivery.status_id
               WHERE delivery.request_line_id=line.id
                 AND delivery_status.label IN ('Partially Delivered','Delivered')
             ),0) < line.quantity
         )
       FOR UPDATE`,
      [input.invoiceId],
    );
    if (!invoice.rows[0]) throw new Error("Record COD only against an issued invoice after delivery.");
    const paid = await client.query<{ total: number }>("SELECT COALESCE(sum(amount),0)::float8 AS total FROM payments WHERE invoice_id=$1", [input.invoiceId]);
    if (input.amount > invoice.rows[0].amount - paid.rows[0].total) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    await client.query("INSERT INTO payments (invoice_id,payment_date,amount,method,reference,recorded_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [input.invoiceId, input.paymentDate, input.amount, COD_PAYMENT_METHOD, reference, actor.id]);
  });
}

export async function listAuditRecords(): Promise<AuditRecord[]> {
  const actor = await requirePermission("view_audit");
  if (isDemoMode()) {
    return actor.isOwner
      ? getDemoOperations().audit
      : getDemoOperations().audit.filter((item) => item.entityType !== "quotations");
  }
  const customerAuditScope = actor.isOwner ? "" : ` AND (
      a.entity_type IN ('companies','users','branches','requests','request_lines','approvals','deliveries')
      OR (a.entity_type='invoices' AND EXISTS (
        SELECT 1 FROM invoices visible_invoice
        WHERE visible_invoice.id=a.record_id AND visible_invoice.direction='CUSTOMER'
      ))
      OR (a.entity_type='invoice_allocations' AND EXISTS (
        SELECT 1 FROM invoice_allocations visible_allocation
        JOIN invoices visible_invoice ON visible_invoice.id=visible_allocation.invoice_id
        WHERE visible_allocation.id=a.record_id AND visible_invoice.direction='CUSTOMER'
      ))
      OR (a.entity_type='payments' AND EXISTS (
        SELECT 1 FROM payments visible_payment
        JOIN invoices visible_invoice ON visible_invoice.id=visible_payment.invoice_id
        WHERE visible_payment.id=a.record_id AND visible_invoice.direction='CUSTOMER'
      ))
      OR (a.entity_type='attachments' AND EXISTS (
        SELECT 1 FROM attachments visible_attachment
        WHERE visible_attachment.id=a.record_id AND visible_attachment.visibility='CUSTOMER'
      ))
    )`;
  const branchScope = actor.branchId ? ` AND (
      (a.entity_type='branches' AND a.record_id=$2)
      OR (a.entity_type='users' AND EXISTS (
        SELECT 1 FROM users scoped_user WHERE scoped_user.id=a.record_id AND scoped_user.branch_id=$2
      ))
      OR (a.entity_type='requests' AND EXISTS (
        SELECT 1 FROM requests scoped_request WHERE scoped_request.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='request_lines' AND EXISTS (
        SELECT 1 FROM request_lines scoped_line JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
        WHERE scoped_line.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='quotations' AND EXISTS (
        SELECT 1 FROM quotations scoped_quote
        JOIN request_lines scoped_line ON scoped_line.id=scoped_quote.request_line_id
        JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
        WHERE scoped_quote.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='approvals' AND EXISTS (
        SELECT 1 FROM approvals scoped_approval JOIN requests scoped_request ON scoped_request.id=scoped_approval.request_id
        WHERE scoped_approval.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='deliveries' AND EXISTS (
        SELECT 1 FROM deliveries scoped_delivery
        JOIN request_lines scoped_line ON scoped_line.id=scoped_delivery.request_line_id
        JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
        WHERE scoped_delivery.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='invoices' AND EXISTS (
        SELECT 1 FROM invoices scoped_invoice JOIN requests scoped_request ON scoped_request.id=scoped_invoice.request_id
        WHERE scoped_invoice.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='invoice_allocations' AND EXISTS (
        SELECT 1 FROM invoice_allocations scoped_allocation
        JOIN request_lines scoped_line ON scoped_line.id=scoped_allocation.request_line_id
        JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
        WHERE scoped_allocation.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='payments' AND EXISTS (
        SELECT 1 FROM payments scoped_payment
        JOIN invoices scoped_invoice ON scoped_invoice.id=scoped_payment.invoice_id
        JOIN requests scoped_request ON scoped_request.id=scoped_invoice.request_id
        WHERE scoped_payment.id=a.record_id AND scoped_request.branch_id=$2
      ))
      OR (a.entity_type='attachments' AND EXISTS (
        SELECT 1 FROM attachments scoped_attachment
        WHERE scoped_attachment.id=a.record_id AND (
          (scoped_attachment.entity_type='request' AND EXISTS (
            SELECT 1 FROM requests scoped_request
            WHERE scoped_request.id=scoped_attachment.record_id AND scoped_request.branch_id=$2
          ))
          OR (scoped_attachment.entity_type='invoice' AND EXISTS (
            SELECT 1 FROM invoices scoped_invoice JOIN requests scoped_request ON scoped_request.id=scoped_invoice.request_id
            WHERE scoped_invoice.id=scoped_attachment.record_id AND scoped_request.branch_id=$2
          ))
          OR (scoped_attachment.entity_type='delivery' AND EXISTS (
            SELECT 1 FROM deliveries scoped_delivery
            JOIN request_lines scoped_line ON scoped_line.id=scoped_delivery.request_line_id
            JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
            WHERE scoped_delivery.id=scoped_attachment.record_id AND scoped_request.branch_id=$2
          ))
        )
      ))
    )` : "";
  const visibilityClause = actor.isOwner ? "" : `WHERE a.company_id=$1${customerAuditScope}${branchScope}`;
  const visibilityParams = actor.isOwner ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId];
  const result = await query<AuditRecord>(`SELECT a.id::text,a.entity_type AS "entityType",a.record_id::text AS "recordId",a.action,
    u.display_name AS "actorName",a.reason,a.occurred_at::text AS "occurredAt" FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
    ${visibilityClause} ORDER BY a.occurred_at DESC LIMIT 500`, visibilityParams);
  return result.rows;
}

function getDemoRequestForLinkedRecord(entityType: string, recordId: string) {
  if (entityType === "request") return getDemoStore().requests.find((request) => request.id === recordId);
  if (entityType === "invoice") {
    const invoice = getDemoOperations().invoices.find((item) => item.id === recordId);
    return getDemoStore().requests.find((request) => request.id === invoice?.requestId);
  }
  if (entityType === "delivery") {
    const delivery = getDemoOperations().deliveries.find((item) => item.id === recordId);
    return getDemoStore().requests.find((request) => request.lines.some((line) => line.id === delivery?.requestLineId));
  }
  return undefined;
}

function attachmentLinkedRequestScope(predicate: string) {
  return ` AND (
    (a.entity_type='request' AND EXISTS (
      SELECT 1 FROM requests scoped_request
      WHERE scoped_request.id=a.record_id AND ${predicate}
    ))
    OR (a.entity_type='invoice' AND EXISTS (
      SELECT 1 FROM invoices scoped_invoice
      JOIN requests scoped_request ON scoped_request.id=scoped_invoice.request_id
      WHERE scoped_invoice.id=a.record_id AND ${predicate}
    ))
    OR (a.entity_type='delivery' AND EXISTS (
      SELECT 1 FROM deliveries scoped_delivery
      JOIN request_lines scoped_line ON scoped_line.id=scoped_delivery.request_line_id
      JOIN requests scoped_request ON scoped_request.id=scoped_line.request_id
      WHERE scoped_delivery.id=a.record_id AND ${predicate}
    ))
  )`;
}

export async function listAttachments(): Promise<AttachmentRecord[]> {
  const actor = await requirePermission("view_documents");
  const canViewAttachmentType = (entityType: AttachmentRecord["entityType"]) =>
    entityType === "invoice"
      ? canAccess(actor, "view_invoices")
      : entityType === "delivery"
        ? canAccess(actor, "view_deliveries")
        : entityType === "request" && canAccess(actor, "view_requests");
  if (isDemoMode()) {
    if (actor.isOwner) return getDemoOperations().attachments;
    return getDemoOperations().attachments.filter((attachment) => {
      const request = getDemoRequestForLinkedRecord(attachment.entityType, attachment.recordId);
      return Boolean(
        canViewAttachmentType(attachment.entityType)
        &&
        attachment.visibility === "CUSTOMER"
        && request
        && demoRequestVisibleToActor(request, actor),
      );
    });
  }
  const visibilityParams: unknown[] = actor.isOwner ? [] : [actor.companyId];
  let linkedScope = "";
  if (!actor.isOwner && actor.branchId) {
    visibilityParams.push(actor.branchId);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.branch_id=$${visibilityParams.length}`);
  }
  if (!actor.isOwner && isSelfScopedRequester(actor)) {
    visibilityParams.push(actor.id);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.created_by=$${visibilityParams.length}`);
  }
  const visibilityClause = actor.isOwner ? "" : `WHERE a.company_id=$1 AND a.visibility='CUSTOMER'${linkedScope}`;
  const result = await query<AttachmentRecord>(`SELECT a.id::text,a.entity_type AS "entityType",a.record_id::text AS "recordId",a.file_name AS "fileName",
    a.content_type AS "contentType",a.visibility,a.created_at::text AS "createdAt",u.display_name AS "uploadedByName" FROM attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by ${visibilityClause} ORDER BY a.created_at DESC`, visibilityParams);
  return actor.isOwner ? result.rows : result.rows.filter((attachment) => canViewAttachmentType(attachment.entityType));
}

const allowedUploadTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);

export async function saveAttachment(input: {
  entityType: "request" | "invoice" | "delivery";
  recordId: string;
  file: File;
  visibility?: "CUSTOMER" | "INTERNAL";
}, actor: OperationActor) {
  const linkedPermission: Permission = input.entityType === "invoice"
    ? "view_invoices"
    : input.entityType === "delivery"
      ? "view_deliveries"
      : "view_requests";
  if (!operationActorCanAccess(actor, linkedPermission)) {
    throw new Error("Your account cannot attach documents to this record type.");
  }
  if (!input.file.size || input.file.size > 2 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 2 MB.");
  if (!allowedUploadTypes.has(input.file.type)) throw new Error("Only PDF, PNG, JPG, TXT, and CSV files are allowed.");
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  if (isDemoMode()) {
    const request = getDemoRequestForLinkedRecord(input.entityType, input.recordId);
    if (!request || !demoRequestVisibleToActor(request, actor)) {
      throw new Error("Linked record not found.");
    }
    const linkedInvoice = input.entityType === "invoice"
      ? getDemoOperations().invoices.find((item) => item.id === input.recordId)
      : undefined;
    if (!actor.isOwner && linkedInvoice?.direction === "SUPPLIER") {
      throw new Error("Supplier invoice documents are internal to Axora.");
    }
    const visibility = linkedInvoice?.direction === "SUPPLIER"
      ? "INTERNAL"
      : actor.isOwner ? input.visibility ?? "INTERNAL" : "CUSTOMER";
    getDemoOperations().attachments.unshift({ id: randomUUID(), entityType: input.entityType, recordId: input.recordId, fileName: safeName,
      contentType: input.file.type, visibility, createdAt: new Date().toISOString(), uploadedByName: actor.name });
    addDemoAudit("attachments", input.recordId, "INSERT", actor.name, safeName);
    return;
  }
  const companyLookup = input.entityType === "request"
    ? `SELECT company_id::text AS "companyId",branch_id::text AS "branchId",created_by::text AS "createdById",NULL::text AS "invoiceDirection"
        FROM requests WHERE id=$1`
    : input.entityType === "invoice"
      ? `SELECT r.company_id::text AS "companyId",r.branch_id::text AS "branchId",r.created_by::text AS "createdById",i.direction AS "invoiceDirection"
          FROM invoices i JOIN requests r ON r.id=i.request_id WHERE i.id=$1`
      : `SELECT r.company_id::text AS "companyId",r.branch_id::text AS "branchId",r.created_by::text AS "createdById",NULL::text AS "invoiceDirection"
          FROM deliveries d JOIN request_lines l ON l.id=d.request_line_id JOIN requests r ON r.id=l.request_id WHERE d.id=$1`;
  const companyResult = await query<{ companyId: string; branchId: string; createdById?: string; invoiceDirection?: string }>(companyLookup, [input.recordId]);
  const linked = companyResult.rows[0];
  if (!linked || (!actor.isOwner && (
    linked.companyId !== actor.companyId
    || (actor.branchId && linked.branchId !== actor.branchId)
    || (isSelfScopedRequester(actor) && linked.createdById !== actor.id)
  ))) throw new Error("Linked record not found.");
  if (!actor.isOwner && linked.invoiceDirection === "SUPPLIER") {
    throw new Error("Supplier invoice documents are internal to Axora.");
  }
  const id = randomUUID();
  const relativePath = path.posix.join(input.entityType, `${id}-${safeName}`);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const visibility = linked.invoiceDirection === "SUPPLIER"
    ? "INTERNAL"
    : actor.isOwner ? input.visibility ?? "INTERNAL" : "CUSTOMER";
  await withAuditTransaction({ userId: actor.id }, (client) => client.query(`INSERT INTO attachments
    (id,entity_type,record_id,file_name,content_type,storage_path,uploaded_by,company_id,file_content,visibility)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, input.entityType, input.recordId, safeName, input.file.type, relativePath, actor.id, linked.companyId, bytes, visibility]));
}

export async function loadAttachmentFile(id: string) {
  const actor = await requirePermission("view_documents");
  if (isDemoMode()) return null;
  const allowedEntityTypes = [
    canAccess(actor, "view_requests") ? "request" : undefined,
    canAccess(actor, "view_invoices") ? "invoice" : undefined,
    canAccess(actor, "view_deliveries") ? "delivery" : undefined,
  ].filter((value): value is string => Boolean(value));
  if (!allowedEntityTypes.length) return null;
  const entityTypeScope = actor.isOwner
    ? ""
    : ` AND a.entity_type IN (${allowedEntityTypes.map((value) => `'${value}'`).join(",")})`;
  const visibilityParams: unknown[] = actor.isOwner ? [id] : [id, actor.companyId];
  let linkedScope = "";
  if (!actor.isOwner && actor.branchId) {
    visibilityParams.push(actor.branchId);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.branch_id=$${visibilityParams.length}`);
  }
  if (!actor.isOwner && isSelfScopedRequester(actor)) {
    visibilityParams.push(actor.id);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.created_by=$${visibilityParams.length}`);
  }
  const visibilityClause = actor.isOwner ? "" : ` AND a.company_id=$2 AND a.visibility='CUSTOMER'${linkedScope}`;
  const result = await query<{ fileName: string; contentType: string; storagePath: string; fileContent?: Buffer }>(`SELECT file_name AS "fileName",content_type AS "contentType",storage_path AS "storagePath",file_content AS "fileContent"
    FROM attachments a WHERE a.id=$1${entityTypeScope}${visibilityClause}`, visibilityParams);
  const record = result.rows[0];
  if (!record) return null;
  if (record.fileContent) return { fileName: record.fileName, contentType: record.contentType, bytes: record.fileContent };
  const uploadRoot = path.resolve(process.cwd(), "data", "uploads");
  const source = path.resolve(uploadRoot, record.storagePath);
  if (!source.startsWith(`${uploadRoot}${path.sep}`)) throw new Error("Invalid stored attachment path.");
  try {
    return { fileName: record.fileName, contentType: record.contentType, bytes: await readFile(source) };
  } catch {
    return null;
  }
}

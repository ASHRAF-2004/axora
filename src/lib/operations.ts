import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDemoStore } from "./demo-data";
import { addDemoAudit, getDemoOperations } from "./demo-operations";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { requireSession } from "./auth";
import { COD_PAYMENT_METHOD } from "./types";
import type { ApprovalRecord, AttachmentRecord, AuditRecord, DeliveryRecord, DeliveryStatus, InvoiceRecord, InvoiceStatus, PaymentRecord, QuotationRecord } from "./types";

interface OperationActor { id: string; name: string; companyId?: string; isOwner?: boolean }

export async function listQuotations(): Promise<QuotationRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().quotations;
  const result = await query<QuotationRecord>(`SELECT q.id::text, q.request_line_id::text AS "requestLineId", l.request_line_code AS "requestLineCode",
    r.order_code AS "orderCode", l.product_name_snapshot AS "productName", q.supplier_id::text AS "supplierId", s.name AS "supplierName",
    COALESCE(q.quotation_reference,'') AS "quotationReference", q.quotation_date::text AS "quotationDate", q.unit_price::float8 AS "unitPrice",
    q.delivery_charge::float8 AS "deliveryCharge", q.minimum_order_quantity::float8 AS "minimumOrderQuantity", q.lead_time_days AS "leadTimeDays",
    q.valid_until::text AS "validUntil", st.label AS status, q.selected, q.selection_reason AS "selectionReason"
    FROM quotations q JOIN request_lines l ON l.id=q.request_line_id JOIN requests r ON r.id=l.request_id
    JOIN suppliers s ON s.id=q.supplier_id JOIN lookup_values st ON st.id=q.status_id
    ${actor.isOwner ? "" : "WHERE r.company_id=$1"} ORDER BY q.created_at DESC`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export interface NewQuotationInput { requestLineId: string; supplierId: string; quotationReference: string; quotationDate: string; unitPrice: number; deliveryCharge: number; minimumOrderQuantity?: number; leadTimeDays?: number; validUntil?: string; }

export async function createQuotation(input: NewQuotationInput, actor: OperationActor) {
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === input.requestLineId));
    const line = request?.lines.find((item) => item.id === input.requestLineId);
    const supplier = getDemoStore().suppliers.find((item) => item.id === input.supplierId);
    if (!request || !line || !supplier) throw new Error("Select a valid request line and supplier.");
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
      WHERE l.id=$1 AND s.company_id=r.company_id AND s.active=true AND rs.label='Waiting for Quotation'${actor.isOwner ? "" : " AND r.company_id=$10"}`,
      [input.requestLineId, input.supplierId, input.quotationReference, input.quotationDate, input.unitPrice, input.deliveryCharge,
        input.minimumOrderQuantity ?? null, input.leadTimeDays ?? null, input.validUntil || null, ...(actor.isOwner ? [] : [actor.companyId])]);
    if (!result.rowCount) throw new Error("Request line or supplier not found.");
  });
}

export async function selectQuotation(id: string, reason: string, actor: OperationActor) {
  if (!reason.trim()) throw new Error("Explain why this quotation was selected.");
  if (isDemoMode()) {
    const ops = getDemoOperations();
    const selected = ops.quotations.find((item) => item.id === id);
    if (!selected) throw new Error("Quotation not found.");
    ops.quotations.forEach((item) => { if (item.requestLineId === selected.requestLineId) item.selected = item.id === id; });
    selected.status = "Selected"; selected.selectionReason = reason;
    const line = getDemoStore().requests.flatMap((request) => request.lines).find((item) => item.id === selected.requestLineId);
    if (line) { line.supplierId = selected.supplierId; line.supplierName = selected.supplierName; line.quotationReference = selected.quotationReference; line.unitBuyPrice = selected.unitPrice; line.deliveryCharge = selected.deliveryCharge; line.supplierConfirmationStatus = "Confirmed"; }
    addDemoAudit("quotations", id, "SELECT", actor.name, reason);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason }, async (client) => {
    const quotation = await client.query<{ requestLineId: string; supplierId: string; reference: string; unitPrice: number; deliveryCharge: number }>(
      `SELECT q.request_line_id::text AS "requestLineId",q.supplier_id::text AS "supplierId",COALESCE(q.quotation_reference,'') AS reference,q.unit_price::float8 AS "unitPrice",q.delivery_charge::float8 AS "deliveryCharge"
       FROM quotations q JOIN request_lines l ON l.id=q.request_line_id JOIN requests r ON r.id=l.request_id JOIN lookup_values rs ON rs.id=r.status_id
       WHERE q.id=$1 AND rs.label='Waiting for Quotation'${actor.isOwner ? "" : " AND r.company_id=$2"} FOR UPDATE`, actor.isOwner ? [id] : [id, actor.companyId]);
    if (!quotation.rows[0]) throw new Error("Quotation not found.");
    const q = quotation.rows[0];
    await client.query("UPDATE quotations SET selected=false,status_id=lookup_id('quotation_status','Rejected') WHERE request_line_id=$1 AND id<>$2", [q.requestLineId, id]);
    await client.query("UPDATE quotations SET selected=true,status_id=lookup_id('quotation_status','Selected'),selection_reason=$2 WHERE id=$1", [id, reason]);
    await client.query(`UPDATE request_lines SET selected_supplier_id=$2,quotation_reference=$3,unit_buy_price=$4,delivery_charge=$5,
      supplier_confirmation_status_id=lookup_id('supplier_confirmation','Confirmed') WHERE id=$1`, [q.requestLineId, q.supplierId, q.reference, q.unitPrice, q.deliveryCharge]);
  });
}

export async function listApprovals(): Promise<ApprovalRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().approvals;
  const result = await query<ApprovalRecord>(`SELECT a.id::text,a.request_id::text AS "requestId",r.order_code AS "orderCode",c.name AS "companyName",
    a.approval_type AS "approvalType",a.status,u.display_name AS "reviewerName",a.reason,a.decided_at::text AS "decidedAt",a.created_at::text AS "createdAt"
    FROM approvals a JOIN requests r ON r.id=a.request_id JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=a.reviewer_id
    ${actor.isOwner ? "" : "WHERE r.company_id=$1"} ORDER BY a.created_at DESC`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export async function recordApproval(input: { requestId: string; approvalType: string; status: ApprovalRecord["status"]; reason?: string }, actor: OperationActor) {
  if (input.status === "Rejected" && !input.reason?.trim()) throw new Error("A rejection reason is required.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    if (!request) throw new Error("Request not found.");
    getDemoOperations().approvals.unshift({ id: randomUUID(), requestId: request.id, orderCode: request.orderCode, companyName: request.companyName,
      approvalType: input.approvalType, status: input.status, reviewerName: actor.name, reason: input.reason,
      decidedAt: input.status === "Pending" ? undefined : new Date().toISOString(), createdAt: new Date().toISOString() });
    addDemoAudit("approvals", request.id, "INSERT", actor.name, input.reason);
    return;
  }
  await withAuditTransaction({ userId: actor.id, reason: input.reason }, async (client) => {
    const result = await client.query(`INSERT INTO approvals
      (request_id,approval_type,status,reviewer_id,reason,decided_at)
      SELECT $1,$2,$3,$4,$5,CASE WHEN $3='Pending' THEN NULL ELSE now() END FROM requests r JOIN lookup_values rs ON rs.id=r.status_id
      WHERE r.id=$1 AND rs.label='Waiting for Approval'${actor.isOwner ? "" : " AND r.company_id=$6"}`,
      [input.requestId, input.approvalType, input.status, actor.id, input.reason ?? null, ...(actor.isOwner ? [] : [actor.companyId])]);
    if (!result.rowCount) throw new Error("Request not found.");
  });
}

export async function listDeliveries(): Promise<DeliveryRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().deliveries;
  const result = await query<DeliveryRecord>(`SELECT d.id::text,d.request_line_id::text AS "requestLineId",l.request_line_code AS "requestLineCode",r.order_code AS "orderCode",
    c.name AS "companyName",l.product_name_snapshot AS "productName",d.expected_date::text AS "expectedDate",d.revised_date::text AS "revisedDate",
    d.actual_date::text AS "actualDate",st.label AS status,d.quantity_received::float8 AS "quantityReceived",d.received_by AS "receivedBy",
    d.issue_reason AS "issueReason",d.created_at::text AS "createdAt"
    FROM deliveries d JOIN request_lines l ON l.id=d.request_line_id JOIN requests r ON r.id=l.request_id JOIN companies c ON c.id=r.company_id
    JOIN lookup_values st ON st.id=d.status_id ${actor.isOwner ? "" : "WHERE r.company_id=$1"} ORDER BY d.created_at DESC`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export async function recordDelivery(input: { requestLineId: string; expectedDate?: string; revisedDate?: string; actualDate?: string; status: DeliveryStatus; quantityReceived: number; receivedBy?: string; issueReason?: string }, actor: OperationActor) {
  if (["Delayed", "Failed", "Cancelled"].includes(input.status) && !input.issueReason?.trim()) throw new Error("An issue reason is required for this delivery status.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === input.requestLineId));
    const line = request?.lines.find((item) => item.id === input.requestLineId);
    if (!request || !line) throw new Error("Request line not found.");
    const alreadyReceived = getDemoOperations().deliveries.filter((item) => item.requestLineId === line.id).reduce((sum, item) => sum + item.quantityReceived, 0);
    if (alreadyReceived + input.quantityReceived > line.quantity) throw new Error("Received quantity cannot exceed the ordered quantity.");
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
      ${actor.isOwner ? "" : "AND r.company_id=$2"} FOR UPDATE`, actor.isOwner ? [input.requestLineId] : [input.requestLineId, actor.companyId]);
    if (!line.rows[0]) throw new Error("Request line not found.");
    const received = await client.query<{ total: number }>("SELECT COALESCE(sum(quantity_received),0)::float8 AS total FROM deliveries WHERE request_line_id=$1", [input.requestLineId]);
    if (received.rows[0].total + input.quantityReceived > line.rows[0].quantity) throw new Error("Received quantity cannot exceed the ordered quantity.");
    await client.query(`INSERT INTO deliveries (request_line_id,expected_date,revised_date,actual_date,status_id,quantity_received,received_by,issue_reason)
      VALUES ($1,$2,$3,$4,lookup_id('delivery_status',$5),$6,$7,$8)`, [input.requestLineId, input.expectedDate || null, input.revisedDate || null,
        input.actualDate || null, input.status, input.quantityReceived, input.receivedBy || null, input.issueReason || null]);
  });
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().invoices;
  const result = await query<InvoiceRecord>(`SELECT b.id::text,b.direction,b.request_id::text AS "requestId",r.order_code AS "orderCode",
    CASE WHEN b.direction='CUSTOMER' THEN c.name ELSE s.name END AS counterparty,b.invoice_number AS "invoiceNumber",b.invoice_date::text AS "invoiceDate",
    b.due_date::text AS "dueDate",b.amount::float8,b.status::text,b.paid_amount::float8 AS "paidAmount",b.outstanding_amount::float8 AS "outstandingAmount",
    CASE WHEN b.payment_status='Void' THEN 'Void' ELSE b.payment_status END AS "paymentStatus"
    FROM (SELECT v.*,lv.label AS status FROM v_invoice_balances v JOIN lookup_values lv ON lv.id=v.status_id) b
    JOIN requests r ON r.id=b.request_id LEFT JOIN companies c ON c.id=b.company_id LEFT JOIN suppliers s ON s.id=b.supplier_id
    ${actor.isOwner ? "" : "WHERE r.company_id=$1"} ORDER BY b.invoice_date DESC,b.invoice_number`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export async function createInvoice(input: { direction: "CUSTOMER" | "SUPPLIER"; requestId: string; supplierId?: string; invoiceNumber: string; invoiceDate: string; dueDate?: string; amount: number; status: InvoiceStatus }, actor: OperationActor) {
  if (input.direction === "SUPPLIER" && !input.supplierId) throw new Error("Select the supplier for a supplier invoice.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    const supplier = getDemoStore().suppliers.find((item) => item.id === input.supplierId);
    if (!request) throw new Error("Request not found.");
    getDemoOperations().invoices.unshift({ id: randomUUID(), direction: input.direction, requestId: request.id, orderCode: request.orderCode,
      counterparty: input.direction === "CUSTOMER" ? request.companyName : supplier?.name ?? "Unknown supplier", invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate, dueDate: input.dueDate, amount: input.amount, status: input.status, paidAmount: 0, outstandingAmount: input.amount, paymentStatus: "Unpaid" });
    addDemoAudit("invoices", request.id, "INSERT", actor.name, input.invoiceNumber);
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const request = await client.query<{ companyId: string }>(`SELECT r.company_id::text AS "companyId" FROM requests r JOIN lookup_values rs ON rs.id=r.status_id
      WHERE r.id=$1 AND rs.label NOT IN ('New Request','Cancelled','Completed')${actor.isOwner ? "" : " AND r.company_id=$2"}`, actor.isOwner ? [input.requestId] : [input.requestId, actor.companyId]);
    if (!request.rows[0]) throw new Error("Request not found.");
    if (input.supplierId) {
      const supplier = await client.query("SELECT 1 FROM suppliers WHERE id=$1 AND company_id=$2", [input.supplierId, request.rows[0].companyId]);
      if (!supplier.rowCount) throw new Error("Supplier not found.");
    }
    await client.query(`INSERT INTO invoices (direction,request_id,company_id,supplier_id,invoice_number,invoice_date,due_date,amount,status_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,lookup_id('invoice_status',$9))`, [input.direction, input.requestId,
        input.direction === "CUSTOMER" ? request.rows[0].companyId : null, input.direction === "SUPPLIER" ? input.supplierId : null,
        input.invoiceNumber, input.invoiceDate, input.dueDate || null, input.amount, input.status]);
  });
}

export async function listPayments(): Promise<PaymentRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().payments;
  const result = await query<PaymentRecord>(`SELECT p.id::text,p.invoice_id::text AS "invoiceId",i.invoice_number AS "invoiceNumber",p.payment_date::text AS "paymentDate",
    p.amount::float8,p.method,p.reference,u.display_name AS "recordedByName" FROM payments p JOIN invoices i ON i.id=p.invoice_id
    JOIN requests r ON r.id=i.request_id LEFT JOIN users u ON u.id=p.recorded_by
    ${actor.isOwner ? "" : "WHERE r.company_id=$1"} ORDER BY p.payment_date DESC,p.created_at DESC`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export async function recordPayment(input: { invoiceId: string; paymentDate: string; amount: number; method: string; reference?: string }, actor: OperationActor) {
  if (input.method !== COD_PAYMENT_METHOD) throw new Error(`Only ${COD_PAYMENT_METHOD} is currently supported.`);
  if (isDemoMode()) {
    const invoice = getDemoOperations().invoices.find((item) => item.id === input.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (input.amount > invoice.outstandingAmount) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    getDemoOperations().payments.unshift({ id: randomUUID(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentDate: input.paymentDate,
      amount: input.amount, method: COD_PAYMENT_METHOD, reference: input.reference, recordedByName: actor.name });
    invoice.paidAmount += input.amount; invoice.outstandingAmount -= input.amount; invoice.paymentStatus = invoice.outstandingAmount === 0 ? "Paid" : "Partial";
    addDemoAudit("payments", invoice.id, "INSERT", actor.name, input.reference);
    return;
  }
  await withAuditTransaction({ userId: actor.id }, async (client) => {
    const invoice = await client.query<{ amount: number }>(`SELECT i.amount::float8 AS amount FROM invoices i JOIN requests r ON r.id=i.request_id
      WHERE i.id=$1${actor.isOwner ? "" : " AND r.company_id=$2"} FOR UPDATE`, actor.isOwner ? [input.invoiceId] : [input.invoiceId, actor.companyId]);
    if (!invoice.rows[0]) throw new Error("Invoice not found.");
    const paid = await client.query<{ total: number }>("SELECT COALESCE(sum(amount),0)::float8 AS total FROM payments WHERE invoice_id=$1", [input.invoiceId]);
    if (input.amount > invoice.rows[0].amount - paid.rows[0].total) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    await client.query("INSERT INTO payments (invoice_id,payment_date,amount,method,reference,recorded_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [input.invoiceId, input.paymentDate, input.amount, COD_PAYMENT_METHOD, input.reference ?? null, actor.id]);
  });
}

export async function listAuditRecords(): Promise<AuditRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().audit;
  const result = await query<AuditRecord>(`SELECT a.id::text,a.entity_type AS "entityType",a.record_id::text AS "recordId",a.action,
    u.display_name AS "actorName",a.reason,a.occurred_at::text AS "occurredAt" FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
    ${actor.isOwner ? "" : "WHERE a.company_id=$1"} ORDER BY a.occurred_at DESC LIMIT 500`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

export async function listAttachments(): Promise<AttachmentRecord[]> {
  const actor = await requireSession();
  if (isDemoMode()) return getDemoOperations().attachments;
  const result = await query<AttachmentRecord>(`SELECT a.id::text,a.entity_type AS "entityType",a.record_id::text AS "recordId",a.file_name AS "fileName",
    a.content_type AS "contentType",a.created_at::text AS "createdAt",u.display_name AS "uploadedByName" FROM attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by ${actor.isOwner ? "" : "WHERE a.company_id=$1"} ORDER BY a.created_at DESC`, actor.isOwner ? [] : [actor.companyId]);
  return result.rows;
}

const allowedUploadTypes = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);

export async function saveAttachment(input: { entityType: "request" | "invoice" | "delivery"; recordId: string; file: File }, actor: OperationActor) {
  if (!input.file.size || input.file.size > 2 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 2 MB.");
  if (!allowedUploadTypes.has(input.file.type)) throw new Error("Only PDF, PNG, JPG, TXT, and CSV files are allowed.");
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  if (isDemoMode()) {
    getDemoOperations().attachments.unshift({ id: randomUUID(), entityType: input.entityType, recordId: input.recordId, fileName: safeName,
      contentType: input.file.type, createdAt: new Date().toISOString(), uploadedByName: actor.name });
    addDemoAudit("attachments", input.recordId, "INSERT", actor.name, safeName);
    return;
  }
  const companyLookup = input.entityType === "request"
    ? "SELECT company_id::text AS id FROM requests WHERE id=$1"
    : input.entityType === "invoice"
      ? "SELECT r.company_id::text AS id FROM invoices i JOIN requests r ON r.id=i.request_id WHERE i.id=$1"
      : "SELECT r.company_id::text AS id FROM deliveries d JOIN request_lines l ON l.id=d.request_line_id JOIN requests r ON r.id=l.request_id WHERE d.id=$1";
  const companyResult = await query<{ id: string }>(companyLookup, [input.recordId]);
  const companyId = companyResult.rows[0]?.id;
  if (!companyId || (!actor.isOwner && companyId !== actor.companyId)) throw new Error("Linked record not found.");
  const id = randomUUID();
  const relativePath = path.posix.join(input.entityType, `${id}-${safeName}`);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  await withAuditTransaction({ userId: actor.id }, (client) => client.query(`INSERT INTO attachments
    (id,entity_type,record_id,file_name,content_type,storage_path,uploaded_by,company_id,file_content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, input.entityType, input.recordId, safeName, input.file.type, relativePath, actor.id, companyId, bytes]));
}

export async function loadAttachmentFile(id: string) {
  const actor = await requireSession();
  if (isDemoMode()) return null;
  const result = await query<{ fileName: string; contentType: string; storagePath: string; fileContent?: Buffer }>(`SELECT file_name AS "fileName",content_type AS "contentType",storage_path AS "storagePath",file_content AS "fileContent"
    FROM attachments WHERE id=$1${actor.isOwner ? "" : " AND company_id=$2"}`, actor.isOwner ? [id] : [id, actor.companyId]);
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

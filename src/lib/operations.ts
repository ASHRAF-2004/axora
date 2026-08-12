import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDemoStore } from "./demo-data";
import { addDemoAudit, getDemoOperations } from "./demo-operations";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { requirePermission } from "./auth";
import type { SessionUser } from "./auth";
import { canAccess, type Permission } from "./permissions";
import { INTERNAL_PAYMENT_STRATEGY } from "./types";
import type { ApprovalRecord, AttachmentRecord, AuditRecord, DeliveryRecord, DeliveryStatus, InvoiceRecord, InvoiceStatus, PaymentRecord, QuotationRecord, UserRole } from "./types";
import { appendWorkflowEvent, notifyWorkflowAudience } from "./workflow-repository";
import { uploadedContentMatchesMime } from "./file-content";
import {
  auditRecordMatchesFilters,
  normalizeAuditRecordFilters,
  type AuditRecordFilters,
} from "./audit-filters";

interface OperationActor {
  id: string;
  name: string;
  role?: UserRole;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  accountKind?: SessionUser["accountKind"];
  scopeType?: SessionUser["scopeType"];
  isOwner?: boolean;
}

function operationActorCanAccess(actor: OperationActor, permission: Permission) {
  return Boolean(
    actor.role
    && canAccess({
      role: actor.role,
      isOwner: Boolean(actor.isOwner),
      accountKind: actor.accountKind,
      scopeType: actor.scopeType,
      companyId: actor.companyId,
      branchId: actor.branchId,
      supplierId: actor.supplierId,
    }, permission),
  );
}

function isPlatformOperationsActor(actor: OperationActor) {
  return (Boolean(actor.isOwner) && ["ADMIN", "PLATFORM_OWNER"].includes(actor.role ?? ""))
    || (actor.accountKind === "PLATFORM"
    && actor.scopeType === "PLATFORM"
    && ["PLATFORM_OWNER", "PLATFORM_OPERATIONS"].includes(actor.role ?? ""));
}

function isPlatformScopedActor(actor: OperationActor) {
  return isPlatformOperationsActor(actor)
    || (actor.accountKind === "PLATFORM" && actor.scopeType === "PLATFORM");
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
  if (actor.isOwner || isPlatformOperationsActor(actor)) return { where: "", values: [] as unknown[] };
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
  return isPlatformOperationsActor(actor) || (
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

export interface SupplierRfqActivityRecord {
  id: string;
  reference: string;
  requestLineId: string;
  requestLineCode: string;
  orderCode: string;
  productName: string;
  supplierName: string;
  status: string;
  respondBy?: string;
  issuedAt: string;
  responseCount: number;
}

export async function listSupplierRfqs(actor: OperationActor): Promise<SupplierRfqActivityRecord[]> {
  if (!operationActorCanAccess(actor, "manage_sourcing")) {
    throw new Error("Only authorized Axora operations users can view supplier quotation requests.");
  }
  if (isDemoMode()) return [];
  return withAuditTransaction({ actor, reason: "Viewed supplier RFQ activity" }, async (client) => {
    const result = await client.query<SupplierRfqActivityRecord>(`
      SELECT rfq.id::text,rfq.rfq_reference AS reference,
        rfq.request_line_id::text AS "requestLineId",line.request_line_code AS "requestLineCode",
        request.order_code AS "orderCode",line.product_name_snapshot AS "productName",
        supplier.name AS "supplierName",rfq.status,rfq.respond_by::text AS "respondBy",
        rfq.issued_at::text AS "issuedAt",count(response.id)::int AS "responseCount"
      FROM supplier_rfqs rfq
      JOIN request_lines line ON line.id=rfq.request_line_id
      JOIN requests request ON request.id=line.request_id AND request.company_id=rfq.company_id
      JOIN suppliers supplier ON supplier.id=rfq.supplier_id
      LEFT JOIN supplier_quotation_responses response ON response.rfq_id=rfq.id
      GROUP BY rfq.id,line.request_line_code,request.order_code,line.product_name_snapshot,supplier.name
      ORDER BY rfq.issued_at DESC
    `);
    return result.rows;
  });
}

export interface NewSupplierRfqInput {
  requestLineId: string;
  supplierId: string;
  reference: string;
  respondBy: string;
  specification?: string;
  idempotencyKey: string;
}

export async function issueSupplierRfq(input: NewSupplierRfqInput, actor: OperationActor) {
  if (!operationActorCanAccess(actor, "manage_sourcing") || !isPlatformOperationsActor(actor)) {
    throw new Error("Only authorized Axora operations users can issue supplier quotation requests.");
  }
  const reference = input.reference.trim();
  const specification = input.specification?.trim();
  const respondBy = new Date(input.respondBy);
  if (reference.length < 3 || reference.length > 80) throw new Error("RFQ reference is invalid.");
  if (specification && specification.length > 2_000) throw new Error("RFQ specification is too long.");
  if (Number.isNaN(respondBy.getTime()) || respondBy.getTime() <= Date.now()) {
    throw new Error("RFQ response deadline must be in the future.");
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200
    || /[\u0000-\u001f\u007f]/.test(input.idempotencyKey)) {
    throw new Error("RFQ submission identifier is invalid.");
  }
  if (isDemoMode()) throw new Error("Supplier RFQs require the production database.");
  return withAuditTransaction({ actor, reason: `Issued supplier RFQ ${reference}` }, async (client) => {
    const context = await client.query<{
      requestId: string;
      companyId: string;
      branchId: string;
      requestLineId: string;
      supplierId: string;
    }>(`
      SELECT request.id::text AS "requestId",request.company_id::text AS "companyId",
        request.branch_id::text AS "branchId",line.id::text AS "requestLineId",
        supplier.id::text AS "supplierId"
      FROM request_lines line
      JOIN requests request ON request.id=line.request_id
      JOIN lookup_values request_status ON request_status.id=request.status_id
      JOIN suppliers supplier ON supplier.id=$2
      WHERE line.id=$1 AND request_status.label='Waiting for Quotation'
        AND line.selected_supplier_id IS NULL
        AND supplier.active=true AND supplier.company_id IS NULL
        AND EXISTS (
          SELECT 1 FROM approvals approval
          WHERE approval.request_id=request.id AND approval.approval_type='Company approval'
            AND approval.status='Approved'
        )
      FOR UPDATE OF line,request,supplier
    `, [input.requestLineId, input.supplierId]);
    const eligible = context.rows[0];
    if (!eligible) throw new Error("Select an approved request line and active Axora supplier.");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`supplier-rfq:${eligible.companyId}:${eligible.requestLineId}:${eligible.supplierId}`],
    );
    const nextRound = await client.query<{ value: number }>(`
      SELECT (COALESCE(max(round_number),0)+1)::int AS value
      FROM supplier_rfqs WHERE request_line_id=$1 AND supplier_id=$2
    `, [eligible.requestLineId, eligible.supplierId]);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO supplier_rfqs(
        company_id,request_line_id,supplier_id,round_number,rfq_reference,status,
        respond_by,requirements,issued_by,idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,'ISSUED',$6,$7::jsonb,$8,$9)
      ON CONFLICT(company_id,idempotency_key) DO NOTHING
      RETURNING id::text
    `, [eligible.companyId,eligible.requestLineId,eligible.supplierId,nextRound.rows[0]?.value ?? 1,
      reference,respondBy.toISOString(),JSON.stringify(specification ? { specification } : {}),actor.id,input.idempotencyKey]);
    let rfqId = inserted.rows[0]?.id;
    if (!rfqId) {
      const existing = await client.query<{ id: string; requestLineId: string; supplierId: string }>(`
        SELECT id::text,request_line_id::text AS "requestLineId",supplier_id::text AS "supplierId"
        FROM supplier_rfqs WHERE company_id=$1 AND idempotency_key=$2
      `, [eligible.companyId, input.idempotencyKey]);
      if (!existing.rows[0]
        || existing.rows[0].requestLineId !== eligible.requestLineId
        || existing.rows[0].supplierId !== eligible.supplierId) {
        throw new Error("That RFQ submission identifier was already used for different data.");
      }
      rfqId = existing.rows[0].id;
    }
    const event = await appendWorkflowEvent(client, {
      companyId: eligible.companyId,
      branchId: eligible.branchId,
      requestId: eligible.requestId,
      aggregateType: "supplier-rfq",
      aggregateId: rfqId,
      eventKey: "quotation.requested",
      stableKey: input.idempotencyKey,
      actor: actor as SessionUser,
      newState: "Quotation requested",
      source: "WEB",
      metadata: { requestLineId: eligible.requestLineId },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: { key: "quotation_requested" },
      routePath: `/requests/${eligible.requestId}`,
    });
    return rfqId;
  });
}

export interface NewQuotationInput { requestLineId: string; supplierId: string; quotationReference: string; quotationDate: string; unitPrice: number; deliveryCharge: number; minimumOrderQuantity?: number; leadTimeDays?: number; validUntil?: string; }

export async function createQuotation(input: NewQuotationInput, actor: OperationActor) {
  if (!operationActorCanAccess(actor, "manage_sourcing")) throw new Error("Only authorized Axora operations users can manage supplier quotations.");
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
  await withAuditTransaction({ actor }, async (client) => {
    const result = await client.query<{ id: string }>(`INSERT INTO quotations
      (request_line_id,supplier_id,quotation_reference,quotation_date,unit_price,delivery_charge,minimum_order_quantity,lead_time_days,valid_until,status_id)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,lookup_id('quotation_status','Received')
      FROM request_lines l JOIN requests r ON r.id=l.request_id JOIN suppliers s ON s.id=$2 JOIN lookup_values rs ON rs.id=r.status_id
      WHERE l.id=$1 AND s.active=true AND s.company_id IS NULL AND rs.label='Waiting for Quotation'
        AND EXISTS (
          SELECT 1 FROM approvals a
          WHERE a.request_id=r.id AND a.approval_type='Company approval' AND a.status='Approved'
        ) RETURNING id::text`,
      [input.requestLineId, input.supplierId, input.quotationReference, input.quotationDate, input.unitPrice, input.deliveryCharge,
        input.minimumOrderQuantity ?? null, input.leadTimeDays ?? null, input.validUntil || null]);
    if (!result.rowCount) throw new Error("Request line or supplier not found.");
    const context = await client.query<{ requestId: string; companyId: string; branchId: string }>(`
      SELECT request.id::text AS "requestId",request.company_id::text AS "companyId",
        request.branch_id::text AS "branchId"
      FROM request_lines line JOIN requests request ON request.id=line.request_id
      WHERE line.id=$1
    `, [input.requestLineId]);
    const linked = context.rows[0];
    if (!linked) throw new Error("Request line or supplier not found.");
    const event = await appendWorkflowEvent(client, {
      companyId: linked.companyId,
      branchId: linked.branchId,
      requestId: linked.requestId,
      aggregateType: "request",
      aggregateId: linked.requestId,
      eventKey: "quotation.received",
      stableKey: result.rows[0].id,
      actor: actor as SessionUser,
      newState: "Quotation received",
      source: "WEB",
      metadata: { requestLineId: input.requestLineId },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: { key: "quotation_received" },
      routePath: `/requests/${linked.requestId}`,
    });
  });
}

export async function selectQuotation(id: string, reason: string, actor: OperationActor) {
  if (!operationActorCanAccess(actor, "manage_sourcing")) throw new Error("Only authorized Axora operations users can select supplier quotations.");
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
  await withAuditTransaction({ actor, reason: "Axora supplier quotation selected" }, async (client) => {
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
      requestId: string;
      companyId: string;
      branchId: string;
    }>(
      `SELECT q.request_line_id::text AS "requestLineId",q.supplier_id::text AS "supplierId",
         COALESCE(q.quotation_reference,'') AS reference,q.unit_price::float8 AS "unitPrice",
         q.delivery_charge::float8 AS "deliveryCharge",l.quantity::float8 AS "lineQuantity",
         q.minimum_order_quantity::float8 AS "minimumOrderQuantity",q.valid_until::text AS "validUntil",
         s.active AS "supplierActive",r.id::text AS "requestId",
         r.company_id::text AS "companyId",r.branch_id::text AS "branchId"
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
    const selectedRfq = await client.query<{ id: string }>(`
      SELECT id::text FROM supplier_rfqs
      WHERE request_line_id=$1 AND supplier_id=$2
      ORDER BY round_number DESC,issued_at DESC LIMIT 1
    `, [q.requestLineId, q.supplierId]);
    await client.query(`
      UPDATE supplier_rfqs
      SET status='CLOSED',closed_at=now()
      WHERE request_line_id=$1 AND status NOT IN ('WITHDRAWN','EXPIRED','CLOSED')
    `, [q.requestLineId]);
    const event = await appendWorkflowEvent(client, {
      companyId: q.companyId,
      branchId: q.branchId,
      requestId: q.requestId,
      aggregateType: "request",
      aggregateId: q.requestId,
      eventKey: "supplier.selected",
      stableKey: id,
      actor: actor as SessionUser,
      newState: "Supplier selected",
      reason,
      source: "WEB",
      // Supplier identity and internal pricing deliberately stay out of the
      // tenant-visible workflow metadata.
      metadata: { requestLineId: q.requestLineId },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: { key: "supplier_selected" },
      routePath: `/requests/${q.requestId}`,
    });
    if (selectedRfq.rows[0]) {
      await appendWorkflowEvent(client, {
        companyId: q.companyId,
        branchId: q.branchId,
        requestId: q.requestId,
        aggregateType: "supplier-rfq",
        aggregateId: selectedRfq.rows[0].id,
        eventKey: "supplier.order_selected",
        stableKey: id,
        actor: actor as SessionUser,
        newState: "Supplier order selected",
        source: "WEB",
        metadata: { requestLineId: q.requestLineId },
      });
    }
  });
}

export async function listApprovals(): Promise<ApprovalRecord[]> {
  const actor = await requirePermission("view_approvals");
  if (isDemoMode()) return getDemoOperations().approvals;
  const result = await query<ApprovalRecord>(`SELECT a.id::text,a.request_id::text AS "requestId",r.order_code AS "orderCode",c.name AS "companyName",
    a.approval_type AS "approvalType",a.status,u.display_name AS "reviewerName",a.reason,a.decided_at::text AS "decidedAt",a.created_at::text AS "createdAt"
    FROM approvals a JOIN requests r ON r.id=a.request_id JOIN companies c ON c.id=r.company_id LEFT JOIN users u ON u.id=a.reviewer_id
    ${isPlatformOperationsActor(actor) ? "" : actor.branchId ? "WHERE r.company_id=$1 AND r.branch_id=$2" : "WHERE r.company_id=$1"}
    ORDER BY a.created_at DESC`, isPlatformOperationsActor(actor) ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId]);
  return result.rows;
}

export async function recordApproval(input: { requestId: string; approvalType: string; status: ApprovalRecord["status"]; reason?: string }, actor: OperationActor) {
  if (input.status === "Rejected" && !input.reason?.trim()) throw new Error("A rejection reason is required.");
  if (input.status === "Pending") throw new Error("Choose Approve or Reject.");
  if (actor.isOwner || !actor.companyId || !operationActorCanAccess(actor, "approve_requests")) {
    throw new Error("Only an assigned company approver can decide this request.");
  }
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    if (!request) throw new Error("Request not found.");
    if (request.companyId !== actor.companyId
      || (actor.branchId && request.branchId !== actor.branchId)) {
      throw new Error("This request is not pending approval for your branch.");
    }
    if (request.createdById === actor.id) {
      throw new Error("You cannot approve your own purchase request.");
    }
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
  await withAuditTransaction({ actor, reason: input.reason }, async (client) => {
    const request = await client.query<{
      createdBy?: string;
      companyId: string;
      branchId: string;
      monthlyBudget?: number;
      estimatedTotal: number;
    }>(`SELECT r.created_by::text AS "createdBy",r.company_id::text AS "companyId",
        r.branch_id::text AS "branchId",
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
    const event = await appendWorkflowEvent(client, {
      companyId: current.companyId,
      branchId: current.branchId,
      requestId: input.requestId,
      aggregateType: "request",
      aggregateId: input.requestId,
      eventKey: input.status === "Approved" ? "request.approved" : "request.rejected",
      stableKey: `${input.status}:${actor.id}`,
      actor: actor as SessionUser,
      previousState: "Pending approval",
      newState: input.status,
      reason: input.reason,
      source: "WEB",
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: input.status === "Approved"
        ? ["REQUEST_CREATOR", "PLATFORM_OPERATIONS"]
        : ["REQUEST_CREATOR"],
      message: input.status === "Approved"
        ? { key: "request_approved" }
        : { key: "request_rejected" },
      routePath: `/requests/${input.requestId}`,
      priority: input.status === "Rejected" ? "HIGH" : "NORMAL",
    });
  });
}

export async function listDeliveries(): Promise<DeliveryRecord[]> {
  const actor = await requirePermission("view_deliveries");
  if (isDemoMode()) {
    if (isPlatformOperationsActor(actor)) return getDemoOperations().deliveries;
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
  if (!operationActorCanAccess(actor, "manage_deliveries")) throw new Error("Only authorized Axora operations users can record delivery updates.");
  if (["Partially Delivered", "Delivered"].includes(input.status)) {
    throw new Error("Customer receipt must be confirmed independently in the receiving portal.");
  }
  if (!Number.isFinite(input.quantityReceived) || input.quantityReceived !== 0
    || input.actualDate || input.receivedBy?.trim()) {
    throw new Error("Logistics status updates cannot record customer receipt evidence.");
  }
  if (["Delayed", "Failed", "Cancelled"].includes(input.status) && !input.issueReason?.trim()) throw new Error("An issue reason is required for this delivery status.");
  if (isDemoMode()) {
    const request = getDemoStore().requests.find((item) => item.lines.some((line) => line.id === input.requestLineId));
    const line = request?.lines.find((item) => item.id === input.requestLineId);
    if (!request || !line) throw new Error("Request line not found.");
    getDemoOperations().deliveries.unshift({ id: randomUUID(), requestLineId: line.id, requestLineCode: line.code, orderCode: request.orderCode,
      companyName: request.companyName, productName: line.productName, expectedDate: input.expectedDate, revisedDate: input.revisedDate,
      status: input.status, quantityReceived: 0,
      issueReason: input.issueReason, createdAt: new Date().toISOString() });
    line.deliveryStatus = input.status;
    line.expectedDeliveryDate = input.revisedDate || input.expectedDate;
    addDemoAudit("deliveries", line.id, "INSERT", actor.name, input.issueReason);
    return;
  }
  await withAuditTransaction({ actor, reason: input.issueReason }, async (client) => {
    const line = await client.query<{ requestId: string; companyId: string; branchId: string }>(`SELECT
      r.id::text AS "requestId",r.company_id::text AS "companyId",r.branch_id::text AS "branchId"
      FROM request_lines l JOIN requests r ON r.id=l.request_id
      JOIN lookup_values rs ON rs.id=r.status_id WHERE l.id=$1 AND rs.label IN ('Ordered','Preparing for Delivery','Out for Delivery')
      FOR UPDATE`, [input.requestLineId]);
    if (!line.rows[0]) throw new Error("Request line not found.");
    const inserted = await client.query<{ id: string }>(`INSERT INTO deliveries (request_line_id,expected_date,revised_date,actual_date,status_id,quantity_received,received_by,issue_reason)
      VALUES ($1,$2,$3,NULL,lookup_id('delivery_status',$4),0,NULL,$5) RETURNING id::text`, [input.requestLineId, input.expectedDate || null, input.revisedDate || null,
        input.status, input.issueReason || null]);
    const eventKey = input.status === "Scheduled" ? "delivery.scheduled"
      : input.status === "Out for Delivery" ? "delivery.out_for_delivery"
        : input.status === "Delayed" ? "delivery.delayed"
          : input.status === "Failed" ? "delivery.failed"
            : "delivery.status_changed";
    const event = await appendWorkflowEvent(client, {
      companyId: line.rows[0].companyId,
      branchId: line.rows[0].branchId,
      requestId: line.rows[0].requestId,
      aggregateType: "request",
      aggregateId: line.rows[0].requestId,
      eventKey,
      stableKey: inserted.rows[0].id,
      actor: actor as SessionUser,
      newState: input.status,
      reason: input.issueReason,
      source: "WEB",
      metadata: { requestLineId: input.requestLineId },
    });
    await notifyWorkflowAudience(client, event, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR"],
      message: { key: "delivery_status_updated", status: input.status },
      routePath: `/requests/${line.rows[0].requestId}`,
      priority: ["Delayed", "Failed"].includes(input.status) ? "HIGH" : "NORMAL",
    });
  });
}

export async function listInvoices(): Promise<InvoiceRecord[]> {
  const actor = await requirePermission("view_invoices");
  if (isDemoMode()) return isPlatformOperationsActor(actor)
    ? getDemoOperations().invoices
    : getDemoOperations().invoices.filter((invoice) => invoice.direction === "CUSTOMER");
  const visibilityClause = isPlatformOperationsActor(actor)
    ? ""
    : actor.branchId
      ? "WHERE r.company_id=$1 AND r.branch_id=$2 AND b.direction='CUSTOMER'"
      : "WHERE r.company_id=$1 AND b.direction='CUSTOMER'";
  const visibilityParams = isPlatformOperationsActor(actor) ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId];
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
  if (!operationActorCanAccess(actor, "manage_finance")) throw new Error("Only authorized Axora finance users can create invoices.");
  if (input.direction !== "SUPPLIER") throw new Error("Customer invoices are finalized by checkout.");
  if (input.direction === "SUPPLIER" && !isPlatformScopedActor(actor)) {
    throw new Error("Supplier invoices are private Axora finance records.");
  }
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
    getDemoOperations().invoices.unshift({ id: randomUUID(), direction: input.direction, requestId: request.id, orderCode: request.orderCode,
      counterparty: supplier?.name ?? "Unknown supplier", invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate, dueDate: input.dueDate, amount: input.amount, status: "Issued", paidAmount: 0,
      outstandingAmount: input.amount, paymentStatus: "Unpaid", requestStatus: request.status });
    addDemoAudit("invoices", request.id, "INSERT", actor.name, input.invoiceNumber);
    return;
  }
  await withAuditTransaction({ actor }, async (client) => {
    const request = await client.query<{ companyId: string; branchId: string; status: string }>(
      `SELECT r.company_id::text AS "companyId",r.branch_id::text AS "branchId",rs.label AS status
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
             AND axora_received_quantity(line.id)<line.quantity
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
    await client.query(`INSERT INTO invoices (direction,request_id,company_id,supplier_id,invoice_number,invoice_date,due_date,amount,status_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,lookup_id('invoice_status',$9))`, [input.direction, input.requestId,
        null, input.supplierId,
        input.invoiceNumber, input.invoiceDate, input.dueDate || null, input.amount, input.status]);
  });
}

export async function listPayments(): Promise<PaymentRecord[]> {
  const actor = await requirePermission("view_invoices");
  if (isDemoMode()) {
    if (isPlatformOperationsActor(actor)) return getDemoOperations().payments;
    const customerInvoiceIds = new Set(getDemoOperations().invoices
      .filter((invoice) => invoice.direction === "CUSTOMER")
      .map((invoice) => invoice.id));
    return getDemoOperations().payments.filter((payment) => customerInvoiceIds.has(payment.invoiceId));
  }
  const visibilityClause = isPlatformOperationsActor(actor)
    ? ""
    : actor.branchId
      ? "WHERE r.company_id=$1 AND r.branch_id=$2 AND i.direction='CUSTOMER'"
      : "WHERE r.company_id=$1 AND i.direction='CUSTOMER'";
  const visibilityParams = isPlatformOperationsActor(actor) ? [] : actor.branchId ? [actor.companyId, actor.branchId] : [actor.companyId];
  const result = await query<PaymentRecord>(`SELECT p.id::text,p.invoice_id::text AS "invoiceId",i.invoice_number AS "invoiceNumber",p.payment_date::text AS "paymentDate",
    p.amount::float8,p.method,p.reference,u.display_name AS "recordedByName" FROM payments p JOIN invoices i ON i.id=p.invoice_id
    JOIN requests r ON r.id=i.request_id LEFT JOIN users u ON u.id=p.recorded_by
    ${visibilityClause} ORDER BY p.payment_date DESC,p.created_at DESC`, visibilityParams);
  return result.rows;
}

export async function recordPayment(input: { invoiceId: string; paymentDate: string; amount: number; method: string; reference?: string }, actor: OperationActor) {
  if (!operationActorCanAccess(actor, "manage_finance")) throw new Error("Only authorized Axora finance users can record payments.");
  if (input.method !== INTERNAL_PAYMENT_STRATEGY) throw new Error(`Only ${INTERNAL_PAYMENT_STRATEGY} is currently supported.`);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Enter a positive payment amount.");
  const reference = input.reference?.trim();
  if (!reference) throw new Error("Enter the numbered receipt or collection reference.");
  if (isDemoMode()) {
    const invoice = getDemoOperations().invoices.find((item) => item.id === input.invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (invoice.direction !== "SUPPLIER") throw new Error("The invoice is unavailable.");
    if (invoice.direction === "SUPPLIER" && !isPlatformScopedActor(actor)) {
      throw new Error("Supplier payments are private Axora finance records.");
    }
    const request = getDemoStore().requests.find((item) => item.id === invoice.requestId);
    if (invoice.status !== "Issued"
        || !request
        || !["Delivered", "Invoice Issued", "Completed"].includes(request.status)
        || request.lines.some((line) => line.quantityReceived < line.quantity)) {
      throw new Error("Record payment only against an issued invoice after delivery.");
    }
    if (input.amount > invoice.outstandingAmount) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    getDemoOperations().payments.unshift({ id: randomUUID(), invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, paymentDate: input.paymentDate,
      amount: input.amount, method: INTERNAL_PAYMENT_STRATEGY, reference, recordedByName: actor.name });
    invoice.paidAmount += input.amount; invoice.outstandingAmount -= input.amount; invoice.paymentStatus = invoice.outstandingAmount === 0 ? "Paid" : "Partial";
    addDemoAudit("payments", invoice.id, "INSERT", actor.name, reference);
    return;
  }
  await withAuditTransaction({ actor }, async (client) => {
    const invoice = await client.query<{ amount: number; direction: "CUSTOMER" | "SUPPLIER"; requestId: string; companyId: string; branchId: string }>(
      `SELECT i.amount::float8 AS amount,i.direction,
         r.id::text AS "requestId",r.company_id::text AS "companyId",
         r.branch_id::text AS "branchId"
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
             AND axora_received_quantity(line.id)<line.quantity
         )
       FOR UPDATE`,
      [input.invoiceId],
    );
    if (!invoice.rows[0]) throw new Error("Record payment only against an issued invoice after delivery.");
    if (invoice.rows[0].direction !== "SUPPLIER") throw new Error("The invoice is unavailable.");
    if (invoice.rows[0].direction === "SUPPLIER" && !isPlatformScopedActor(actor)) {
      throw new Error("Supplier payments are private Axora finance records.");
    }
    const paid = await client.query<{ total: number }>("SELECT COALESCE(sum(amount),0)::float8 AS total FROM payments WHERE invoice_id=$1", [input.invoiceId]);
    if (input.amount > invoice.rows[0].amount - paid.rows[0].total) throw new Error("Payment cannot exceed the outstanding invoice amount.");
    await client.query("INSERT INTO payments (invoice_id,payment_date,amount,method,reference,recorded_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [input.invoiceId, input.paymentDate, input.amount, INTERNAL_PAYMENT_STRATEGY, reference, actor.id]);
  });
}

export async function listAuditRecords(rawFilters: AuditRecordFilters = {}): Promise<AuditRecord[]> {
  const actor = await requirePermission("view_audit");
  const filters = normalizeAuditRecordFilters(rawFilters);
  if (isDemoMode()) {
    const visible = isPlatformScopedActor(actor)
      ? getDemoOperations().audit
      : getDemoOperations().audit.filter((item) => item.entityType !== "quotations");
    return visible.filter((item) => auditRecordMatchesFilters(item, filters));
  }
  return listScopedAuditRecords(actor, filters);
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
    if (isPlatformOperationsActor(actor)) return getDemoOperations().attachments;
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
  const visibilityParams: unknown[] = isPlatformOperationsActor(actor) ? [] : [actor.companyId];
  let linkedScope = "";
  if (!isPlatformOperationsActor(actor) && actor.branchId) {
    visibilityParams.push(actor.branchId);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.branch_id=$${visibilityParams.length}`);
  }
  if (!isPlatformOperationsActor(actor) && isSelfScopedRequester(actor)) {
    visibilityParams.push(actor.id);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.created_by=$${visibilityParams.length}`);
  }
  const visibilityClause = isPlatformOperationsActor(actor) ? "" : `WHERE a.company_id=$1 AND a.visibility='CUSTOMER'${linkedScope}`;
  const result = await query<AttachmentRecord>(`SELECT a.id::text,a.entity_type AS "entityType",a.record_id::text AS "recordId",a.file_name AS "fileName",
    a.content_type AS "contentType",a.visibility,a.created_at::text AS "createdAt",u.display_name AS "uploadedByName" FROM attachments a
    LEFT JOIN users u ON u.id=a.uploaded_by ${visibilityClause} ORDER BY a.created_at DESC`, visibilityParams);
  return isPlatformOperationsActor(actor) ? result.rows : result.rows.filter((attachment) => canViewAttachmentType(attachment.entityType));
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
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size || !uploadedContentMatchesMime(input.file.type, bytes)) {
    throw new Error("The file content does not match its declared type.");
  }
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  if (isDemoMode()) {
    const request = getDemoRequestForLinkedRecord(input.entityType, input.recordId);
    if (!request || !demoRequestVisibleToActor(request, actor)) {
      throw new Error("Linked record not found.");
    }
    const linkedInvoice = input.entityType === "invoice"
      ? getDemoOperations().invoices.find((item) => item.id === input.recordId)
      : undefined;
    if (!isPlatformOperationsActor(actor) && linkedInvoice?.direction === "SUPPLIER") {
      throw new Error("Supplier invoice documents are internal to Axora.");
    }
    const visibility = linkedInvoice?.direction === "SUPPLIER"
      ? "INTERNAL"
      : isPlatformOperationsActor(actor) ? input.visibility ?? "INTERNAL" : "CUSTOMER";
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
  if (!linked || (!isPlatformOperationsActor(actor) && (
    linked.companyId !== actor.companyId
    || (actor.branchId && linked.branchId !== actor.branchId)
    || (isSelfScopedRequester(actor) && linked.createdById !== actor.id)
  ))) throw new Error("Linked record not found.");
  if (!isPlatformOperationsActor(actor) && linked.invoiceDirection === "SUPPLIER") {
    throw new Error("Supplier invoice documents are internal to Axora.");
  }
  const id = randomUUID();
  const relativePath = path.posix.join(input.entityType, `${id}-${safeName}`);
  const visibility = linked.invoiceDirection === "SUPPLIER"
    ? "INTERNAL"
    : isPlatformOperationsActor(actor) ? input.visibility ?? "INTERNAL" : "CUSTOMER";
  await withAuditTransaction({ actor }, (client) => client.query(`INSERT INTO attachments
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
  const entityTypeScope = isPlatformOperationsActor(actor)
    ? ""
    : ` AND a.entity_type IN (${allowedEntityTypes.map((value) => `'${value}'`).join(",")})`;
  const visibilityParams: unknown[] = isPlatformOperationsActor(actor) ? [id] : [id, actor.companyId];
  let linkedScope = "";
  if (!isPlatformOperationsActor(actor) && actor.branchId) {
    visibilityParams.push(actor.branchId);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.branch_id=$${visibilityParams.length}`);
  }
  if (!isPlatformOperationsActor(actor) && isSelfScopedRequester(actor)) {
    visibilityParams.push(actor.id);
    linkedScope += attachmentLinkedRequestScope(`scoped_request.created_by=$${visibilityParams.length}`);
  }
  const visibilityClause = isPlatformOperationsActor(actor) ? "" : ` AND a.company_id=$2 AND a.visibility='CUSTOMER'${linkedScope}`;
  const result = await query<{ fileName: string; contentType: string; storagePath: string; fileContent?: Buffer }>(`SELECT file_name AS "fileName",content_type AS "contentType",storage_path AS "storagePath",file_content AS "fileContent"
    FROM attachments a WHERE a.id=$1${entityTypeScope}${visibilityClause}`, visibilityParams);
  const record = result.rows[0];
  if (!record) return null;
  if (record.fileContent) return { fileName: record.fileName, contentType: record.contentType, bytes: record.fileContent };
  const uploadRoot = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    "data",
    "uploads",
  );
  const source = path.resolve(/* turbopackIgnore: true */ uploadRoot, record.storagePath);
  if (!source.startsWith(`${uploadRoot}${path.sep}`)) throw new Error("Invalid stored attachment path.");
  try {
    return {
      fileName: record.fileName,
      contentType: record.contentType,
      bytes: await readFile(/* turbopackIgnore: true */ source),
    };
  } catch {
    return null;
  }
}
import { listScopedAuditRecords } from "@/lib/accountability-reader";

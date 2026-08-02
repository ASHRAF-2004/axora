import { createHash, randomUUID } from "node:crypto";
import type { SessionUser } from "./auth";
import {
  assertDriverEventTransition,
  buildDeliveryClientEvent,
  buildDriverEvidence,
  deliveryEventMetadata,
  resolveDeliveryDriverScope,
  validateDeliveryEventDetails,
  type DeliveryClientEventType,
  type DeliveryIssueCode,
  type DeliveryJobStatus,
  type DeliveryProgressStatus,
  type DriverReportedLineOutcome,
} from "./delivery-portal";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import { removePersistentUpload, readPersistentUpload, storePersistentUpload } from "./persistent-files";
import { calculateReceiptLine, receiptStatusFromLines } from "./receiving";
import {
  buildSupplierAcknowledgement,
  buildSupplierQuotation,
  decodeSupplierQuotationNote,
  encodeSupplierQuotationNote,
  resolveSupplierPortalScope,
  type SupplierAcknowledgement,
  type SupplierAvailability,
} from "./supplier-portal";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
  type WorkflowAudience,
} from "./workflow-repository";

function assertPermission(actor: SessionUser, permission: Parameters<typeof canAccess>[1]) {
  if (!canAccess(actor, permission)) throw new Error("Your account does not have permission to perform this action.");
}

export interface SupplierRfqWorkspaceItem {
  id: string;
  companyId: string;
  reference: string;
  status: string;
  respondBy?: string;
  productName: string;
  specification?: string;
  quantity: number;
  unit: string;
  orderCode: string;
  requestStatus: string;
  selected: boolean;
  responseVersion?: number;
  responseStatus?: string;
  quotationReference?: string;
  unitPrice?: number;
  deliveryCharge?: number;
  leadTimeDays?: number;
  validUntil?: string;
  availability?: SupplierAvailability;
  commercialNote?: string;
  acknowledgements: Array<{
    id: string;
    acknowledgement: SupplierAcknowledgement;
    note?: string;
    acknowledgedAt: string;
  }>;
  documents: Array<{
    id: string;
    fileName: string;
    documentKind: string;
    documentVersion: number;
    createdAt: string;
  }>;
}

export interface SupplierProfileSummary {
  code: string;
  name: string;
  category: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  coverageArea: string;
  paymentTerms: string;
  leadTimeDays: number;
  minimumOrderQuantity: number;
  mainProducts: string;
}

export interface SupplierInvoiceSummary {
  id: string;
  orderCode: string;
  invoiceNumber: string;
  invoiceDate: string;
  amount: number;
  status: string;
  paymentStatus: string;
  paidAmount: number;
  outstandingAmount: number;
}

export interface SupplierWorkspace {
  supplierName: string;
  profile?: SupplierProfileSummary;
  rfqs: SupplierRfqWorkspaceItem[];
  invoices: SupplierInvoiceSummary[];
}

async function activeSupplierScope(actor: SessionUser, client: import("pg").PoolClient) {
  if (actor.accountKind !== "SUPPLIER" || actor.role !== "SUPPLIER_USER" || !actor.supplierId) {
    throw new Error("An active supplier account is required.");
  }
  const membership = await client.query<{ id: string; userId: string; supplierId: string; status: "ACTIVE" }>(`
    SELECT id::text,user_id::text AS "userId",supplier_id::text AS "supplierId",status
    FROM supplier_memberships
    WHERE user_id=$1 AND supplier_id=$2 AND status='ACTIVE'
  `, [actor.id, actor.supplierId]);
  return resolveSupplierPortalScope(actor.id, actor.supplierId, membership.rows);
}

export async function getSupplierWorkspace(actor: SessionUser): Promise<SupplierWorkspace> {
  assertPermission(actor, "view_supplier_portal");
  if (isDemoMode()) return { supplierName: "Supplier workspace", rfqs: [], invoices: [] };
  return withAuditTransaction({ userId: actor.id, reason: "Viewed assigned supplier work" }, async (client) => {
    const scope = await activeSupplierScope(actor, client);
    const supplier = await client.query<SupplierProfileSummary>(`
      SELECT supplier_code AS code,name,category,contact_name AS "contactName",phone,email,address,
        coverage_area AS "coverageArea",payment_terms AS "paymentTerms",
        lead_time_days AS "leadTimeDays",minimum_order_quantity::float8 AS "minimumOrderQuantity",
        main_products AS "mainProducts"
      FROM suppliers WHERE id=$1 AND active=true
    `, [scope.supplierId]);
    const result = await client.query<SupplierRfqWorkspaceItem>(`
      SELECT rfq.id::text,rfq.company_id::text AS "companyId",rfq.rfq_reference AS reference,
        rfq.status,rfq.respond_by::text AS "respondBy",
        line.product_name_snapshot AS "productName",
        NULLIF(concat_ws(E'\n',NULLIF(line.specification,''),NULLIF(rfq.requirements->>'specification','')),'') AS specification,
        line.quantity::float8,line.unit_of_measure AS unit,
        request.order_code AS "orderCode",request_status.label AS "requestStatus",
        (line.selected_supplier_id=rfq.supplier_id) AS selected,
        latest.response_version AS "responseVersion",latest.response_status AS "responseStatus",
        latest.quotation_reference AS "quotationReference",latest.unit_price::float8 AS "unitPrice",
        latest.delivery_charge::float8 AS "deliveryCharge",latest.lead_time_days AS "leadTimeDays",
        latest.valid_until::text AS "validUntil",latest.note AS "commercialNote",
        COALESCE(acknowledgements.items,'[]'::jsonb) AS acknowledgements,
        COALESCE(documents.items,'[]'::jsonb) AS documents
      FROM supplier_rfqs rfq
      JOIN request_lines line ON line.id=rfq.request_line_id
      JOIN requests request ON request.id=line.request_id AND request.company_id=rfq.company_id
      JOIN lookup_values request_status ON request_status.id=request.status_id
      LEFT JOIN LATERAL (
        SELECT response_version,response_status,quotation_reference,unit_price,
          delivery_charge,lead_time_days,valid_until,note
        FROM supplier_quotation_responses response
        WHERE response.rfq_id=rfq.id
        ORDER BY response_version DESC LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id',acknowledgement.id::text,'acknowledgement',acknowledgement.acknowledgement,
          'note',acknowledgement.note,'acknowledgedAt',acknowledgement.acknowledged_at::text
        ) ORDER BY acknowledgement.acknowledged_at DESC,acknowledgement.recorded_at DESC) AS items
        FROM supplier_rfq_acknowledgements acknowledgement
        WHERE acknowledgement.rfq_id=rfq.id AND acknowledgement.supplier_id=$1
      ) acknowledgements ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'id',document.id::text,'fileName',document.file_name,
          'documentKind',document.document_kind,'documentVersion',document.document_version,
          'createdAt',document.created_at::text
        ) ORDER BY document.document_version DESC,document.created_at DESC) AS items
        FROM supplier_rfq_documents document
        WHERE document.rfq_id=rfq.id AND document.supplier_id=$1
      ) documents ON true
      WHERE rfq.supplier_id=$1
      ORDER BY (rfq.status IN ('ISSUED','VIEWED','ACKNOWLEDGED')) DESC,
        rfq.respond_by NULLS LAST,rfq.issued_at DESC
    `, [scope.supplierId]);
    const invoices = await client.query<SupplierInvoiceSummary>(`
      SELECT balance.id::text,request.order_code AS "orderCode",balance.invoice_number AS "invoiceNumber",
        balance.invoice_date::text AS "invoiceDate",balance.amount::float8,balance_status.label AS status,
        balance.payment_status AS "paymentStatus",balance.paid_amount::float8 AS "paidAmount",
        balance.outstanding_amount::float8 AS "outstandingAmount"
      FROM v_invoice_balances balance
      JOIN requests request ON request.id=balance.request_id
      JOIN lookup_values balance_status ON balance_status.id=balance.status_id
      WHERE balance.direction='SUPPLIER' AND balance.supplier_id=$1
        AND EXISTS (
          SELECT 1 FROM request_lines line
          WHERE line.request_id=request.id AND line.selected_supplier_id=$1
        )
      ORDER BY balance.invoice_date DESC,balance.invoice_number
    `, [scope.supplierId]);
    const rfqs = result.rows.map((rfq) => {
      const decoded = decodeSupplierQuotationNote(rfq.commercialNote);
      return {
        ...rfq,
        ...(decoded.availability ? { availability: decoded.availability } : {}),
        ...(decoded.note ? { commercialNote: decoded.note } : {}),
      };
    });
    return {
      supplierName: supplier.rows[0]?.name ?? "Supplier workspace",
      profile: supplier.rows[0],
      rfqs,
      invoices: invoices.rows,
    };
  });
}

export async function acknowledgeSupplierRfq(actor: SessionUser, input: {
  rfqId: string;
  acknowledgement: SupplierAcknowledgement;
  note?: string;
  clientEventId?: string;
}) {
  assertPermission(actor, "respond_to_rfqs");
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Supplier RFQ acknowledgement recorded" }, async (client) => {
    const scope = await activeSupplierScope(actor, client);
    const rfq = await client.query<{ companyId: string; branchId: string; requestId: string; selected: boolean; status: string }>(`
      SELECT rfq.company_id::text AS "companyId",request.branch_id::text AS "branchId",
        request.id::text AS "requestId",(line.selected_supplier_id=rfq.supplier_id) AS selected,
        rfq.status
      FROM supplier_rfqs rfq
      JOIN request_lines line ON line.id=rfq.request_line_id
      JOIN requests request ON request.id=line.request_id AND request.company_id=rfq.company_id
      WHERE rfq.id=$1 AND rfq.supplier_id=$2
        AND (rfq.status NOT IN ('WITHDRAWN','EXPIRED','CLOSED')
          OR (rfq.status='CLOSED' AND line.selected_supplier_id=rfq.supplier_id))
    `, [input.rfqId, scope.supplierId]);
    if (!rfq.rows[0]) throw new Error("Quotation request is unavailable.");
    const draft = buildSupplierAcknowledgement(scope, {
      rfqId: input.rfqId,
      acknowledgement: input.acknowledgement,
      note: input.note,
      clientEventId: input.clientEventId ?? randomUUID(),
    });
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO supplier_rfq_acknowledgements(
        company_id,rfq_id,supplier_id,supplier_membership_id,acknowledged_by,
        acknowledgement,note,client_event_id,acknowledged_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(supplier_id,client_event_id) DO NOTHING
      RETURNING id::text
    `, [rfq.rows[0].companyId,draft.rfqId,draft.supplierId,draft.supplierMembershipId,draft.acknowledgedBy,draft.acknowledgement,draft.note ?? null,draft.clientEventId,draft.acknowledgedAt]);
    if (!inserted.rows[0]) {
      const duplicate = await client.query<{ id: string }>(`
        SELECT id::text FROM supplier_rfq_acknowledgements
        WHERE supplier_id=$1 AND client_event_id=$2 AND rfq_id=$3
          AND supplier_membership_id=$4 AND acknowledged_by=$5
          AND acknowledgement=$6 AND note IS NOT DISTINCT FROM $7
      `, [draft.supplierId,draft.clientEventId,draft.rfqId,draft.supplierMembershipId,draft.acknowledgedBy,draft.acknowledgement,draft.note ?? null]);
      if (!duplicate.rows[0]) throw new Error("That supplier response ID was already used for different RFQ data.");
    }
    if (inserted.rows[0] && !rfq.rows[0].selected) {
      if (input.acknowledgement === "DECLINED") {
        await client.query(
          "UPDATE supplier_rfqs SET status='DECLINED',closed_at=now() WHERE id=$1 AND supplier_id=$2",
          [input.rfqId, scope.supplierId],
        );
      } else if (input.acknowledgement === "ACKNOWLEDGED") {
        await client.query(
          "UPDATE supplier_rfqs SET status='ACKNOWLEDGED' WHERE id=$1 AND supplier_id=$2 AND status IN ('ISSUED','VIEWED')",
          [input.rfqId, scope.supplierId],
        );
      }
    }
    if (inserted.rows[0]) {
      const workflowEvent = await appendWorkflowEvent(client, {
        companyId: rfq.rows[0].companyId,
        branchId: rfq.rows[0].branchId,
        requestId: rfq.rows[0].requestId,
        aggregateType: "supplier-rfq",
        aggregateId: input.rfqId,
        eventKey: rfq.rows[0].selected ? "supplier.order_acknowledged" : "supplier.rfq_acknowledged",
        stableKey: draft.clientEventId,
        actor,
        newState: input.acknowledgement,
        source: "SUPPLIER_PORTAL",
      });
      await notifyWorkflowAudience(client, workflowEvent, {
        actorUserId: actor.id,
        audiences: ["PLATFORM_OPERATIONS"],
        message: { key: "supplier_response_recorded" },
        routePath: "/sourcing",
      });
    }
  });
}

export async function submitSupplierQuotation(actor: SessionUser, input: {
  rfqId: string;
  quotationReference: string;
  unitPrice: number;
  deliveryCharge: number;
  minimumOrderQuantity?: number;
  leadTimeDays?: number;
  validUntil?: string;
  availability: SupplierAvailability;
  note?: string;
  clientEventId?: string;
}) {
  assertPermission(actor, "respond_to_rfqs");
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Supplier quotation submitted" }, async (client) => {
    const scope = await activeSupplierScope(actor, client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`supplier-quotation:${input.rfqId}`]);
    const rfq = await client.query<{ companyId: string; branchId: string; requestId: string; requestLineId: string; nextVersion: number }>(`
      SELECT rfq.company_id::text AS "companyId",
        request.branch_id::text AS "branchId",request.id::text AS "requestId",
        rfq.request_line_id::text AS "requestLineId",
        COALESCE((SELECT max(response_version)+1 FROM supplier_quotation_responses WHERE rfq_id=rfq.id),1)::int AS "nextVersion"
      FROM supplier_rfqs rfq
      JOIN request_lines line ON line.id=rfq.request_line_id
      JOIN requests request ON request.id=line.request_id AND request.company_id=rfq.company_id
      WHERE rfq.id=$1 AND rfq.supplier_id=$2
        AND rfq.status NOT IN ('WITHDRAWN','EXPIRED','CLOSED')
        AND (rfq.respond_by IS NULL OR rfq.respond_by > now())
    `, [input.rfqId, scope.supplierId]);
    if (!rfq.rows[0]) throw new Error("Quotation request is unavailable or expired.");
    const version = Number(rfq.rows[0].nextVersion);
    const draft = buildSupplierQuotation(scope, {
      rfqId: input.rfqId,
      responseVersion: version,
      responseStatus: version === 1 ? "SUBMITTED" : "REVISED",
      quotationReference: input.quotationReference,
      unitPrice: input.unitPrice,
      deliveryCharge: input.deliveryCharge,
      minimumOrderQuantity: input.minimumOrderQuantity,
      leadTimeDays: input.leadTimeDays,
      validUntil: input.validUntil,
      availability: input.availability,
      note: input.note,
      clientEventId: input.clientEventId ?? randomUUID(),
    });
    const encodedNote = encodeSupplierQuotationNote(draft.availability, draft.note);
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO supplier_quotation_responses(
        company_id,rfq_id,supplier_id,supplier_membership_id,submitted_by,
        response_version,response_status,quotation_reference,unit_price,
        delivery_charge,minimum_order_quantity,lead_time_days,valid_until,note,
        client_event_id,submitted_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(supplier_id,client_event_id) DO NOTHING
      RETURNING id::text
    `, [rfq.rows[0].companyId,draft.rfqId,draft.supplierId,draft.supplierMembershipId,draft.submittedBy,draft.responseVersion,draft.responseStatus,draft.quotationReference,draft.unitPrice,draft.deliveryCharge,draft.minimumOrderQuantity ?? null,draft.leadTimeDays ?? null,draft.validUntil ?? null,encodedNote,draft.clientEventId,draft.submittedAt]);
    if (!inserted.rows[0]) {
      const duplicate = await client.query<{ id: string }>(`
        SELECT id::text FROM supplier_quotation_responses
        WHERE supplier_id=$1 AND client_event_id=$2 AND rfq_id=$3
          AND supplier_membership_id=$4 AND submitted_by=$5
          AND quotation_reference=$6 AND unit_price=$7 AND delivery_charge=$8
          AND minimum_order_quantity IS NOT DISTINCT FROM $9
          AND lead_time_days IS NOT DISTINCT FROM $10
          AND valid_until IS NOT DISTINCT FROM $11::date
          AND note IS NOT DISTINCT FROM $12
      `, [draft.supplierId,draft.clientEventId,draft.rfqId,draft.supplierMembershipId,draft.submittedBy,draft.quotationReference,draft.unitPrice,draft.deliveryCharge,draft.minimumOrderQuantity ?? null,draft.leadTimeDays ?? null,draft.validUntil ?? null,encodedNote]);
      if (!duplicate.rows[0]) throw new Error("That quotation response ID was already used for different RFQ data.");
    }
    if (inserted.rows[0]) {
      await client.query(`
        INSERT INTO quotations(
          request_line_id,supplier_id,quotation_reference,quotation_date,unit_price,
          delivery_charge,minimum_order_quantity,lead_time_days,valid_until,status_id
        ) VALUES ($1,$2,$3,current_date,$4,$5,$6,$7,$8,lookup_id('quotation_status','Received'))
        ON CONFLICT(request_line_id,supplier_id,quotation_reference) DO UPDATE SET
          quotation_date=EXCLUDED.quotation_date,unit_price=EXCLUDED.unit_price,
          delivery_charge=EXCLUDED.delivery_charge,minimum_order_quantity=EXCLUDED.minimum_order_quantity,
          lead_time_days=EXCLUDED.lead_time_days,valid_until=EXCLUDED.valid_until,
          status_id=lookup_id('quotation_status','Received'),updated_at=now()
        WHERE quotations.selected=false
      `, [rfq.rows[0].requestLineId,draft.supplierId,draft.quotationReference,draft.unitPrice,
        draft.deliveryCharge,draft.minimumOrderQuantity ?? null,draft.leadTimeDays ?? null,draft.validUntil ?? null]);
      await client.query(
        "UPDATE supplier_rfqs SET status='RESPONDED' WHERE id=$1 AND supplier_id=$2",
        [input.rfqId, scope.supplierId],
      );
    }
    const workflowEvent = await appendWorkflowEvent(client, {
      companyId: rfq.rows[0].companyId,
      branchId: rfq.rows[0].branchId,
      requestId: rfq.rows[0].requestId,
      aggregateType: "supplier-rfq",
      aggregateId: input.rfqId,
      eventKey: "quotation.received",
      stableKey: draft.clientEventId,
      actor,
      newState: "Quotation received",
      source: "SUPPLIER_PORTAL",
      metadata: { requestLineId: rfq.rows[0].requestLineId },
    });
    await notifyWorkflowAudience(client, workflowEvent, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR", "PLATFORM_OPERATIONS"],
      message: { key: "quotation_received" },
      routePath: `/requests/${rfq.rows[0].requestId}`,
    });
  });
}

export async function uploadSupplierDocument(
  actor: SessionUser,
  rfqId: string,
  file: File,
  documentKind: "QUOTATION" | "SUPPORTING" = "QUOTATION",
) {
  assertPermission(actor, "respond_to_rfqs");
  if (isDemoMode()) return;
  const scopeInfo = await withAuditTransaction({ userId: actor.id, reason: "Validated supplier document scope" }, async (client) => {
    const scope = await activeSupplierScope(actor, client);
    const rfq = await client.query<{ companyId: string; selected: boolean }>(`
      SELECT rfq.company_id::text AS "companyId",
        (line.selected_supplier_id=rfq.supplier_id) AS selected
      FROM supplier_rfqs rfq
      JOIN request_lines line ON line.id=rfq.request_line_id
      WHERE rfq.id=$1 AND rfq.supplier_id=$2
        AND (rfq.status NOT IN ('WITHDRAWN','EXPIRED','CLOSED')
          OR (rfq.status='CLOSED' AND line.selected_supplier_id=rfq.supplier_id))
    `, [rfqId, scope.supplierId]);
    if (!rfq.rows[0]) throw new Error("Quotation request is unavailable.");
    if (documentKind === "SUPPORTING" && !rfq.rows[0].selected) {
      throw new Error("Supporting invoice documents are available only for selected orders.");
    }
    return { scope, ...rfq.rows[0] };
  });
  const stored = await storePersistentUpload({ namespace: "supplier-portal", scopeSegments: [scopeInfo.scope.supplierId, rfqId], file });
  try {
    await withAuditTransaction({ userId: actor.id, reason: "Supplier quotation document uploaded" }, async (client) => {
      const scope = await activeSupplierScope(actor, client);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`supplier-document:${rfqId}`]);
      const rfq = await client.query<{ companyId: string; selected: boolean; nextVersion: number }>(`
        SELECT rfq.company_id::text AS "companyId",
          (line.selected_supplier_id=rfq.supplier_id) AS selected,
          COALESCE((SELECT max(document_version)+1 FROM supplier_rfq_documents WHERE rfq_id=$1 AND document_kind=$3),1)::int AS "nextVersion"
        FROM supplier_rfqs rfq
        JOIN request_lines line ON line.id=rfq.request_line_id
        WHERE rfq.id=$1 AND rfq.supplier_id=$2
          AND (rfq.status NOT IN ('WITHDRAWN','EXPIRED','CLOSED')
            OR (rfq.status='CLOSED' AND line.selected_supplier_id=rfq.supplier_id))
      `, [rfqId, scope.supplierId, documentKind]);
      if (!rfq.rows[0]) throw new Error("Quotation request is unavailable.");
      if (documentKind === "SUPPORTING" && !rfq.rows[0].selected) {
        throw new Error("Supporting invoice documents are available only for selected orders.");
      }
      await client.query(`
        INSERT INTO supplier_rfq_documents(
          company_id,rfq_id,supplier_id,document_version,document_kind,
          file_name,content_type,storage_path,sha256,uploaded_by,supplier_membership_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `, [rfq.rows[0].companyId,rfqId,scope.supplierId,rfq.rows[0].nextVersion,documentKind,stored.safeFileName,stored.contentType,stored.relativePath,createHash("sha256").update(stored.bytes).digest("hex"),actor.id,scope.membershipId]);
    });
  } catch (error) {
    await removePersistentUpload(stored.relativePath);
    throw error;
  }
}

export async function loadSupplierDocument(actor: SessionUser, documentId: string) {
  assertPermission(actor, "view_supplier_portal");
  if (isDemoMode()) return null;
  return withAuditTransaction({ userId: actor.id, reason: "Downloaded supplier portal document" }, async (client) => {
    const scope = await activeSupplierScope(actor, client);
    const result = await client.query<{ fileName: string; contentType: string; storagePath: string }>(`
      SELECT file_name AS "fileName",content_type AS "contentType",storage_path AS "storagePath"
      FROM supplier_rfq_documents WHERE id=$1 AND supplier_id=$2
    `, [documentId, scope.supplierId]);
    const item = result.rows[0];
    if (!item) return null;
    const bytes = await readPersistentUpload(item.storagePath);
    return bytes ? { ...item, bytes } : null;
  });
}

export interface DriverJobWorkspaceItem {
  id: string;
  companyId: string;
  branchId: string;
  assignmentId: string;
  jobCode: string;
  status: string;
  assignmentStatus: string;
  branchName: string;
  address: string;
  contactName: string;
  contactPhone: string;
  instructions?: string;
  windowStart?: string;
  windowEnd?: string;
  packageSummary: string;
  lines: Array<{
    id: string;
    productName: string;
    plannedQuantity: number;
    unit: string;
  }>;
  lastEventId?: string;
  lastEvent?: string;
  lastEventAt?: string;
}

async function activeDriverScope(actor: SessionUser, client: import("pg").PoolClient) {
  if (actor.accountKind !== "DELIVERY" || actor.role !== "DELIVERY_DRIVER") throw new Error("An active delivery account is required.");
  const profile = await client.query<{ userId: string; active: boolean }>(`
    SELECT user_id::text AS "userId",active FROM delivery_agent_profiles WHERE user_id=$1
  `, [actor.id]);
  return resolveDeliveryDriverScope(actor.id, profile.rows[0]);
}

export async function getDriverWorkspace(actor: SessionUser): Promise<DriverJobWorkspaceItem[]> {
  assertPermission(actor, "view_delivery_portal");
  if (isDemoMode()) return [];
  return withAuditTransaction({ userId: actor.id, reason: "Viewed assigned delivery work" }, async (client) => {
    await activeDriverScope(actor, client);
    const result = await client.query<DriverJobWorkspaceItem>(`
      SELECT job.id::text,job.company_id::text AS "companyId",job.branch_id::text AS "branchId",
        assignment.id::text AS "assignmentId",job.job_code AS "jobCode",job.status,
        assignment.status AS "assignmentStatus",branch.name AS "branchName",
        job.delivery_address_snapshot AS address,job.contact_name_snapshot AS "contactName",
        job.contact_phone_snapshot AS "contactPhone",job.instructions,
        job.scheduled_window_start::text AS "windowStart",job.scheduled_window_end::text AS "windowEnd",
        COALESCE(lines.summary,'No package lines') AS "packageSummary",
        COALESCE(lines.items,'[]'::jsonb) AS lines,
        latest.id::text AS "lastEventId",latest.event_type AS "lastEvent",
        latest.client_recorded_at::text AS "lastEventAt"
      FROM delivery_job_assignments assignment
      JOIN delivery_jobs job ON job.id=assignment.delivery_job_id
      JOIN branches branch ON branch.id=job.branch_id
      LEFT JOIN LATERAL (
        SELECT string_agg(line.product_name_snapshot || ' × ' || job_line.quantity_to_deliver::text || ' ' || job_line.unit_of_measure_snapshot, ', ' ORDER BY line.product_name_snapshot) AS summary,
          jsonb_agg(jsonb_build_object(
            'id',job_line.id::text,'productName',line.product_name_snapshot,
            'plannedQuantity',job_line.quantity_to_deliver::float8,
            'unit',job_line.unit_of_measure_snapshot
          ) ORDER BY line.product_name_snapshot,job_line.id) AS items
        FROM delivery_job_lines job_line JOIN request_lines line ON line.id=job_line.request_line_id
        WHERE job_line.delivery_job_id=job.id
      ) lines ON true
      LEFT JOIN LATERAL (
        SELECT id,event_type,client_recorded_at FROM delivery_job_events event
        WHERE event.delivery_job_id=job.id AND event.driver_user_id=$1
          AND event.event_type NOT IN ('NOTE_ADDED','ISSUE_REPORTED')
        ORDER BY received_at DESC,id DESC LIMIT 1
      ) latest ON true
      WHERE assignment.driver_user_id=$1 AND assignment.status IN ('ASSIGNED','ACCEPTED')
        AND NOT EXISTS (
          SELECT 1 FROM delivery_job_events terminal_event
          WHERE terminal_event.assignment_id=assignment.id
            AND terminal_event.event_type IN ('REJECTED','PARTIALLY_DELIVERED','DELIVERED','FAILED')
        )
      ORDER BY job.scheduled_window_start NULLS LAST,assignment.assigned_at
    `, [actor.id]);
    return result.rows;
  });
}

export async function recordDriverEvent(actor: SessionUser, input: {
  deliveryJobId: string;
  assignmentId: string;
  deviceId: string;
  clientEventId: string;
  deviceSequence: number;
  eventType: DeliveryClientEventType;
  clientRecordedAt: string;
  note?: string;
  issueCode?: DeliveryIssueCode;
  receiverName?: string;
  lineOutcomes?: DriverReportedLineOutcome[];
}) {
  assertPermission(actor, "update_assigned_deliveries");
  const preliminaryDetails = validateDeliveryEventDetails(input.eventType, {
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.issueCode !== undefined ? { issueCode: input.issueCode } : {}),
    ...(input.receiverName !== undefined ? { receiverName: input.receiverName } : {}),
    ...(input.lineOutcomes !== undefined ? { lineOutcomes: input.lineOutcomes } : {}),
  });
  if (isDemoMode()) return { accepted: true as const, eventId: input.clientEventId };
  return withAuditTransaction({ userId: actor.id, reason: `Driver delivery event ${input.eventType}` }, async (client) => {
    const scope = await activeDriverScope(actor, client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`driver-event:${input.deliveryJobId}`]);
    const assignment = await client.query<{ id: string; companyId: string; branchId: string; requestId: string; jobCode: string; jobStatus: DeliveryJobStatus; deliveryJobId: string; driverUserId: string; status: "ASSIGNED" | "ACCEPTED" | "REJECTED" | "REASSIGNED" | "CANCELLED" | "COMPLETED"; assignedAt: string; endedAt?: string }>(`
      SELECT assignment.id::text,job.company_id::text AS "companyId",
        job.branch_id::text AS "branchId",job.request_id::text AS "requestId",job.job_code AS "jobCode",
        job.status AS "jobStatus",
        assignment.delivery_job_id::text AS "deliveryJobId",assignment.driver_user_id::text AS "driverUserId",
        assignment.status,assignment.assigned_at::text AS "assignedAt",assignment.ended_at::text AS "endedAt"
      FROM delivery_job_assignments assignment
      JOIN delivery_jobs job ON job.id=assignment.delivery_job_id
      WHERE assignment.id=$1 AND assignment.delivery_job_id=$2 AND assignment.driver_user_id=$3
    `, [input.assignmentId,input.deliveryJobId,actor.id]);
    if (!assignment.rows[0]) throw new Error("Delivery assignment is unavailable.");
    const expectedLines = preliminaryDetails.lineOutcomes
      ? (await client.query<{ id: string; plannedQuantity: number }>(`
          SELECT id::text,quantity_to_deliver::float8 AS "plannedQuantity"
          FROM delivery_job_lines WHERE delivery_job_id=$1 ORDER BY id
        `, [input.deliveryJobId])).rows
      : undefined;
    const metadata = deliveryEventMetadata(input.eventType, preliminaryDetails, expectedLines);
    const event = buildDeliveryClientEvent(scope, assignment.rows[0], {
      companyId: assignment.rows[0].companyId,
      deliveryJobId: input.deliveryJobId,
      deviceId: input.deviceId,
      clientEventId: input.clientEventId,
      deviceSequence: input.deviceSequence,
      eventType: input.eventType,
      clientRecordedAt: input.clientRecordedAt,
      metadata,
    });
    const duplicate = await client.query<{ id: string; matches: boolean }>(`
      SELECT id::text,
        company_id=$3 AND delivery_job_id=$4 AND assignment_id=$5
          AND device_id=$6 AND device_sequence=$7 AND event_type=$8
          AND client_recorded_at=$9::timestamptz AND metadata=$10::jsonb AS matches
      FROM delivery_job_events WHERE driver_user_id=$1 AND client_event_id=$2
    `, [event.driverUserId,event.clientEventId,event.companyId,event.deliveryJobId,event.assignmentId,event.deviceId,event.deviceSequence,event.eventType,event.clientRecordedAt,JSON.stringify(event.metadata)]);
    if (duplicate.rows[0]) {
      if (!duplicate.rows[0].matches) {
        throw new Error("That offline event ID was already used for different delivery data.");
      }
      return { accepted: true as const, eventId: duplicate.rows[0].id };
    }
    const activeAssignment = assignment.rows[0].status === "ASSIGNED" || assignment.rows[0].status === "ACCEPTED";
    if (activeAssignment) {
      const latest = await client.query<{ eventType: DeliveryProgressStatus }>(`
        SELECT event_type AS "eventType" FROM delivery_job_events
        WHERE assignment_id=$1 AND event_type NOT IN ('NOTE_ADDED','ISSUE_REPORTED')
        ORDER BY received_at DESC,id DESC LIMIT 1
      `, [input.assignmentId]);
      const baseStatus: DeliveryProgressStatus = assignment.rows[0].status === "ACCEPTED"
        ? "ACCEPTED"
        : assignment.rows[0].jobStatus === "CREATED"
          ? "ASSIGNED"
          : assignment.rows[0].jobStatus;
      assertDriverEventTransition(latest.rows[0]?.eventType ?? baseStatus, input.eventType);
    }
    const inserted = await client.query<{ id: string }>(`
      INSERT INTO delivery_job_events(
        company_id,delivery_job_id,assignment_id,driver_user_id,device_id,
        client_event_id,device_sequence,event_type,client_recorded_at,metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT(driver_user_id,client_event_id) DO NOTHING
      RETURNING id::text
    `, [event.companyId,event.deliveryJobId,event.assignmentId,event.driverUserId,event.deviceId,event.clientEventId,event.deviceSequence,event.eventType,event.clientRecordedAt,event.metadata]);
    const persistedEventId = inserted.rows[0]?.id;
    if (!persistedEventId) throw new Error("That offline event ID was already used for different delivery data.");
    const eventKeys: Record<DeliveryClientEventType, string> = {
      ACCEPTED: "delivery.accepted",
      REJECTED: "driver.assignment_rejected",
      EN_ROUTE: "delivery.out_for_delivery",
      ARRIVED: "delivery.arrived",
      DELIVERY_ATTEMPTED: "delivery.attempted",
      PARTIALLY_DELIVERED: "delivery.partially_delivered",
      DELIVERED: "delivery.completed",
      FAILED: "delivery.failed",
      ISSUE_REPORTED: "delivery.issue_reported",
      NOTE_ADDED: "delivery.note_added",
    };
    const audiences: WorkflowAudience[] = input.eventType === "DELIVERED" || input.eventType === "PARTIALLY_DELIVERED"
      ? ["REQUEST_CREATOR", "COMPANY_RECEIVERS"]
      : input.eventType === "REJECTED" || input.eventType === "FAILED"
          || input.eventType === "DELIVERY_ATTEMPTED" || input.eventType === "ISSUE_REPORTED"
        ? ["REQUEST_CREATOR", "PLATFORM_OPERATIONS"]
        : input.eventType === "NOTE_ADDED" || input.eventType === "ACCEPTED"
          ? ["PLATFORM_OPERATIONS"]
          : ["REQUEST_CREATOR"];
    const workflowEvent = await appendWorkflowEvent(client, {
      companyId: assignment.rows[0].companyId,
      branchId: assignment.rows[0].branchId,
      requestId: assignment.rows[0].requestId,
      aggregateType: activeAssignment ? "delivery-job" : "delivery-event",
      aggregateId: activeAssignment ? input.deliveryJobId : persistedEventId,
      eventKey: eventKeys[input.eventType],
      stableKey: event.clientEventId,
      actor,
      newState: input.eventType.replaceAll("_", " "),
      source: "DELIVERY_PORTAL",
      metadata: { deliveryJobId: input.deliveryJobId, deliveryEventId: persistedEventId },
    });
    const deliveryProblem = input.eventType === "REJECTED" || input.eventType === "FAILED"
      || input.eventType === "DELIVERY_ATTEMPTED" || input.eventType === "ISSUE_REPORTED";
    await notifyWorkflowAudience(client, workflowEvent, {
      actorUserId: actor.id,
      audiences,
      message: input.eventType === "DELIVERED"
        ? { key: "driver_delivery_completed" }
        : deliveryProblem
          ? { key: "driver_delivery_issue", jobCode: assignment.rows[0].jobCode }
          : {
              key: "driver_delivery_status",
              jobCode: assignment.rows[0].jobCode,
              status: input.eventType,
            },
      routePath: `/requests/${assignment.rows[0].requestId}`,
      priority: deliveryProblem ? "HIGH" : "NORMAL",
    });
    if (activeAssignment && (input.eventType === "DELIVERED" || input.eventType === "PARTIALLY_DELIVERED")) {
      const receiptEvent = await appendWorkflowEvent(client, {
        companyId: assignment.rows[0].companyId,
        branchId: assignment.rows[0].branchId,
        requestId: assignment.rows[0].requestId,
        aggregateType: "delivery-job",
        aggregateId: input.deliveryJobId,
        eventKey: "receipt.required",
        stableKey: `${event.clientEventId}:receipt-required`,
        actor,
        newState: "Awaiting customer receiver confirmation",
        source: "DELIVERY_PORTAL",
        metadata: { deliveryJobId: input.deliveryJobId, deliveryEventId: persistedEventId },
      });
      await notifyWorkflowAudience(client, receiptEvent, {
        actorUserId: actor.id,
        audiences: ["COMPANY_RECEIVERS"],
        message: { key: "receipt_required", jobCode: assignment.rows[0].jobCode },
        routePath: "/receiving",
        priority: "HIGH",
      });
    }
    return { accepted: true as const, eventId: persistedEventId };
  });
}

export async function uploadDriverEvidence(actor: SessionUser, input: {
  deliveryJobId: string;
  eventId: string;
  clientEvidenceId: string;
  capturedAt: string;
  file: File;
}) {
  assertPermission(actor, "update_assigned_deliveries");
  if (isDemoMode()) return { accepted: true as const, evidenceId: input.clientEvidenceId };
  const event = await withAuditTransaction({ userId: actor.id, reason: "Validated delivery evidence scope" }, async (client) => {
    await activeDriverScope(actor, client);
    const result = await client.query<{
      companyId: string;
      deliveryJobId: string;
      assignmentId: string;
      driverUserId: string;
      deviceId: string;
      clientEventId: string;
      deviceSequence: number;
      eventType: DeliveryClientEventType;
      clientRecordedAt: string;
      metadata: Record<string, never>;
    }>(`
      SELECT company_id::text AS "companyId",delivery_job_id::text AS "deliveryJobId",
        assignment_id::text AS "assignmentId",driver_user_id::text AS "driverUserId",
        device_id::text AS "deviceId",client_event_id::text AS "clientEventId",
        device_sequence AS "deviceSequence",event_type AS "eventType",
        client_recorded_at::text AS "clientRecordedAt",metadata
      FROM delivery_job_events WHERE id=$1 AND delivery_job_id=$2 AND driver_user_id=$3
    `, [input.eventId,input.deliveryJobId,actor.id]);
    if (!result.rows[0]) throw new Error("Delivery event is unavailable.");
    return result.rows[0];
  });
  const stored = await storePersistentUpload({ namespace: "delivery-evidence", scopeSegments: [actor.id, input.deliveryJobId], file: input.file });
  try {
    return await withAuditTransaction({ userId: actor.id, reason: "Driver delivery evidence uploaded" }, async (client) => {
      const scope = await activeDriverScope(actor, client);
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(stored.contentType)) {
        throw new Error("Delivery evidence type is unavailable.");
      }
      const contentType = stored.contentType as "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
      const draft = buildDriverEvidence(scope, event, {
        deliveryJobEventId: input.eventId,
        clientEvidenceId: input.clientEvidenceId,
        evidenceType: contentType === "application/pdf" ? "DELIVERY_NOTE" : "PHOTO",
        fileName: stored.safeFileName,
        contentType,
        storagePath: stored.relativePath,
        sha256: createHash("sha256").update(stored.bytes).digest("hex"),
        capturedAt: input.capturedAt,
      });
      if (draft.evidenceType === "LOCATION") {
        throw new Error("File evidence cannot be recorded as a location.");
      }
      const inserted = await client.query<{ id: string }>(`
        INSERT INTO delivery_evidence(
          company_id,delivery_job_id,delivery_job_event_id,driver_user_id,
          client_evidence_id,evidence_type,file_name,content_type,storage_path,
          sha256,captured_at,metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(driver_user_id,client_evidence_id) DO NOTHING
        RETURNING id::text
      `, [event.companyId,draft.deliveryJobId,draft.deliveryJobEventId,draft.driverUserId,draft.clientEvidenceId,draft.evidenceType,draft.fileName,draft.contentType,draft.storagePath,draft.sha256,draft.capturedAt,draft.metadata]);
      if (inserted.rows[0]) return { accepted: true as const, evidenceId: inserted.rows[0].id };
      const duplicate = await client.query<{ id: string }>(`
        SELECT id::text FROM delivery_evidence
        WHERE driver_user_id=$1 AND client_evidence_id=$2 AND company_id=$3
          AND delivery_job_id=$4 AND delivery_job_event_id=$5
          AND evidence_type=$6 AND file_name=$7 AND content_type=$8
          AND sha256=$9 AND captured_at=$10::timestamptz
      `, [draft.driverUserId,draft.clientEvidenceId,event.companyId,draft.deliveryJobId,draft.deliveryJobEventId,draft.evidenceType,draft.fileName,draft.contentType,draft.sha256,draft.capturedAt]);
      if (!duplicate.rows[0]) throw new Error("That evidence ID was already used for different delivery data.");
      await removePersistentUpload(stored.relativePath);
      return { accepted: true as const, evidenceId: duplicate.rows[0].id };
    });
  } catch (error) {
    await removePersistentUpload(stored.relativePath);
    throw error;
  }
}

export interface ReceivingJobWorkspaceItem {
  id: string;
  companyId: string;
  branchId: string;
  jobCode: string;
  branchName: string;
  deliveredAt?: string;
  driverEventType?: "DELIVERED" | "PARTIALLY_DELIVERED";
  /** Driver-entered handover evidence; never the authenticated receipt confirmer. */
  driverReportedReceiverName?: string;
  receiptId?: string;
  lines: Array<{
    id: string;
    requestLineId: string;
    productName: string;
    plannedQuantity: number;
    unit: string;
    driverReportedDeliveredQuantity?: number;
    driverReportedDamagedQuantity?: number;
    driverReportedMissingQuantity?: number;
  }>;
}

export async function getReceivingWorkspace(actor: SessionUser): Promise<ReceivingJobWorkspaceItem[]> {
  assertPermission(actor, "view_receiving");
  if (isDemoMode()) return [];
  return withAuditTransaction({ userId: actor.id, reason: "Viewed assigned receiving work" }, async (client) => {
    const companyId = actor.accountKind === "COMPANY" ? actor.companyId : undefined;
    const branchId = actor.accountKind === "COMPANY" ? actor.branchId : undefined;
    if (actor.accountKind === "COMPANY" && !companyId) throw new Error("An active company account is required.");
    const result = await client.query<Omit<ReceivingJobWorkspaceItem, "lines" | "driverReportedReceiverName"> & {
      lines: ReceivingJobWorkspaceItem["lines"];
      driverMetadata?: unknown;
    }>(`
      SELECT job.id::text,job.company_id::text AS "companyId",job.branch_id::text AS "branchId",
        job.job_code AS "jobCode",branch.name AS "branchName",
        latest.client_recorded_at::text AS "deliveredAt",latest.event_type AS "driverEventType",
        latest.metadata AS "driverMetadata",receipt.id::text AS "receiptId",
        COALESCE(jsonb_agg(jsonb_build_object(
          'id',job_line.id::text,'requestLineId',line.id::text,
          'productName',line.product_name_snapshot,'plannedQuantity',job_line.quantity_to_deliver::float8,
          'unit',job_line.unit_of_measure_snapshot
        ) ORDER BY line.product_name_snapshot) FILTER (WHERE job_line.id IS NOT NULL),'[]'::jsonb) AS lines
      FROM delivery_jobs job
      JOIN branches branch ON branch.id=job.branch_id
      LEFT JOIN delivery_job_lines job_line ON job_line.delivery_job_id=job.id
      LEFT JOIN request_lines line ON line.id=job_line.request_line_id
      LEFT JOIN receipts receipt ON receipt.delivery_job_id=job.id
      LEFT JOIN LATERAL (
        SELECT event.client_recorded_at,event.received_at,event.event_type,event.metadata
        FROM delivery_job_events event
        JOIN delivery_job_assignments evidence_assignment
          ON evidence_assignment.id=event.assignment_id
         AND evidence_assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
        WHERE event.delivery_job_id=job.id
          AND event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')
        ORDER BY event.received_at DESC,event.id DESC LIMIT 1
      ) latest ON true
      WHERE latest.received_at IS NOT NULL
        AND ($1::uuid IS NULL OR job.company_id=$1)
        AND ($2::uuid IS NULL OR job.branch_id=$2)
      GROUP BY job.id,branch.name,latest.client_recorded_at,latest.received_at,latest.event_type,latest.metadata,receipt.id
      ORDER BY (receipt.id IS NULL) DESC,latest.received_at DESC
    `, [companyId ?? null, branchId ?? null]);
    return result.rows.map((job) => {
      let details;
      try {
        details = job.driverEventType
          ? validateDeliveryEventDetails(job.driverEventType, job.driverMetadata)
          : undefined;
      } catch {
        details = undefined;
      }
      const reported = new Map(details?.lineOutcomes?.map((line) => [line.deliveryJobLineId, line]));
      const workspaceJob = { ...job };
      delete workspaceJob.driverMetadata;
      return {
        ...workspaceJob,
        ...(details?.receiverName ? { driverReportedReceiverName: details.receiverName } : {}),
        lines: job.lines.map((line) => {
          const outcome = reported.get(line.id);
          return {
            ...line,
            ...(outcome ? {
              driverReportedDeliveredQuantity: outcome.deliveredQuantity,
              driverReportedDamagedQuantity: outcome.damagedQuantity,
              driverReportedMissingQuantity: outcome.missingQuantity,
            } : {}),
          };
        }),
      };
    });
  });
}

export async function confirmReceipt(actor: SessionUser, input: {
  deliveryJobId: string;
  notes?: string;
  lines: Array<{
    deliveryJobLineId: string;
    requestLineId: string;
    deliveredQuantity: number;
    acceptedQuantity: number;
    damagedQuantity?: number;
    discrepancyCode?: "NONE" | "DAMAGED" | "SHORT" | "OVER" | "WRONG_ITEM" | "QUALITY" | "OTHER";
    discrepancyNote?: string;
  }>;
  clientEventId?: string;
}) {
  assertPermission(actor, "confirm_receipts");
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Customer receipt independently confirmed" }, async (client) => {
    if (actor.accountKind !== "COMPANY" || !actor.companyId) throw new Error("An active company receiving account is required.");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`receipt:${input.deliveryJobId}`]);
    const job = await client.query<{ companyId: string; branchId: string; requestId: string; jobCode: string }>(`
      SELECT company_id::text AS "companyId",branch_id::text AS "branchId",
        request_id::text AS "requestId",job_code AS "jobCode"
      FROM delivery_jobs job
      WHERE job.id=$1 AND job.company_id=$2
        AND ($3::uuid IS NULL OR job.branch_id=$3)
        AND EXISTS (
          SELECT 1 FROM delivery_job_events event
          JOIN delivery_job_assignments evidence_assignment
            ON evidence_assignment.id=event.assignment_id
           AND evidence_assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')
          WHERE event.delivery_job_id=job.id
            AND event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')
        )
        AND NOT EXISTS (
          SELECT 1 FROM receipts receipt WHERE receipt.delivery_job_id=job.id
        )
    `, [input.deliveryJobId,actor.companyId,actor.branchId ?? null]);
    if (!job.rows[0]) throw new Error("Receiving job is unavailable or already confirmed.");
    const planned = await client.query<{ id: string; requestLineId: string; plannedQuantity: number }>(`
      SELECT id::text,request_line_id::text AS "requestLineId",quantity_to_deliver::float8 AS "plannedQuantity"
      FROM delivery_job_lines WHERE delivery_job_id=$1 ORDER BY id
    `, [input.deliveryJobId]);
    if (!planned.rows.length || input.lines.length !== planned.rows.length) throw new Error("Confirm every delivery line.");
    const byId = new Map(planned.rows.map((line) => [line.id, line]));
    const calculated = input.lines.map((line) => {
      const source = byId.get(line.deliveryJobLineId);
      if (!source || source.requestLineId !== line.requestLineId) throw new Error("Receipt line is unavailable.");
      const manuallyClassified = line.discrepancyCode === "WRONG_ITEM"
        || line.discrepancyCode === "QUALITY"
        || line.discrepancyCode === "OTHER"
        ? line.discrepancyCode
        : undefined;
      return { source, result: calculateReceiptLine({ plannedQuantity: source.plannedQuantity, deliveredQuantity: line.deliveredQuantity, acceptedQuantity: line.acceptedQuantity, damagedQuantity: line.damagedQuantity, discrepancyCode: manuallyClassified, discrepancyNote: line.discrepancyNote }) };
    });
    const receiptStatus = receiptStatusFromLines(calculated.map((line) => line.result));
    const receiptId = randomUUID();
    const reference = `RCT-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${receiptId.slice(0,8).toUpperCase()}`;
    await client.query(`
      INSERT INTO receipts(id,company_id,branch_id,delivery_job_id,receipt_reference,status,confirmed_by_user_id,client_event_id,received_at,notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)
    `, [receiptId,job.rows[0].companyId,job.rows[0].branchId,input.deliveryJobId,reference,receiptStatus,actor.id,input.clientEventId ?? randomUUID(),input.notes?.trim().slice(0,2000) || null]);
    for (const line of calculated) {
      await client.query(`
        INSERT INTO receipt_lines(
          company_id,receipt_id,delivery_job_id,delivery_job_line_id,request_line_id,
          planned_quantity_snapshot,delivered_quantity,accepted_quantity,rejected_quantity,
          damaged_quantity,short_quantity,discrepancy_code,discrepancy_note
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [job.rows[0].companyId,receiptId,input.deliveryJobId,line.source.id,line.source.requestLineId,line.result.plannedQuantity,line.result.deliveredQuantity,line.result.acceptedQuantity,line.result.rejectedQuantity,line.result.damagedQuantity,line.result.shortQuantity,line.result.discrepancyCode,line.result.discrepancyNote ?? null]);
    }
    const hasDiscrepancy = receiptStatus !== "ACCEPTED";
    const workflowEvent = await appendWorkflowEvent(client, {
      companyId: job.rows[0].companyId,
      branchId: job.rows[0].branchId,
      requestId: job.rows[0].requestId,
      aggregateType: "receipt",
      aggregateId: receiptId,
      eventKey: hasDiscrepancy ? "discrepancy.opened" : "receipt.confirmed",
      stableKey: receiptId,
      actor,
      newState: hasDiscrepancy ? "Receiving discrepancy opened" : "Receipt confirmed",
      source: "WEB",
      metadata: {
        deliveryJobId: input.deliveryJobId,
        receiptId,
        receiptStatus,
        receiptLineCount: calculated.length,
      },
    });
    await notifyWorkflowAudience(client, workflowEvent, {
      actorUserId: actor.id,
      audiences: ["REQUEST_CREATOR", "PLATFORM_OPERATIONS", "COMPANY_FINANCE"],
      message: hasDiscrepancy
        ? { key: "receiving_discrepancy", jobCode: job.rows[0].jobCode }
        : { key: "receipt_confirmed", jobCode: job.rows[0].jobCode },
      routePath: `/requests/${job.rows[0].requestId}`,
      priority: hasDiscrepancy ? "HIGH" : "NORMAL",
    });
  });
}

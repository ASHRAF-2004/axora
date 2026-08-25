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
import { removePersistentUpload, storePersistentUpload } from "./persistent-files";
import { calculateReceiptLine, receiptStatusFromLines } from "./receiving";
import {
  appendWorkflowEvent,
  notifyWorkflowAudience,
  type WorkflowAudience,
} from "./workflow-repository";

function assertPermission(actor: SessionUser, permission: Parameters<typeof canAccess>[1]) {
  if (!canAccess(actor, permission)) throw new Error("Your account does not have permission to perform this action.");
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
  if (actor.accountKind !== "DELIVERY" || ![
    "DELIVERY_DRIVER", "DELIVERY_GUY",
  ].includes(actor.role)) throw new Error("An active delivery account is required.");
  const profile = await client.query<{ userId: string; active: boolean }>(`
    SELECT user_id::text AS "userId",active FROM delivery_agent_profiles WHERE user_id=$1
  `, [actor.id]);
  return resolveDeliveryDriverScope(actor.id, profile.rows[0]);
}

export async function getDriverWorkspace(actor: SessionUser): Promise<DriverJobWorkspaceItem[]> {
  assertPermission(actor, "view_delivery_portal");
  if (isDemoMode()) return [];
  return withAuditTransaction({ actor, reason: "Viewed assigned delivery work" }, async (client) => {
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
  return withAuditTransaction({ actor, reason: `Delivery Agent event ${input.eventType}` }, async (client) => {
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
  const event = await withAuditTransaction({ actor, reason: "Validated delivery evidence scope" }, async (client) => {
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
    return await withAuditTransaction({ actor, reason: "Delivery Agent evidence uploaded" }, async (client) => {
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
  driverUserId?: string;
  driverName?: string;
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
  return withAuditTransaction({ actor, reason: "Viewed assigned receiving work" }, async (client) => {
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
        assigned.driver_user_id::text AS "driverUserId",assigned.driver_name AS "driverName",
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
      LEFT JOIN LATERAL (
        SELECT assignment.driver_user_id,profile.display_name AS driver_name
        FROM delivery_job_assignments assignment
        JOIN user_profiles profile ON profile.user_id=assignment.driver_user_id
        WHERE assignment.delivery_job_id=job.id
          AND assignment.status IN ('ASSIGNED','ACCEPTED')
          AND assignment.ended_at IS NULL
        ORDER BY assignment.assigned_at DESC,assignment.id DESC LIMIT 1
      ) assigned ON true
      WHERE latest.received_at IS NOT NULL
        AND ($1::uuid IS NULL OR job.company_id=$1)
        AND ($2::uuid IS NULL OR job.branch_id=$2)
      GROUP BY job.id,branch.name,latest.client_recorded_at,latest.received_at,latest.event_type,latest.metadata,receipt.id,assigned.driver_user_id,assigned.driver_name
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
  await withAuditTransaction({ actor, reason: "Customer receipt independently confirmed" }, async (client) => {
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

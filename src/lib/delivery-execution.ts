import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { driverAvailableJobInternals } from "./driver-operations";
import {
  createDeliveryEvidenceAccessUrl,
  deliveryImageDimensions,
  generateDeliveryOtpCode,
  hashDeliveryOtp,
} from "./delivery-proof";
import { uploadedContentMatchesMime } from "./file-content";
import {
  readPersistentUpload,
  removePersistentUpload,
  storePersistentUpload,
} from "./persistent-files";
import { parseZonedDateTime } from "./zoned-date-time";

const uuid = z.string().uuid();
const note = z.string().trim().min(3).max(1_000);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const evidenceType = z.enum(["PHOTO", "SIGNATURE", "DELIVERY_NOTE"]);
const proofPolicy = z.array(z.enum(["PHOTO", "SIGNATURE", "OTP"])).min(1).max(3);
const eventType = z.enum([
  "ACCEPTED", "REJECTED", "SHOPPING_STARTED", "ITEMS_ACQUIRED",
  "OUT_FOR_DELIVERY", "ARRIVED", "DELIVERY_ATTEMPTED",
  "PARTIALLY_DELIVERED", "DELIVERED", "COMPLETED", "FAILED",
  "ISSUE_REPORTED", "NOTE_ADDED",
]);
const allowedFileTypes = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp",
]);
const moneyDecimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const acquisitionLine = z.discriminatedUnion("resolution", [
  z.object({
    deliveryJobLineId: uuid,
    resolution: z.literal("ACQUIRED"),
    actualInternalUnitCost: moneyDecimal,
  }),
  z.object({
    deliveryJobLineId: uuid,
    resolution: z.literal("UNAVAILABLE"),
    reason: z.string().trim().min(3).max(1_000),
  }),
]);
const acquisitionRegistration = z.object({
  submissionId: uuid,
  jobId: uuid,
  workflowVersion: z.number().int().positive(),
  created: z.boolean(),
  storagePath: z.string(),
  unavailableLines: z.number().int().nonnegative().optional().default(0),
});

export interface DeliveryEvidenceSummary {
  id: string;
  type: string;
  fileName: string;
  version: number;
  validationStatus: string;
  recipientIdentity?: string;
  createdAt: string;
  accessUrl?: string;
}

export interface DeliveryExecutionWorkspace {
  actorId: string;
  capturedAt: string;
  products: Array<{ id: string; name: string; code: string }>;
  suppliers: Array<{ id: string; name: string; code: string }>;
  jobs: Array<Record<string, unknown> & {
    id: string;
    code: string;
    status: string;
    workflowVersion: number;
    assignmentId: string;
    requestId: string;
    destinationTimezone: string;
    destinationLatitude?: number;
    destinationLongitude?: number;
    evidence: DeliveryEvidenceSummary[];
  }>;
}

interface JsonRow<T> extends QueryResultRow { value: T | null }
interface DestinationRow extends QueryResultRow {
  id: string;
  destinationLatitude: string | null;
  destinationLongitude: string | null;
}

type DemoDeliveryEvent = {
  id: string;
  type: string;
  receivedAt: string;
  metadata: Record<string, unknown>;
};

type DemoDeliveryCommand = {
  fingerprint: string;
  result: Record<string, unknown>;
};

type DemoDeliveryJobState = {
  actorId: string;
  assignmentId: string;
  status: string;
  workflowVersion: number;
  events: DemoDeliveryEvent[];
  evidence: DeliveryEvidenceSummary[];
  commands: Map<string, DemoDeliveryCommand>;
};

type DemoDeliveryExecutionState = {
  jobs: Map<string, DemoDeliveryJobState>;
};

declare global {
  var __axoraDemoDeliveryExecutionState: DemoDeliveryExecutionState | undefined;
}

function demoDeliveryExecutionState() {
  if (!global.__axoraDemoDeliveryExecutionState) {
    global.__axoraDemoDeliveryExecutionState = { jobs: new Map() };
  }
  return global.__axoraDemoDeliveryExecutionState;
}

function deterministicDemoUuid(namespace: string, value: string) {
  const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function demoDeliveryJobState(actor: AuthenticatedSessionUser) {
  const claimed = driverAvailableJobInternals.demoClaimedDeliveryJob(actor.id);
  if (!claimed || actor.accountKind !== "DELIVERY") {
    throw new Error("The delivery workflow is unavailable.");
  }
  const state = demoDeliveryExecutionState();
  const current = state.jobs.get(claimed.job.id);
  if (current) {
    if (current.actorId !== actor.id || current.assignmentId !== claimed.claim.assignmentId) {
      throw new Error("The delivery workflow is unavailable.");
    }
    return { claimed, current };
  }
  const createdAt = new Date().toISOString();
  const initial: DemoDeliveryJobState = {
    actorId: actor.id,
    assignmentId: claimed.claim.assignmentId,
    status: "ASSIGNED",
    workflowVersion: 1,
    events: [{
      id: deterministicDemoUuid("demo-delivery-assigned", claimed.claim.assignmentId),
      type: "ASSIGNED",
      receivedAt: createdAt,
      metadata: { source: "self-claim" },
    }],
    evidence: [],
    commands: new Map(),
  };
  state.jobs.set(claimed.job.id, initial);
  return { claimed, current: initial };
}

function demoDeliveryExecutionWorkspace(actor: AuthenticatedSessionUser): DeliveryExecutionWorkspace {
  const claimed = driverAvailableJobInternals.demoClaimedDeliveryJob(actor.id);
  if (!claimed) {
    return { actorId: actor.id, capturedAt: new Date().toISOString(), products: [], suppliers: [], jobs: [] };
  }
  const { current } = demoDeliveryJobState(actor);
  return {
    actorId: actor.id,
    capturedAt: new Date().toISOString(),
    products: [],
    suppliers: [],
    jobs: [{
      id: claimed.job.id,
      code: claimed.job.code,
      status: current.status,
      workflowVersion: current.workflowVersion,
      assignmentId: current.assignmentId,
      requestId: "60000000-0000-4000-8000-000000000001",
      requestNumber: claimed.job.requestReference,
      branchName: claimed.job.branchName,
      destinationTimezone: claimed.job.destinationTimezone,
      scheduledLocalStart: "2026-08-21T10:00:00",
      scheduledLocalEnd: "2026-08-21T12:00:00",
      acceptanceDeadline: "2026-08-21T02:30:00.000Z",
      slaDueAt: "2026-08-21T04:00:00.000Z",
      proofPolicy: ["PHOTO"],
      proofSatisfied: current.evidence.some((item) => item.type === "PHOTO"),
      address: "Kuala Lumpur receiving branch, Jalan Sultan Ismail",
      destinationLatitude: 3.1516,
      destinationLongitude: 101.7113,
      instructions: "Use the receiving entrance and quote the request reference.",
      lines: [{
        id: "70000000-0000-4000-8000-000000000001",
        requestLineId: "80000000-0000-4000-8000-000000000001",
        productId: "40000000-0000-4000-8000-000000000001",
        productName: "Safety gloves",
        quantity: 2,
        unitOfMeasure: "box",
      }],
      events: current.events.map((item) => ({ ...item, metadata: { ...item.metadata } })),
      evidence: current.evidence.map((item) => ({ ...item })),
      actualHistory: [{
        id: "90000000-0000-4000-8000-000000000001",
        state: "FINALIZED",
      }],
    }],
  };
}

const demoStatusTransitions: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  ASSIGNED: { ACCEPTED: "ACCEPTED", REJECTED: "REJECTED" },
  ACCEPTED: { SHOPPING_STARTED: "SHOPPING", ISSUE_REPORTED: "ACCEPTED" },
  SHOPPING: { ITEMS_ACQUIRED: "ITEMS_ACQUIRED", ISSUE_REPORTED: "SHOPPING", NOTE_ADDED: "SHOPPING" },
  ITEMS_ACQUIRED: { OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY", ISSUE_REPORTED: "ITEMS_ACQUIRED" },
  OUT_FOR_DELIVERY: { ARRIVED: "ARRIVED", FAILED: "FAILED", ISSUE_REPORTED: "OUT_FOR_DELIVERY" },
  ARRIVED: {
    DELIVERED: "DELIVERED",
    PARTIALLY_DELIVERED: "PARTIALLY_DELIVERED",
    FAILED: "FAILED",
    ISSUE_REPORTED: "ARRIVED",
  },
  PARTIALLY_DELIVERED: {
    DELIVERED: "DELIVERED",
    COMPLETED: "COMPLETED",
    ISSUE_REPORTED: "PARTIALLY_DELIVERED",
  },
  DELIVERED: { COMPLETED: "COMPLETED", ISSUE_REPORTED: "DELIVERED" },
};

const deliveryEvidenceRegistrationSchema = z.object({
  created: z.boolean(),
  evidenceId: uuid,
  storagePath: z.string().min(1).max(1_000),
  version: z.number().int().positive(),
}).passthrough();

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("The delivery workflow is unavailable.");
  return actor.roleAssignmentId;
}

function cleanFileName(value: string) {
  const name = value.normalize("NFKC").replace(/[\\/\x00-\x1f\x7f]/g, "_").trim();
  if (!name || name.length > 180) throw new Error("The delivery evidence file is unavailable.");
  return name;
}

async function jsonCapability<T>(sql: string, values: unknown[]) {
  const result = await query<JsonRow<T>>(sql, values);
  if (!result.rows[0]?.value) throw new Error("The delivery workflow is unavailable.");
  return result.rows[0].value;
}

function attachDestinationCoordinates(
  jobs: DeliveryExecutionWorkspace["jobs"],
  rows: DestinationRow[],
) {
  const jobIds = new Set(jobs.map((job) => job.id));
  const coordinates = new Map<string, { latitude: number; longitude: number }>();
  for (const row of rows) {
    if (!jobIds.has(row.id)) continue;
    if (row.destinationLatitude === null || row.destinationLongitude === null) {
      if (row.destinationLatitude !== row.destinationLongitude) {
        throw new Error("The delivery destination is unavailable.");
      }
      continue;
    }
    const parsed = z.object({
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    }).safeParse({
      latitude: Number(row.destinationLatitude),
      longitude: Number(row.destinationLongitude),
    });
    if (!parsed.success) throw new Error("The delivery destination is unavailable.");
    coordinates.set(row.id, parsed.data);
  }
  return jobs.map((job) => {
    const destination = coordinates.get(job.id);
    return destination ? {
      ...job,
      destinationLatitude: destination.latitude,
      destinationLongitude: destination.longitude,
    } : job;
  });
}

function stagedEvidenceReplayPath(
  registration: z.infer<typeof deliveryEvidenceRegistrationSchema>,
  newlyStoredPath: string,
) {
  return registration.created ? null : newlyStoredPath;
}

function deliveryEvidenceBytesMatch(
  contentType: string,
  bytes: Buffer,
  expectedSha256: string,
) {
  return /^[a-f0-9]{64}$/.test(expectedSha256)
    && uploadedContentMatchesMime(contentType, bytes)
    && createHash("sha256").update(bytes).digest("hex") === expectedSha256;
}

export async function getDeliveryExecutionWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return demoDeliveryExecutionWorkspace(actor);
  const workspace = await jsonCapability<DeliveryExecutionWorkspace>(
    "SELECT public.axora_delivery_execution_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
  const jobIds = workspace.jobs.map((job) => uuid.parse(job.id));
  const destinationRows = jobIds.length ? await withAuditTransaction({
    actor,
    reason: "Viewed assigned delivery destination snapshots",
  }, async (client) => {
    const result = await client.query<DestinationRow>(`
      SELECT job.id::text,
        job.destination_latitude::text AS "destinationLatitude",
        job.destination_longitude::text AS "destinationLongitude"
      FROM public.delivery_jobs job
      JOIN public.delivery_job_assignments assignment
        ON assignment.delivery_job_id=job.id
       AND assignment.driver_user_id=$1
       AND assignment.driver_role_assignment_id=$2
       AND assignment.status IN ('ASSIGNED','ACCEPTED')
       AND assignment.ended_at IS NULL
      WHERE job.id=ANY($3::uuid[])
        AND job.status NOT IN ('COMPLETED','CANCELLED')
    `, [actor.id, assignmentId(actor), jobIds]);
    return result.rows;
  }) : [];
  return {
    ...workspace,
    jobs: attachDestinationCoordinates(workspace.jobs, destinationRows).map((job) => ({
      ...job,
      evidence: (job.evidence ?? []).map((item) => ({
        ...item,
        accessUrl: createDeliveryEvidenceAccessUrl({ actorId: actor.id, evidenceId: item.id }),
      })),
    })),
  };
}

export const deliveryExecutionDestinationInternals = {
  attachDestinationCoordinates,
  deliveryEvidenceBytesMatch,
  demoDeliveryExecutionState,
  demoDeliveryExecutionWorkspace,
  stagedEvidenceReplayPath,
};

export async function getDeliverySupervisorWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return { capturedAt: new Date().toISOString(), agents: [], requests: [], jobs: [] };
  return jsonCapability<Record<string, unknown>>(
    "SELECT public.axora_delivery_supervisor_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
}

export async function getReceivingDeliveryWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return { capturedAt: new Date().toISOString(), jobs: [] };
  return jsonCapability<Record<string, unknown>>(
    "SELECT public.axora_receiving_delivery_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
}

export async function createCanonicalDeliveryJob(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    requestId: uuid,
    localStart: localDateTime,
    localEnd: localDateTime,
    instructions: z.string().trim().max(2_000).optional().default(""),
    idempotencyKey: z.string().min(8).max(200),
    commandId: uuid,
  }).parse(input);
  const now = new Date();
  return withAuditTransaction({ actor, reason: "Delivery job created", commandId: parsed.commandId }, async (client) => {
    const context = await client.query<JsonRow<{ destinationTimezone: string }>>(
      "SELECT public.axora_delivery_creation_context($1,$2,$3,$4) AS value",
      [actor.id, assignmentId(actor), parsed.requestId, now],
    );
    const zone = context.rows[0]?.value?.destinationTimezone;
    if (!zone) throw new Error("The delivery job is unavailable.");
    const start = parseZonedDateTime(parsed.localStart, zone);
    const end = parseZonedDateTime(parsed.localEnd, zone);
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_create_delivery_job(
        $1,$2,$3,$4,$5,$6::timestamp,$7::timestamp,$8,$9,$10,$11,$12
      ) AS value
    `, [actor.id, assignmentId(actor), parsed.requestId, start, end,
      parsed.localStart, parsed.localEnd, zone, parsed.instructions,
      parsed.idempotencyKey, parsed.commandId, now]);
    if (!result.rows[0]?.value) throw new Error("The delivery job is unavailable.");
    return result.rows[0].value;
  });
}

export async function assignCanonicalDeliveryJob(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    jobId: uuid,
    driverUserId: uuid,
    driverRoleAssignmentId: uuid,
    expectedVersion: z.number().int().positive(),
    reason: note,
    acceptanceDeadline: localDateTime,
    destinationTimezone: z.string().min(3).max(100),
    vehicle: z.string().trim().max(160).optional().default(""),
    shift: z.string().trim().max(160).optional().default(""),
    zone: z.string().trim().max(160).optional().default(""),
    proofPolicy,
    commandId: uuid,
  }).parse(input);
  const now = new Date();
  return withAuditTransaction({ actor, reason: parsed.reason, commandId: parsed.commandId }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_assign_delivery_job(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      ) AS value
    `, [actor.id, assignmentId(actor), parsed.jobId, parsed.driverUserId,
      parsed.driverRoleAssignmentId, parsed.expectedVersion, parsed.reason,
      parseZonedDateTime(parsed.acceptanceDeadline, parsed.destinationTimezone),
      parsed.vehicle, parsed.shift, parsed.zone,
      parsed.proofPolicy, parsed.commandId, now]);
    if (!result.rows[0]?.value) throw new Error("The delivery assignment is unavailable.");
    return result.rows[0].value;
  });
}

export async function manageCanonicalDeliveryJob(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    jobId: uuid,
    expectedVersion: z.number().int().positive(),
    operation: z.enum(["CANCEL", "RESCHEDULE", "PROOF_EXCEPTION"]),
    reason: note,
    localStart: localDateTime.optional(),
    localEnd: localDateTime.optional(),
    destinationTimezone: z.string().min(3).max(100),
    commandId: uuid,
  }).parse(input);
  const start = parsed.localStart
    ? parseZonedDateTime(parsed.localStart, parsed.destinationTimezone) : null;
  const end = parsed.localEnd
    ? parseZonedDateTime(parsed.localEnd, parsed.destinationTimezone) : null;
  const now = new Date();
  return withAuditTransaction({ actor, reason: parsed.reason, commandId: parsed.commandId }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_manage_delivery_job(
        $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamp,$10::timestamp,$11,$12
      ) AS value
    `, [actor.id, assignmentId(actor), parsed.jobId, parsed.expectedVersion,
      parsed.operation, parsed.reason, start, end, parsed.localStart ?? null,
      parsed.localEnd ?? null, parsed.commandId, now]);
    if (!result.rows[0]?.value) throw new Error("The delivery command is unavailable.");
    return result.rows[0].value;
  });
}

export async function recordCanonicalDeliveryEvent(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    jobId: uuid,
    assignmentId: uuid,
    expectedVersion: z.number().int().positive(),
    commandId: uuid,
    deviceId: uuid,
    deviceSequence: z.number().int().nonnegative(),
    eventType,
    clientRecordedAt: z.coerce.date(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  }).parse(input);
  if (isDemoMode()) {
    const { claimed, current } = demoDeliveryJobState(actor);
    if (parsed.jobId !== claimed.job.id || parsed.assignmentId !== current.assignmentId) {
      throw new Error("The delivery event is unavailable.");
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      actorId: actor.id,
      assignmentId: parsed.assignmentId,
      clientRecordedAt: parsed.clientRecordedAt.toISOString(),
      deviceId: parsed.deviceId,
      deviceSequence: parsed.deviceSequence,
      eventType: parsed.eventType,
      expectedVersion: parsed.expectedVersion,
      jobId: parsed.jobId,
      metadata: parsed.metadata,
    })).digest("hex");
    const prior = current.commands.get(parsed.commandId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new Error("The delivery command conflicts with its original payload.");
      }
      return prior.result;
    }
    if (parsed.expectedVersion !== current.workflowVersion) {
      throw new Error("The delivery event conflicts with the current workflow version.");
    }
    const nextStatus = demoStatusTransitions[current.status]?.[parsed.eventType];
    if (!nextStatus) throw new Error("The delivery event is unavailable in the current state.");
    if (parsed.eventType === "COMPLETED"
      && !current.evidence.some((item) => item.type === "PHOTO")) {
      throw new Error("Required delivery proof is still missing.");
    }
    const now = new Date();
    current.status = nextStatus;
    current.workflowVersion += 1;
    const eventId = deterministicDemoUuid("demo-delivery-event", parsed.commandId);
    current.events.push({
      id: eventId,
      type: parsed.eventType,
      receivedAt: now.toISOString(),
      metadata: { ...parsed.metadata },
    });
    const result = Object.freeze({
      assignmentId: current.assignmentId,
      eventId,
      jobId: claimed.job.id,
      status: current.status,
      workflowVersion: current.workflowVersion,
    });
    current.commands.set(parsed.commandId, { fingerprint, result });
    return result;
  }
  const now = new Date();
  return withAuditTransaction({ actor, reason: `Delivery ${parsed.eventType}`, commandId: parsed.commandId }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_record_delivery_event(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
      ) AS value
    `, [actor.id, assignmentId(actor), parsed.jobId, parsed.assignmentId,
      parsed.expectedVersion, parsed.commandId, parsed.deviceId,
      parsed.deviceSequence, parsed.eventType, parsed.clientRecordedAt,
      JSON.stringify(parsed.metadata), now]);
    if (!result.rows[0]?.value) throw new Error("The delivery event is unavailable.");
    return result.rows[0].value;
  });
}

export async function submitDeliveryShoppingActual(
  actor: AuthenticatedSessionUser,
  form: FormData,
) {
  const receipt = form.get("receipt");
  if (!(receipt instanceof File) || !allowedFileTypes.has(receipt.type)
    || receipt.size < 1 || receipt.size > 5 * 1024 * 1024) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  const parsed = z.object({
    requestId: uuid,
    purchaseMode: z.enum(["PARTIAL", "FINAL", "REFUND"]),
    notes: z.string().trim().min(3).max(2_000),
    idempotencyKey: z.string().min(8).max(200),
    lines: z.array(z.object({
      requestLineId: uuid,
      actualProductId: uuid,
      supplierId: uuid,
      quantity: z.coerce.number().positive(),
      actualBuyUnitPrice: z.coerce.number().nonnegative(),
      taxRate: z.coerce.number().min(0).max(100).default(0),
      deliveryCharge: z.coerce.number().nonnegative().default(0),
      otherCharge: z.coerce.number().nonnegative().default(0),
      substituteReason: z.string().trim().max(1_000).optional().default(""),
      notes: z.string().trim().max(2_000).optional().default(""),
    })).min(1).max(200),
  }).parse({
    requestId: form.get("requestId"),
    purchaseMode: form.get("purchaseMode"),
    notes: form.get("notes"),
    idempotencyKey: form.get("idempotencyKey"),
    lines: JSON.parse(String(form.get("lines") ?? "[]")),
  });
  const bytes = Buffer.from(await receipt.arrayBuffer());
  if (bytes.length !== receipt.size || !uploadedContentMatchesMime(receipt.type, bytes)) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  if (receipt.type.startsWith("image/")
    && !deliveryImageDimensions(receipt.type, bytes)) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  const now = new Date();
  return withAuditTransaction({ actor, reason: "Actual delivery shopping submitted", commandId: parsed.idempotencyKey }, async (client) => {
    const attachment = await client.query<{ id: string }>(`
      SELECT public.axora_create_delivery_receipt_attachment(
        $1,$2,$3,$4,$5,$6,$7
      )::text AS id
    `, [actor.id, assignmentId(actor), parsed.requestId,
      cleanFileName(receipt.name), receipt.type, bytes, now]);
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_submit_request_actual(
        $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9
      ) AS value
    `, [actor.id, assignmentId(actor), parsed.requestId, parsed.purchaseMode,
      attachment.rows[0]?.id, parsed.notes, JSON.stringify(parsed.lines),
      parsed.idempotencyKey, now]);
    if (!result.rows[0]?.value) throw new Error("The actual purchase submission is unavailable.");
    return result.rows[0].value;
  });
}

/**
 * Records job-bound internal acquisition evidence for an already-paid request.
 * This deliberately does not call the legacy request-actual function because
 * that function can alter customer pricing and budget spend.
 */
export async function recordPaidDeliveryAcquisition(
  actor: AuthenticatedSessionUser,
  form: FormData,
) {
  const receipt = form.get("receipt");
  if (!(receipt instanceof File) || !allowedFileTypes.has(receipt.type)
    || receipt.size < 1 || receipt.size > 5 * 1024 * 1024) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  const parsed = z.object({
    jobId: uuid,
    assignmentId: uuid,
    expectedVersion: z.coerce.number().int().positive(),
    commandId: uuid,
    eventCommandId: uuid,
    deviceId: uuid,
    deviceSequence: z.coerce.number().int().nonnegative(),
    capturedAt: z.coerce.date(),
    notes: z.string().trim().max(2_000)
      .refine((value) => value.length === 0 || value.length >= 3)
      .optional().default(""),
    lines: z.array(acquisitionLine).min(1).max(200),
  }).parse({
    jobId: form.get("jobId"),
    assignmentId: form.get("assignmentId"),
    expectedVersion: form.get("expectedVersion"),
    commandId: form.get("commandId"),
    eventCommandId: form.get("eventCommandId"),
    deviceId: form.get("deviceId"),
    deviceSequence: form.get("deviceSequence"),
    capturedAt: form.get("capturedAt"),
    notes: form.get("notes") ?? "",
    lines: JSON.parse(String(form.get("lines") ?? "[]")),
  });
  const bytes = Buffer.from(await receipt.arrayBuffer());
  if (bytes.length !== receipt.size || !uploadedContentMatchesMime(receipt.type, bytes)) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  if (receipt.type.startsWith("image/")
    && !deliveryImageDimensions(receipt.type, bytes)) {
    throw new Error("The private receipt evidence is unavailable.");
  }
  const eventType = parsed.lines.some((line) => line.resolution === "UNAVAILABLE")
    ? "ISSUE_REPORTED" : "ITEMS_ACQUIRED";
  const eventNote = eventType === "ISSUE_REPORTED"
    ? parsed.lines.filter((line) => line.resolution === "UNAVAILABLE")
      .map((line) => line.reason).join("; ").slice(0, 1_000)
    : parsed.notes || "Acquisition evidence recorded";
  if (isDemoMode()) {
    return recordCanonicalDeliveryEvent(actor, {
      jobId: parsed.jobId,
      assignmentId: parsed.assignmentId,
      expectedVersion: parsed.expectedVersion,
      commandId: parsed.eventCommandId,
      deviceId: parsed.deviceId,
      deviceSequence: parsed.deviceSequence,
      eventType,
      clientRecordedAt: parsed.capturedAt,
      metadata: eventType === "ISSUE_REPORTED"
        ? { note: eventNote, issueCode: "MISSING_ITEMS" }
        : { note: eventNote },
    });
  }
  const stored = await storePersistentUpload({
    namespace: "delivery-receipts",
    scopeSegments: [actor.id, parsed.jobId],
    file: receipt,
  });
  try {
    const now = new Date();
    const registration = await withAuditTransaction({
      actor, reason: "Paid delivery acquisition recorded", commandId: parsed.commandId,
    }, async (client) => {
      const registered = await client.query<JsonRow<unknown>>(`
        SELECT public.axora_register_delivery_acquisition(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16
        ) AS value
      `, [actor.id, assignmentId(actor), parsed.jobId, parsed.assignmentId,
        parsed.expectedVersion, parsed.commandId, parsed.eventCommandId,
        stored.safeFileName, stored.contentType, stored.relativePath,
        createHash("sha256").update(stored.bytes).digest("hex"), stored.bytes.length,
        parsed.capturedAt, parsed.notes || null, JSON.stringify(parsed.lines), now]);
      const value = acquisitionRegistration.parse(registered.rows[0]?.value);
      const event = await client.query<JsonRow<Record<string, unknown>>>(`
        SELECT public.axora_record_delivery_event(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12
        ) AS value
      `, [actor.id, assignmentId(actor), parsed.jobId, parsed.assignmentId,
        parsed.expectedVersion, parsed.eventCommandId, parsed.deviceId,
        parsed.deviceSequence, eventType, parsed.capturedAt,
        JSON.stringify(eventType === "ISSUE_REPORTED"
          ? { note: eventNote, issueCode: "MISSING_ITEMS" }
          : { note: eventNote }), now]);
      if (!event.rows[0]?.value) throw new Error("The delivery acquisition is unavailable.");
      return { registration: value, event: event.rows[0].value };
    });
    if (!registration.registration.created) {
      await removePersistentUpload(stored.relativePath);
    }
    return {
      registration: {
        submissionId: registration.registration.submissionId,
        jobId: registration.registration.jobId,
        workflowVersion: registration.registration.workflowVersion,
        created: registration.registration.created,
        unavailableLines: registration.registration.unavailableLines,
      },
      event: registration.event,
    };
  } catch (error) {
    await removePersistentUpload(stored.relativePath);
    throw error;
  }
}

export async function uploadCanonicalDeliveryEvidence(
  actor: AuthenticatedSessionUser,
  form: FormData,
) {
  const file = form.get("file");
  if (!(file instanceof File)) throw new Error("The delivery evidence is unavailable.");
  const parsed = z.object({
    jobId: uuid,
    eventId: uuid,
    clientEvidenceId: uuid,
    type: evidenceType,
    capturedAt: z.coerce.date(),
    recipientIdentity: z.string().trim().max(200).optional().default(""),
    consented: z.enum(["true", "false"]).default("false"),
    supersedesEvidenceId: z.union([uuid, z.literal("")]).optional().default(""),
  }).parse({
    jobId: form.get("jobId"), eventId: form.get("eventId"),
    clientEvidenceId: form.get("clientEvidenceId"), type: form.get("type"),
    capturedAt: form.get("capturedAt"), recipientIdentity: form.get("recipientIdentity"),
    consented: form.get("consented") ?? "false",
    supersedesEvidenceId: form.get("supersedesEvidenceId") ?? "",
  });
  if (parsed.type === "SIGNATURE" && (parsed.consented !== "true" || !parsed.recipientIdentity)) {
    throw new Error("Recipient identity and consent are required for a signature.");
  }
  if (isDemoMode()) {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length !== file.size || !allowedFileTypes.has(file.type)
      || !uploadedContentMatchesMime(file.type, bytes)
      || (file.type.startsWith("image/") && !deliveryImageDimensions(file.type, bytes))) {
      throw new Error("The delivery evidence is unavailable.");
    }
    const { claimed, current } = demoDeliveryJobState(actor);
    const event = current.events.find((item) => item.id === parsed.eventId);
    if (parsed.jobId !== claimed.job.id || !event
      || !["ARRIVED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(event.type)) {
      throw new Error("The delivery evidence is unavailable.");
    }
    const fingerprint = createHash("sha256").update(JSON.stringify({
      capturedAt: parsed.capturedAt.toISOString(),
      digest: createHash("sha256").update(bytes).digest("hex"),
      eventId: parsed.eventId,
      fileName: file.name,
      jobId: parsed.jobId,
      recipientIdentity: parsed.recipientIdentity,
      supersedesEvidenceId: parsed.supersedesEvidenceId,
      type: parsed.type,
    })).digest("hex");
    const prior = current.commands.get(parsed.clientEvidenceId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new Error("The delivery evidence command conflicts with its original payload.");
      }
      return prior.result;
    }
    const evidenceId = deterministicDemoUuid("demo-delivery-evidence", parsed.clientEvidenceId);
    current.evidence.push({
      id: evidenceId,
      type: parsed.type,
      fileName: cleanFileName(file.name),
      version: 1,
      validationStatus: "ACCEPTED",
      recipientIdentity: parsed.recipientIdentity || undefined,
      createdAt: new Date().toISOString(),
    });
    const result = Object.freeze({
      evidenceId, version: 1, validationStatus: "ACCEPTED", created: true,
      storagePath: `demo/${evidenceId}`,
    });
    current.commands.set(parsed.clientEvidenceId, { fingerprint, result });
    return result;
  }
  const stored = await storePersistentUpload({
    namespace: "delivery-evidence", scopeSegments: [actor.id, parsed.jobId], file,
  });
  try {
    if (!allowedFileTypes.has(stored.contentType)) throw new Error("The delivery evidence is unavailable.");
    const dimensions = stored.contentType.startsWith("image/")
      ? deliveryImageDimensions(stored.contentType, stored.bytes) : null;
    const now = new Date();
    const registration = await withAuditTransaction({ actor, reason: "Delivery proof uploaded", commandId: parsed.clientEvidenceId }, async (client) => {
      const result = await client.query<JsonRow<unknown>>(`
        SELECT public.axora_register_delivery_evidence(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19
        ) AS value
      `, [actor.id, assignmentId(actor), parsed.jobId, parsed.eventId,
        parsed.clientEvidenceId, parsed.type, stored.safeFileName, stored.contentType,
        stored.relativePath, createHash("sha256").update(stored.bytes).digest("hex"), parsed.capturedAt,
        parsed.recipientIdentity || null, parsed.type === "SIGNATURE" ? "delivery-consent-v1" : null,
        parsed.type === "SIGNATURE" ? parsed.capturedAt : null, dimensions?.width ?? null,
        dimensions?.height ?? null, parsed.supersedesEvidenceId || null,
        JSON.stringify({ source: "driver-portal" }), now]);
      const parsedRegistration = deliveryEvidenceRegistrationSchema.safeParse(result.rows[0]?.value);
      if (!parsedRegistration.success) throw new Error("The delivery evidence is unavailable.");
      return parsedRegistration.data;
    });
    const replayPath = stagedEvidenceReplayPath(registration, stored.relativePath);
    if (replayPath) {
      // The command already committed earlier. Keep the durable evidence path
      // returned by PostgreSQL and remove only this request's newly staged file.
      await removePersistentUpload(replayPath);
    }
    return registration;
  } catch (error) {
    await removePersistentUpload(stored.relativePath);
    throw error;
  }
}

export async function createReceivingDeliveryOtp(actor: AuthenticatedSessionUser, input: unknown) {
  const parsed = z.object({ jobId: uuid }).parse(input);
  const code = generateDeliveryOtpCode();
  const hash = hashDeliveryOtp(parsed.jobId, code);
  const now = new Date();
  const value = await withAuditTransaction({ actor, reason: "Recipient delivery code issued" }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(
      "SELECT public.axora_create_delivery_otp($1,$2,$3,$4,$5) AS value",
      [actor.id, assignmentId(actor), parsed.jobId, hash, now],
    );
    if (!result.rows[0]?.value) throw new Error("The delivery confirmation is unavailable.");
    return result.rows[0].value;
  });
  return { ...value, code };
}

export async function verifyDriverDeliveryOtp(actor: AuthenticatedSessionUser, input: unknown) {
  const parsed = z.object({ jobId: uuid, challengeId: uuid, code: z.string().regex(/^\d{6}$/) }).parse(input);
  const now = new Date();
  return withAuditTransaction({ actor, reason: "Recipient delivery code verified" }, async (client) => {
    const result = await client.query<{ verified: boolean }>(`
      SELECT public.axora_verify_delivery_otp($1,$2,$3,$4,$5,$6) AS verified
    `, [actor.id, assignmentId(actor), parsed.jobId, parsed.challengeId,
      hashDeliveryOtp(parsed.jobId, parsed.code), now]);
    return { verified: result.rows[0]?.verified === true };
  });
}

export async function loadDeliveryEvidenceFile(
  actor: AuthenticatedSessionUser,
  evidenceId: string,
) {
  if (!uuid.safeParse(evidenceId).success || isDemoMode()) return null;
  const result = await query<{
    evidenceId: string; fileName: string; contentType: string; storagePath: string;
    sha256: string; deliveryJobId: string; evidenceVersion: number;
  }>(`
    SELECT evidence_id::text AS "evidenceId",file_name AS "fileName",
      content_type AS "contentType",storage_path AS "storagePath",sha256,
      delivery_job_id::text AS "deliveryJobId",evidence_version AS "evidenceVersion"
    FROM public.axora_delivery_evidence_file($1,$2,$3,$4)
  `, [actor.id, assignmentId(actor), evidenceId, new Date()]);
  const item = result.rows[0];
  if (!item) return null;
  const bytes = await readPersistentUpload(item.storagePath);
  if (!bytes || !deliveryEvidenceBytesMatch(item.contentType, bytes, item.sha256)) return null;
  return { ...item, bytes };
}

export const deliveryExecutionInternals = { eventType, proofPolicy, randomCommandId: randomUUID };

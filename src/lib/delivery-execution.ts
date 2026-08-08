import { createHash, randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
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
    evidence: DeliveryEvidenceSummary[];
  }>;
}

interface JsonRow<T> extends QueryResultRow { value: T | null }

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

export async function getDeliveryExecutionWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return {
    actorId: actor.id, capturedAt: new Date().toISOString(), products: [], suppliers: [], jobs: [],
  } satisfies DeliveryExecutionWorkspace;
  const workspace = await jsonCapability<DeliveryExecutionWorkspace>(
    "SELECT public.axora_delivery_execution_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
  return {
    ...workspace,
    jobs: workspace.jobs.map((job) => ({
      ...job,
      evidence: (job.evidence ?? []).map((item) => ({
        ...item,
        accessUrl: createDeliveryEvidenceAccessUrl({ actorId: actor.id, evidenceId: item.id }),
      })),
    })),
  };
}

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
  const stored = await storePersistentUpload({
    namespace: "delivery-evidence", scopeSegments: [actor.id, parsed.jobId], file,
  });
  try {
    if (!allowedFileTypes.has(stored.contentType)) throw new Error("The delivery evidence is unavailable.");
    const dimensions = stored.contentType.startsWith("image/")
      ? deliveryImageDimensions(stored.contentType, stored.bytes) : null;
    const now = new Date();
    return await withAuditTransaction({ actor, reason: "Delivery proof uploaded", commandId: parsed.clientEvidenceId }, async (client) => {
      const result = await client.query<JsonRow<Record<string, unknown>>>(`
        SELECT public.axora_register_delivery_evidence(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19
        ) AS value
      `, [actor.id, assignmentId(actor), parsed.jobId, parsed.eventId,
        parsed.clientEvidenceId, parsed.type, stored.safeFileName, stored.contentType,
        stored.relativePath, createHash("sha256").update(stored.bytes).digest("hex"), parsed.capturedAt,
        parsed.recipientIdentity || null, parsed.type === "SIGNATURE" ? "delivery-consent-v1" : null,
        parsed.type === "SIGNATURE" ? now : null, dimensions?.width ?? null,
        dimensions?.height ?? null, parsed.supersedesEvidenceId || null,
        JSON.stringify({ source: "driver-portal" }), now]);
      if (!result.rows[0]?.value) throw new Error("The delivery evidence is unavailable.");
      return result.rows[0].value;
    });
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
  if (!bytes) return null;
  return { ...item, bytes };
}

export const deliveryExecutionInternals = { eventType, proofPolicy, randomCommandId: randomUUID };

import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { addDemoAudit, getDemoOperations } from "./demo-operations";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { uploadedContentMatchesMime } from "./file-content";
import { listDeliveries, listInvoices } from "./operations";
import { canAccess } from "./permissions";
import { listAuthorizedRequests } from "./request-reader";
import type { AttachmentRecord } from "./types";

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const uuidSchema = z.string().uuid();
export const documentRecordIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const entityTypeSchema = z.enum(["request", "invoice", "delivery"]);
const visibilitySchema = z.enum(["CUSTOMER", "INTERNAL"]);
const contentTypeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "text/csv",
]);
const optionalDisplayName = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().trim().min(1).max(300).optional(),
);
const bufferSchema = z.custom<Buffer>(Buffer.isBuffer, "Expected file bytes");

const attachmentAccessRowSchema = z.object({
  capturedAt: z.coerce.date(),
  id: uuidSchema,
  entityType: entityTypeSchema,
  recordId: uuidSchema,
  requestId: uuidSchema,
  fileName: z.string().trim().min(1).max(120),
  contentType: contentTypeSchema,
  visibility: visibilitySchema,
  createdAt: z.coerce.date(),
  uploadedByName: optionalDisplayName,
}).strict();

const attachmentDownloadRowSchema = z.object({
  capturedAt: z.coerce.date(),
  attachmentId: uuidSchema,
  fileName: z.string().trim().min(1).max(120),
  contentType: contentTypeSchema,
  storagePath: z.string().min(1).max(2_000),
  fileContent: z.preprocess(
    (value) => value === null ? undefined : value,
    bufferSchema.optional(),
  ),
  visibility: visibilitySchema,
}).strict();

const attachmentCreationRowSchema = z.object({
  attachmentId: uuidSchema,
  visibility: visibilitySchema,
}).strict();

const creationInputSchema = z.object({
  entityType: entityTypeSchema,
  recordId: documentRecordIdSchema,
  visibility: visibilitySchema.default("CUSTOMER"),
}).strict();

type AttachmentEntityType = z.infer<typeof entityTypeSchema>;
type AttachmentVisibility = z.infer<typeof visibilitySchema>;
type AttachmentContentType = z.infer<typeof contentTypeSchema>;

interface AttachmentAccessRow extends QueryResultRow {
  capturedAt: Date | string;
  id: string;
  entityType: string;
  recordId: string;
  requestId: string;
  fileName: string;
  contentType: string;
  visibility: string;
  createdAt: Date | string;
  uploadedByName?: string | null;
}

interface AttachmentDownloadRow extends QueryResultRow {
  capturedAt: Date | string;
  attachmentId: string;
  fileName: string;
  contentType: string;
  storagePath: string;
  fileContent?: Buffer | null;
  visibility: string;
}

interface AttachmentCreationRow extends QueryResultRow {
  attachmentId: string;
  visibility: string;
}

export class DocumentAccessUnavailableError extends Error {
  constructor() {
    super("The requested document is unavailable.");
    this.name = "DocumentAccessUnavailableError";
  }
}

function requireLiveAssignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new DocumentAccessUnavailableError();
  return actor.roleAssignmentId;
}

function sanitizeAttachmentFileName(rawName: string) {
  const safe = rawName
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(-120);
  if (!safe || safe === "." || safe === "..") {
    throw new DocumentAccessUnavailableError();
  }
  return safe;
}

function validatedAttachmentBytes(file: File) {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Choose a file between 1 byte and 2 MB.");
  }
  const contentType = contentTypeSchema.safeParse(file.type);
  if (!contentType.success) {
    throw new Error("Only PDF, PNG, JPG, TXT, and CSV files are allowed.");
  }
  return contentType.data;
}

function isPlatformDocumentActor(actor: AuthenticatedSessionUser) {
  return actor.isOwner || actor.accountKind === "PLATFORM";
}

async function resolveDemoAttachmentParent(
  actor: AuthenticatedSessionUser,
  entityType: AttachmentEntityType,
  recordId: string,
) {
  const visibleRequests = await listAuthorizedRequests(actor);
  const requestIds = new Set(visibleRequests.map((request) => request.id));
  const lineToRequest = new Map(
    visibleRequests.flatMap((request) =>
      request.lines.map((line) => [line.id, request.id] as const)),
  );
  const operations = getDemoOperations();

  if (entityType === "request") {
    return requestIds.has(recordId)
      ? { requestId: recordId, invoiceDirection: undefined }
      : undefined;
  }

  if (entityType === "invoice") {
    if (!canAccess(actor, "view_invoices")) return undefined;
    const invoice = operations.invoices.find((item) => item.id === recordId);
    if (!invoice || !requestIds.has(invoice.requestId)) return undefined;
    return { requestId: invoice.requestId, invoiceDirection: invoice.direction };
  }

  if (!canAccess(actor, "view_deliveries")) return undefined;
  const delivery = operations.deliveries.find((item) => item.id === recordId);
  const requestId = delivery ? lineToRequest.get(delivery.requestLineId) : undefined;
  return requestId ? { requestId, invoiceDirection: undefined } : undefined;
}

async function listAuthorizedDemoAttachments(actor: AuthenticatedSessionUser) {
  const visibleRequests = await listAuthorizedRequests(actor);
  const requestIds = new Set(visibleRequests.map((request) => request.id));
  const requestLineIds = new Set(
    visibleRequests.flatMap((request) => request.lines.map((line) => line.id)),
  );
  const operations = getDemoOperations();
  const invoiceIds = new Set(
    canAccess(actor, "view_invoices")
      ? operations.invoices
        .filter((invoice) => requestIds.has(invoice.requestId))
        .map((invoice) => invoice.id)
      : [],
  );
  const deliveryIds = new Set(
    canAccess(actor, "view_deliveries")
      ? operations.deliveries
        .filter((delivery) => requestLineIds.has(delivery.requestLineId))
        .map((delivery) => delivery.id)
      : [],
  );
  const platformView = isPlatformDocumentActor(actor);

  return operations.attachments.filter((attachment) => {
    if (!platformView && attachment.visibility !== "CUSTOMER") return false;
    if (attachment.entityType === "request") {
      return requestIds.has(attachment.recordId);
    }
    if (attachment.entityType === "invoice") {
      return invoiceIds.has(attachment.recordId);
    }
    if (attachment.entityType === "delivery") {
      return deliveryIds.has(attachment.recordId);
    }
    return false;
  });
}

export async function listAuthorizedAttachments(
  actor: AuthenticatedSessionUser,
  capturedAt = new Date(),
): Promise<AttachmentRecord[]> {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new DocumentAccessUnavailableError();
  }
  if (isDemoMode()) return listAuthorizedDemoAttachments(actor);

  const assignmentId = requireLiveAssignment(actor);
  try {
    const result = await query<AttachmentAccessRow>(`
      SELECT
        captured_at AS "capturedAt",
        attachment_id::text AS id,
        entity_type AS "entityType",
        record_id::text AS "recordId",
        request_id::text AS "requestId",
        file_name AS "fileName",
        content_type AS "contentType",
        visibility,
        created_at AS "createdAt",
        uploaded_by_name AS "uploadedByName"
      FROM public.axora_attachment_access_rows($1,$2,$3)
    `, [actor.id, assignmentId, capturedAt]);

    return result.rows.map((row) => {
      const parsed = attachmentAccessRowSchema.safeParse(row);
      if (!parsed.success
        || parsed.data.capturedAt.getTime() !== capturedAt.getTime()) {
        throw new DocumentAccessUnavailableError();
      }
      return {
        id: parsed.data.id,
        entityType: parsed.data.entityType,
        recordId: parsed.data.recordId,
        fileName: parsed.data.fileName,
        contentType: parsed.data.contentType,
        visibility: parsed.data.visibility,
        createdAt: parsed.data.createdAt.toISOString(),
        uploadedByName: parsed.data.uploadedByName,
      };
    });
  } catch (error) {
    if (error instanceof DocumentAccessUnavailableError) throw error;
    throw new DocumentAccessUnavailableError();
  }
}

async function readLegacyAttachment(
  storagePath: string,
  contentType: AttachmentContentType,
) {
  try {
    const configuredRoot = process.env.AXORA_UPLOADS_CONTAINER_DIR
      ? path.resolve(process.env.AXORA_UPLOADS_CONTAINER_DIR)
      : path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        "data",
        "uploads",
      );
    const root = await realpath(/* turbopackIgnore: true */ configuredRoot);
    const candidate = path.resolve(/* turbopackIgnore: true */ root, storagePath);
    if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
      return null;
    }
    const source = await realpath(/* turbopackIgnore: true */ candidate);
    if (!source.startsWith(`${root}${path.sep}`)) return null;
    const metadata = await stat(/* turbopackIgnore: true */ source);
    if (!metadata.isFile()
      || metadata.size < 1
      || metadata.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }
    const bytes = await readFile(/* turbopackIgnore: true */ source);
    return uploadedContentMatchesMime(contentType, bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function loadAuthorizedAttachmentFile(
  actor: AuthenticatedSessionUser,
  attachmentId: string,
  capturedAt = new Date(),
) {
  if (isDemoMode()) return null;
  if (!uuidSchema.safeParse(attachmentId).success
    || !Number.isFinite(capturedAt.getTime())) {
    return null;
  }

  let assignmentId: string;
  try {
    assignmentId = requireLiveAssignment(actor);
  } catch {
    return null;
  }

  try {
    return await withAuditTransaction(
      { actor, reason: "Downloaded an authorized attachment", reasonCode: "ATTACHMENT_DOWNLOAD" },
      async (client) => {
    const result = await client.query<AttachmentDownloadRow>(`
      SELECT
        captured_at AS "capturedAt",
        attachment_id::text AS "attachmentId",
        file_name AS "fileName",
        content_type AS "contentType",
        storage_path AS "storagePath",
        file_content AS "fileContent",
        visibility
      FROM public.axora_attachment_download($1,$2,$3,$4)
    `, [actor.id, assignmentId, attachmentId, capturedAt]);
    const parsed = attachmentDownloadRowSchema.safeParse(result.rows[0]);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.attachmentId !== attachmentId) {
      return null;
    }

    const bytes = parsed.data.fileContent
      ?? await readLegacyAttachment(
        parsed.data.storagePath,
        parsed.data.contentType,
      );
    if (!bytes
      || bytes.length < 1
      || bytes.length > MAX_ATTACHMENT_BYTES
      || !uploadedContentMatchesMime(parsed.data.contentType, bytes)) {
      return null;
    }
    await recordAccountabilityAccessWithClient(
      client,
      actor,
      "ATTACHMENT_DOWNLOAD",
      attachmentId,
      1,
    );
    return {
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
      bytes,
      visibility: parsed.data.visibility,
    };
      },
    );
  } catch {
    return null;
  }
}

export async function createAuthorizedAttachment(
  actor: AuthenticatedSessionUser,
  input: {
    entityType: AttachmentEntityType;
    recordId: string;
    file: File;
    visibility?: AttachmentVisibility;
  },
  capturedAt = new Date(),
) {
  const request = creationInputSchema.safeParse({
    entityType: input.entityType,
    recordId: input.recordId,
    visibility: input.visibility ?? "CUSTOMER",
  });
  if (!request.success || !Number.isFinite(capturedAt.getTime())) {
    throw new DocumentAccessUnavailableError();
  }
  if (!canAccess(actor, "manage_documents")) {
    throw new DocumentAccessUnavailableError();
  }

  const contentType = validatedAttachmentBytes(input.file);
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size
    || !uploadedContentMatchesMime(contentType, bytes)) {
    throw new Error("The file content does not match its declared type.");
  }
  const fileName = sanitizeAttachmentFileName(input.file.name);

  if (isDemoMode()) {
    const parent = await resolveDemoAttachmentParent(
      actor,
      request.data.entityType,
      request.data.recordId,
    );
    if (!parent) throw new DocumentAccessUnavailableError();
    if (parent.invoiceDirection === "SUPPLIER"
      && !isPlatformDocumentActor(actor)) {
      throw new DocumentAccessUnavailableError();
    }
    const visibility: AttachmentVisibility = parent.invoiceDirection === "SUPPLIER"
      ? "INTERNAL"
      : request.data.visibility === "INTERNAL" && isPlatformDocumentActor(actor)
        ? "INTERNAL"
        : "CUSTOMER";
    const attachmentId = randomUUID();
    getDemoOperations().attachments.unshift({
      id: attachmentId,
      entityType: request.data.entityType,
      recordId: request.data.recordId,
      fileName,
      contentType,
      visibility,
      createdAt: capturedAt.toISOString(),
      uploadedByName: actor.name,
    });
    addDemoAudit(
      "attachments",
      attachmentId,
      "INSERT",
      actor.name,
      `Uploaded ${fileName}`,
    );
    return { attachmentId, visibility };
  }

  if (!uuidSchema.safeParse(request.data.recordId).success) {
    throw new DocumentAccessUnavailableError();
  }
  const assignmentId = requireLiveAssignment(actor);
  try {
    return await withAuditTransaction({
      actor,
      reason: `Uploaded document ${fileName}`,
    }, async (client) => {
      const result = await client.query<AttachmentCreationRow>(`
        SELECT
          attachment_id::text AS "attachmentId",
          visibility
        FROM public.axora_create_attachment(
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
      `, [
        actor.id,
        assignmentId,
        request.data.entityType,
        request.data.recordId,
        fileName,
        contentType,
        bytes,
        request.data.visibility,
        capturedAt,
      ]);
      const parsed = attachmentCreationRowSchema.safeParse(result.rows[0]);
      if (!parsed.success) throw new DocumentAccessUnavailableError();
      return parsed.data;
    });
  } catch (error) {
    if (error instanceof DocumentAccessUnavailableError) throw error;
    throw new DocumentAccessUnavailableError();
  }
}

export async function loadAuthorizedDocumentRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, allInvoices, allDeliveries, attachments] =
    await Promise.all([
      listAuthorizedRequests(actor),
      canAccess(actor, "view_invoices")
        ? listInvoices()
        : Promise.resolve([]),
      canAccess(actor, "view_deliveries")
        ? listDeliveries()
        : Promise.resolve([]),
      listAuthorizedAttachments(actor),
    ]);
  const requestIds = new Set(requests.map((request) => request.id));
  const requestLineIds = new Set(
    requests.flatMap((request) => request.lines.map((line) => line.id)),
  );
  const invoices = allInvoices.filter((invoice) => (
    requestIds.has(invoice.requestId)
  ));
  const deliveries = allDeliveries.filter((delivery) => (
    requestLineIds.has(delivery.requestLineId)
  ));

  return { requests, invoices, deliveries, attachments };
}

export const documentIsolationInternals = {
  MAX_ATTACHMENT_BYTES,
  attachmentAccessRowSchema,
  attachmentCreationRowSchema,
  attachmentDownloadRowSchema,
  creationInputSchema,
  documentRecordIdSchema,
  readLegacyAttachment,
  sanitizeAttachmentFileName,
};
import { recordAccountabilityAccessWithClient } from "@/lib/audit-accountability";

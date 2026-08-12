import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { readPersistentGeneratedDocument } from "./persistent-files";

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

interface JsonRow<T> extends QueryResultRow { value: T | null }

export interface GeneratedDocumentSummary {
  id: string;
  type: "APPROVED_REQUEST" | "FINAL_FULFILMENT_DELIVERY" | "SUPPLIER_PURCHASE_ORDER" | "FINAL_INVOICE";
  requestId: string;
  requestReference: string;
  supplierId?: string;
  supplierName?: string;
  version: number;
  status: string;
  fileName: string;
  checksum: string;
  pageCount: number;
  fileSize: number;
  templateVersion: number;
  generatorVersion: string;
  generatedAt: string;
  downloadUrl: string;
}

export interface DocumentGenerationJobSummary {
  id: string;
  type: string;
  requestId: string;
  requestReference: string;
  supplierName?: string;
  status: string;
  attempts: number;
  maximumAttempts: number;
  lastError?: string;
  availableAt: string;
  createdAt: string;
}

export interface SupplierPurchaseOrderSummary {
  id: string;
  documentId: string;
  requestId: string;
  requestReference: string;
  supplierId: string;
  supplierName: string;
  revision: number;
  state: string;
  version: number;
  recipientUserId?: string;
  recipientEmail?: string;
  warnings: string[];
  generatedAt: string;
  downloadUrl: string;
  canDispatch: boolean;
}

export interface GeneratedDocumentWorkspace {
  capturedAt: string;
  documents: GeneratedDocumentSummary[];
  jobs: DocumentGenerationJobSummary[];
  purchaseOrders: SupplierPurchaseOrderSummary[];
  supplierContacts: Array<{
    userId: string; supplierId: string; name: string; email: string;
  }>;
  enqueueFailures: Array<{
    id: string; requestId: string; requestReference: string;
    errorCode: string; errorSummary: string; createdAt: string;
  }>;
}

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("The document workspace is unavailable.");
  return actor.roleAssignmentId;
}

export async function getGeneratedDocumentWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return {
    capturedAt: new Date().toISOString(), documents: [], jobs: [],
    purchaseOrders: [], supplierContacts: [], enqueueFailures: [],
  } satisfies GeneratedDocumentWorkspace;
  const result = await query<JsonRow<GeneratedDocumentWorkspace>>(
    "SELECT public.axora_generated_document_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
  return result.rows[0]?.value ?? {
    capturedAt: new Date().toISOString(), documents: [], jobs: [],
    purchaseOrders: [], supplierContacts: [], enqueueFailures: [],
  };
}

export async function loadGeneratedDocumentFile(
  actor: AuthenticatedSessionUser,
  documentId: string,
) {
  const parsedId = uuid.safeParse(documentId);
  if (!parsedId.success || isDemoMode()) return null;
  const result = await query<{
    documentId: string; fileName: string; contentType: string;
    storagePath: string; checksumSha256: string; fileSizeBytes: string;
  }>(`SELECT document_id::text AS "documentId",file_name AS "fileName",
      content_type AS "contentType",storage_path AS "storagePath",
      checksum_sha256 AS "checksumSha256",file_size_bytes::text AS "fileSizeBytes"
    FROM public.axora_generated_document_download($1,$2,$3,$4)`, [
    actor.id, assignmentId(actor), parsedId.data, new Date(),
  ]);
  const file = result.rows[0];
  if (!file) return null;
  const bytes = await readPersistentGeneratedDocument(file.storagePath);
  if (!bytes || bytes.length !== Number(file.fileSizeBytes)
    || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || createHash("sha256").update(bytes).digest("hex") !== file.checksumSha256) {
    return null;
  }
  return { ...file, bytes };
}

export async function requestGeneratedDocumentVersion(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    documentId: uuid,
    expectedVersion: z.coerce.number().int().positive(),
    operation: z.enum(["REGENERATE", "CORRECT"]),
    reason,
    commandId: uuid,
  }).parse(input);
  return withAuditTransaction({
    actor, reason: parsed.reason, commandId: parsed.commandId,
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(
      "SELECT public.axora_request_document_regeneration($1,$2,$3,$4,$5,$6,$7,$8) AS value",
      [actor.id, assignmentId(actor), parsed.documentId, parsed.expectedVersion,
        parsed.operation, parsed.reason, parsed.commandId, new Date()],
    );
    if (!result.rows[0]?.value) throw new Error("The document command is unavailable.");
    return result.rows[0].value;
  });
}

export async function manageSupplierPurchaseOrder(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = z.object({
    documentId: uuid,
    expectedVersion: z.coerce.number().int().positive(),
    operation: z.enum([
      "MARK_READY", "APPROVE", "DISPATCH", "RESEND", "AMEND", "CANCEL",
    ]),
    recipientUserId: z.union([uuid, z.literal("")]).optional().default(""),
    reason: z.string().trim().max(500).optional().default(""),
    commandId: uuid,
  }).parse(input);
  if (["AMEND", "CANCEL"].includes(parsed.operation) && parsed.reason.length < 3) {
    throw new Error("A reason is required for this supplier order command.");
  }
  return withAuditTransaction({
    actor, reason: parsed.reason || parsed.operation, commandId: parsed.commandId,
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(
      "SELECT public.axora_manage_supplier_purchase_order($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value",
      [actor.id, assignmentId(actor), parsed.documentId, parsed.expectedVersion,
        parsed.operation, parsed.recipientUserId || null, parsed.reason,
        parsed.commandId, new Date()],
    );
    if (!result.rows[0]?.value) throw new Error("The supplier order command is unavailable.");
    return result.rows[0].value;
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supplierScopeBrand: unique symbol = Symbol("supplier-portal-scope");

export type SupplierMembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "ENDED";

export interface SupplierMembershipRecord {
  id: string;
  userId: string;
  supplierId: string;
  status: SupplierMembershipStatus;
}

export interface SupplierPortalScope {
  readonly userId: string;
  readonly supplierId: string;
  readonly membershipId: string;
  readonly [supplierScopeBrand]: true;
}

export interface SupplierPortalRfqRecord {
  id: string;
  companyId: string;
  supplierId: string;
  requestLineId: string;
  rfqReference: string;
  roundNumber: number;
  status: string;
  respondBy?: string | null;
  productName: string;
  specification?: string | null;
  quantity: number;
  unitOfMeasure: string;
}

export interface SupplierPortalQuotationRecord {
  id: string;
  rfqId: string;
  supplierId: string;
  responseVersion: number;
  responseStatus: "SUBMITTED" | "REVISED" | "WITHDRAWN";
  quotationReference: string;
  unitPrice: number;
  deliveryCharge: number;
  minimumOrderQuantity?: number | null;
  leadTimeDays?: number | null;
  validUntil?: string | null;
  availability?: SupplierAvailability | null;
  note?: string | null;
  submittedAt: string;
}

export const SUPPLIER_AVAILABILITIES = [
  "AVAILABLE",
  "PARTIAL",
  "MADE_TO_ORDER",
  "OUT_OF_STOCK",
] as const;

export type SupplierAvailability = (typeof SUPPLIER_AVAILABILITIES)[number];

const AVAILABILITY_PREFIX = "[[AXORA_AVAILABILITY:";

export function encodeSupplierQuotationNote(
  availability: SupplierAvailability,
  note?: string,
) {
  if (!SUPPLIER_AVAILABILITIES.includes(availability)) {
    throw new Error("Supplier availability is invalid.");
  }
  const cleaned = cleanOptionalNote(note);
  const encoded = `${AVAILABILITY_PREFIX}${availability}]]${cleaned ? `\n${cleaned}` : ""}`;
  if (encoded.length > 2_000) throw new Error("Supplier note is too long.");
  return encoded;
}

export function decodeSupplierQuotationNote(value?: string | null): {
  availability?: SupplierAvailability;
  note?: string;
} {
  const normalized = value?.trim();
  if (!normalized?.startsWith(AVAILABILITY_PREFIX)) {
    return normalized ? { note: normalized } : {};
  }
  const end = normalized.indexOf("]]", AVAILABILITY_PREFIX.length);
  if (end < 0) return { note: normalized };
  const availability = normalized.slice(AVAILABILITY_PREFIX.length, end);
  const note = normalized.slice(end + 2).trim();
  return {
    ...((SUPPLIER_AVAILABILITIES as readonly string[]).includes(availability)
      ? { availability: availability as SupplierAvailability }
      : {}),
    ...(note ? { note } : {}),
  };
}

export interface SupplierPortalDocumentRecord {
  id: string;
  rfqId: string;
  supplierId: string;
  documentVersion: number;
  documentKind: "RFQ" | "QUOTATION" | "ACKNOWLEDGEMENT" | "CLARIFICATION" | "SUPPORTING";
  fileName: string;
  contentType: string;
  sha256: string;
  supersedesDocumentId?: string | null;
  createdAt: string;
}

export interface SupplierPortalSnapshot {
  rfqs: SupplierPortalRfqRecord[];
  quotations: SupplierPortalQuotationRecord[];
  documents: SupplierPortalDocumentRecord[];
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertSupplierScope(scope: SupplierPortalScope) {
  if (scope[supplierScopeBrand] !== true) throw new Error("Supplier portal scope is invalid.");
}

export function resolveSupplierPortalScope(
  userId: string,
  supplierId: string,
  memberships: readonly SupplierMembershipRecord[],
): SupplierPortalScope {
  assertUuid(userId, "Supplier user id");
  assertUuid(supplierId, "Supplier id");
  const membership = memberships.find((candidate) => (
    candidate.userId === userId
      && candidate.supplierId === supplierId
      && candidate.status === "ACTIVE"
  ));
  if (!membership) throw new Error("An active supplier membership is required.");
  assertUuid(membership.id, "Supplier membership id");
  return Object.freeze({
    userId,
    supplierId,
    membershipId: membership.id,
    [supplierScopeBrand]: true as const,
  });
}

export function buildSupplierPortalSnapshot(
  scope: SupplierPortalScope,
  input: {
    rfqs: readonly SupplierPortalRfqRecord[];
    quotations: readonly SupplierPortalQuotationRecord[];
    documents: readonly SupplierPortalDocumentRecord[];
  },
): SupplierPortalSnapshot {
  assertSupplierScope(scope);
  const rfqs = input.rfqs
    .filter((rfq) => rfq.supplierId === scope.supplierId)
    .map((rfq) => ({
      id: rfq.id,
      companyId: rfq.companyId,
      supplierId: rfq.supplierId,
      requestLineId: rfq.requestLineId,
      rfqReference: rfq.rfqReference,
      roundNumber: rfq.roundNumber,
      status: rfq.status,
      ...(rfq.respondBy !== undefined ? { respondBy: rfq.respondBy } : {}),
      productName: rfq.productName,
      ...(rfq.specification !== undefined ? { specification: rfq.specification } : {}),
      quantity: rfq.quantity,
      unitOfMeasure: rfq.unitOfMeasure,
    }));
  const visibleRfqIds = new Set(rfqs.map((rfq) => rfq.id));
  const quotations = input.quotations
    .filter((quotation) => (
      quotation.supplierId === scope.supplierId
        && visibleRfqIds.has(quotation.rfqId)
    ))
    .map((quotation) => ({
      id: quotation.id,
      rfqId: quotation.rfqId,
      supplierId: quotation.supplierId,
      responseVersion: quotation.responseVersion,
      responseStatus: quotation.responseStatus,
      quotationReference: quotation.quotationReference,
      unitPrice: quotation.unitPrice,
      deliveryCharge: quotation.deliveryCharge,
      ...(quotation.minimumOrderQuantity !== undefined
        ? { minimumOrderQuantity: quotation.minimumOrderQuantity }
        : {}),
      ...(quotation.leadTimeDays !== undefined ? { leadTimeDays: quotation.leadTimeDays } : {}),
      ...(quotation.validUntil !== undefined ? { validUntil: quotation.validUntil } : {}),
      ...(quotation.availability !== undefined ? { availability: quotation.availability } : {}),
      ...(quotation.note !== undefined ? { note: quotation.note } : {}),
      submittedAt: quotation.submittedAt,
    }));
  const documents = input.documents
    .filter((document) => (
      document.supplierId === scope.supplierId
        && visibleRfqIds.has(document.rfqId)
    ))
    .map((document) => ({
      id: document.id,
      rfqId: document.rfqId,
      supplierId: document.supplierId,
      documentVersion: document.documentVersion,
      documentKind: document.documentKind,
      fileName: document.fileName,
      contentType: document.contentType,
      sha256: document.sha256,
      ...(document.supersedesDocumentId !== undefined
        ? { supersedesDocumentId: document.supersedesDocumentId }
        : {}),
      createdAt: document.createdAt,
    }));
  return {
    rfqs: [...rfqs].sort((left, right) => (
      left.rfqReference.localeCompare(right.rfqReference)
    )),
    quotations: [...quotations].sort((left, right) => (
      left.rfqId.localeCompare(right.rfqId)
        || right.responseVersion - left.responseVersion
    )),
    documents: [...documents].sort((left, right) => (
      left.rfqId.localeCompare(right.rfqId)
        || left.documentKind.localeCompare(right.documentKind)
        || right.documentVersion - left.documentVersion
    )),
  };
}

export type SupplierAcknowledgement =
  | "ACKNOWLEDGED"
  | "DECLINED"
  | "CLARIFICATION_REQUESTED";

export interface SupplierAcknowledgementDraft {
  rfqId: string;
  supplierId: string;
  supplierMembershipId: string;
  acknowledgedBy: string;
  acknowledgement: SupplierAcknowledgement;
  note?: string;
  clientEventId: string;
  acknowledgedAt: string;
}

function cleanOptionalNote(note: string | undefined) {
  if (note === undefined) return undefined;
  const normalized = note.trim();
  if (normalized.length > 2_000) throw new Error("Supplier note is too long.");
  return normalized || undefined;
}

export function buildSupplierAcknowledgement(
  scope: SupplierPortalScope,
  input: {
    rfqId: string;
    acknowledgement: SupplierAcknowledgement;
    note?: string;
    clientEventId: string;
    acknowledgedAt?: Date | string;
  },
): SupplierAcknowledgementDraft {
  assertSupplierScope(scope);
  assertUuid(input.rfqId, "RFQ id");
  assertUuid(input.clientEventId, "Client event id");
  if (!["ACKNOWLEDGED", "DECLINED", "CLARIFICATION_REQUESTED"].includes(input.acknowledgement)) {
    throw new Error("Supplier acknowledgement is invalid.");
  }
  const acknowledgedAt = new Date(input.acknowledgedAt ?? new Date());
  if (Number.isNaN(acknowledgedAt.getTime())) {
    throw new Error("Supplier acknowledgement time is invalid.");
  }
  const note = cleanOptionalNote(input.note);
  return {
    rfqId: input.rfqId,
    supplierId: scope.supplierId,
    supplierMembershipId: scope.membershipId,
    acknowledgedBy: scope.userId,
    acknowledgement: input.acknowledgement,
    ...(note ? { note } : {}),
    clientEventId: input.clientEventId,
    acknowledgedAt: acknowledgedAt.toISOString(),
  };
}

export interface SupplierQuotationDraft {
  rfqId: string;
  supplierId: string;
  supplierMembershipId: string;
  submittedBy: string;
  responseVersion: number;
  responseStatus: "SUBMITTED" | "REVISED" | "WITHDRAWN";
  quotationReference: string;
  unitPrice: number;
  deliveryCharge: number;
  minimumOrderQuantity?: number;
  leadTimeDays?: number;
  validUntil?: string;
  availability: SupplierAvailability;
  note?: string;
  clientEventId: string;
  submittedAt: string;
}

function finiteNonNegative(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`);
}

export function buildSupplierQuotation(
  scope: SupplierPortalScope,
  input: Omit<
    SupplierQuotationDraft,
    "supplierId" | "supplierMembershipId" | "submittedBy" | "submittedAt" | "note"
  > & { submittedAt?: Date | string; note?: string },
): SupplierQuotationDraft {
  assertSupplierScope(scope);
  assertUuid(input.rfqId, "RFQ id");
  assertUuid(input.clientEventId, "Client event id");
  if (!["SUBMITTED", "REVISED", "WITHDRAWN"].includes(input.responseStatus)) {
    throw new Error("Quotation response status is invalid.");
  }
  if (!Number.isSafeInteger(input.responseVersion) || input.responseVersion < 1) {
    throw new Error("Quotation response version must be a positive integer.");
  }
  const quotationReference = input.quotationReference.trim();
  if (!quotationReference || quotationReference.length > 120) {
    throw new Error("Quotation reference is invalid.");
  }
  finiteNonNegative(input.unitPrice, "Quotation unit price");
  finiteNonNegative(input.deliveryCharge, "Quotation delivery charge");
  if (input.minimumOrderQuantity !== undefined) {
    finiteNonNegative(input.minimumOrderQuantity, "Minimum order quantity");
  }
  if (input.leadTimeDays !== undefined
    && (!Number.isSafeInteger(input.leadTimeDays) || input.leadTimeDays < 0)) {
    throw new Error("Lead time must be a non-negative number of days.");
  }
  if (input.validUntil !== undefined
    && (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)
      || Number.isNaN(new Date(`${input.validUntil}T00:00:00.000Z`).getTime()))) {
    throw new Error("Quotation validity date is invalid.");
  }
  if (!SUPPLIER_AVAILABILITIES.includes(input.availability)) {
    throw new Error("Supplier availability is invalid.");
  }
  const submittedAt = new Date(input.submittedAt ?? new Date());
  if (Number.isNaN(submittedAt.getTime())) throw new Error("Quotation submission time is invalid.");
  const note = cleanOptionalNote(input.note);
  return {
    rfqId: input.rfqId,
    responseVersion: input.responseVersion,
    responseStatus: input.responseStatus,
    quotationReference,
    unitPrice: input.unitPrice,
    deliveryCharge: input.deliveryCharge,
    ...(input.minimumOrderQuantity !== undefined
      ? { minimumOrderQuantity: input.minimumOrderQuantity }
      : {}),
    ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
    ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    availability: input.availability,
    clientEventId: input.clientEventId,
    supplierId: scope.supplierId,
    supplierMembershipId: scope.membershipId,
    submittedBy: scope.userId,
    submittedAt: submittedAt.toISOString(),
    ...(note ? { note } : {}),
  };
}

export function supplierDocumentHistory(
  scope: SupplierPortalScope,
  rfqId: string,
  documents: readonly SupplierPortalDocumentRecord[],
) {
  assertSupplierScope(scope);
  return documents
    .filter((document) => (
      document.rfqId === rfqId && document.supplierId === scope.supplierId
    ))
    .map((document) => ({
      id: document.id,
      rfqId: document.rfqId,
      supplierId: document.supplierId,
      documentVersion: document.documentVersion,
      documentKind: document.documentKind,
      fileName: document.fileName,
      contentType: document.contentType,
      sha256: document.sha256,
      ...(document.supersedesDocumentId !== undefined
        ? { supersedesDocumentId: document.supersedesDocumentId }
        : {}),
      createdAt: document.createdAt,
    }))
    .sort((left, right) => (
      left.documentKind.localeCompare(right.documentKind)
        || left.documentVersion - right.documentVersion
    ));
}

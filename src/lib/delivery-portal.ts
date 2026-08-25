import type { WorkflowMetadata } from "./workflow-events";
import { validateWorkflowMetadata } from "./workflow-events";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const driverScopeBrand: unique symbol = Symbol("delivery-driver-scope");
const MAX_DEVICE_CLOCK_AHEAD_MS = 5 * 60_000;

export interface DeliveryDriverProfile {
  userId: string;
  active: boolean;
}

export interface DeliveryDriverScope {
  readonly driverUserId: string;
  readonly [driverScopeBrand]: true;
}

export type DeliveryJobStatus =
  | "CREATED"
  | "ASSIGNED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED";

export interface DeliveryJobRecord {
  id: string;
  companyId: string;
  branchId: string;
  jobCode: string;
  status: DeliveryJobStatus;
  scheduledWindowStart?: string | null;
  scheduledWindowEnd?: string | null;
  deliveryAddress: string;
}

export type DeliveryAssignmentStatus =
  | "ASSIGNED"
  | "ACCEPTED"
  | "REJECTED"
  | "REASSIGNED"
  | "CANCELLED"
  | "COMPLETED";

export interface DeliveryAssignmentRecord {
  id: string;
  deliveryJobId: string;
  driverUserId: string;
  status: DeliveryAssignmentStatus;
  assignedAt: string;
  endedAt?: string | null;
}

export type DeliveryClientEventType =
  | "ACCEPTED"
  | "REJECTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "DELIVERY_ATTEMPTED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "FAILED"
  | "ISSUE_REPORTED"
  | "NOTE_ADDED";

export const DELIVERY_ISSUE_CODES = [
  "CUSTOMER_UNAVAILABLE",
  "ACCESS_BLOCKED",
  "ADDRESS_PROBLEM",
  "DAMAGED_ITEMS",
  "MISSING_ITEMS",
  "VEHICLE_PROBLEM",
  "SAFETY_CONCERN",
  "OTHER",
] as const;

export type DeliveryIssueCode = typeof DELIVERY_ISSUE_CODES[number];

export interface DriverReportedLineOutcome {
  deliveryJobLineId: string;
  deliveredQuantity: number;
  damagedQuantity: number;
  missingQuantity: number;
}

export interface DeliveryEventDetails {
  note?: string;
  issueCode?: DeliveryIssueCode;
  /** The name reported by the driver at handover. This is evidence, not receipt authority. */
  receiverName?: string;
  /** Driver-observed quantities. Customer receiving remains independently authoritative. */
  lineOutcomes?: DriverReportedLineOutcome[];
}

export interface DeliveryExpectedLine {
  id: string;
  plannedQuantity: number;
}

export type DeliveryProgressStatus = DeliveryJobStatus
  | "REJECTED"
  | "DELIVERY_ATTEMPTED"
  | "PARTIALLY_DELIVERED";

export interface DeliveryClientEvent {
  companyId: string;
  deliveryJobId: string;
  assignmentId: string;
  driverUserId: string;
  deviceId: string;
  clientEventId: string;
  deviceSequence: number;
  eventType: DeliveryClientEventType;
  clientRecordedAt: string;
  metadata: WorkflowMetadata;
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedText(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length < minimum || normalized.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function reportedQuantity(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    throw new Error(`${label} must be a bounded non-negative number.`);
  }
  const rounded = Math.round(value * 1_000) / 1_000;
  if (Math.abs(value - rounded) >= 0.000_5) {
    throw new Error(`${label} supports at most three decimal places.`);
  }
  return rounded;
}

function closeQuantity(left: number, right: number) {
  return Math.abs(left - right) < 0.000_5;
}

function normalizeLineOutcomes(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("Delivery Agent-reported delivery quantities are invalid.");
  }
  const seen = new Set<string>();
  return value.map((candidate) => {
    if (!isPlainRecord(candidate)
      || Object.keys(candidate).some((key) => ![
        "deliveryJobLineId", "deliveredQuantity", "damagedQuantity", "missingQuantity",
      ].includes(key))) {
      throw new Error("Delivery Agent-reported delivery quantities are invalid.");
    }
    const deliveryJobLineId = String(candidate.deliveryJobLineId ?? "");
    assertUuid(deliveryJobLineId, "Delivery job line id");
    if (seen.has(deliveryJobLineId)) throw new Error("A delivery line may be reported only once.");
    seen.add(deliveryJobLineId);
    const deliveredQuantity = reportedQuantity(candidate.deliveredQuantity, "Delivered quantity");
    const damagedQuantity = reportedQuantity(candidate.damagedQuantity, "Damaged quantity");
    const missingQuantity = reportedQuantity(candidate.missingQuantity, "Missing quantity");
    if (damagedQuantity > deliveredQuantity) {
      throw new Error("Delivery Agent-reported damaged quantity cannot exceed delivered quantity.");
    }
    return { deliveryJobLineId, deliveredQuantity, damagedQuantity, missingQuantity };
  });
}

export function validateDeliveryEventDetails(
  eventType: DeliveryClientEventType,
  value: unknown,
  expectedLines?: readonly DeliveryExpectedLine[],
): DeliveryEventDetails {
  if (value === undefined || value === null) value = {};
  if (!isPlainRecord(value)
    || Object.keys(value).some((key) => ![
      "note", "issueCode", "receiverName", "lineOutcomes",
    ].includes(key))) {
    throw new Error("Delivery event details are invalid.");
  }
  const details: DeliveryEventDetails = {};
  if (value.note !== undefined) details.note = boundedText(value.note, "Delivery note", 1, 1_000);
  if (value.issueCode !== undefined) {
    if (typeof value.issueCode !== "string"
      || !DELIVERY_ISSUE_CODES.includes(value.issueCode as DeliveryIssueCode)) {
      throw new Error("Delivery issue reason is invalid.");
    }
    details.issueCode = value.issueCode as DeliveryIssueCode;
  }
  if (value.receiverName !== undefined) {
    details.receiverName = boundedText(value.receiverName, "Delivery Agent-reported receiver name", 2, 200);
  }
  if (value.lineOutcomes !== undefined) details.lineOutcomes = normalizeLineOutcomes(value.lineOutcomes);

  const issueEvent = eventType === "DELIVERY_ATTEMPTED" || eventType === "ISSUE_REPORTED";
  const outcomeEvent = eventType === "DELIVERED" || eventType === "PARTIALLY_DELIVERED";
  if (issueEvent && !details.issueCode) throw new Error("Choose a delivery issue reason.");
  if (eventType === "ISSUE_REPORTED" && (!details.note || details.note.length < 3)) {
    throw new Error("Describe the delivery issue.");
  }
  if (eventType === "NOTE_ADDED" && !details.note) throw new Error("A Delivery Agent note is required.");
  if (!issueEvent && eventType !== "FAILED" && details.issueCode) {
    throw new Error("An issue reason is not valid for this delivery event.");
  }
  if (!outcomeEvent && (details.receiverName || details.lineOutcomes)) {
    throw new Error("Handover evidence is valid only for a delivery outcome.");
  }
  if (eventType === "PARTIALLY_DELIVERED" && (!details.receiverName || !details.lineOutcomes)) {
    throw new Error("A partial delivery requires the handover name and every line quantity.");
  }
  if (outcomeEvent && Boolean(details.receiverName) !== Boolean(details.lineOutcomes)) {
    throw new Error("Handover name and Delivery Agent-reported line quantities must be recorded together.");
  }

  if (details.lineOutcomes && expectedLines) {
    if (details.lineOutcomes.length !== expectedLines.length || expectedLines.length === 0) {
      throw new Error("Report every delivery line exactly once.");
    }
    const expected = new Map(expectedLines.map((line) => {
      assertUuid(line.id, "Expected delivery job line id");
      return [line.id, reportedQuantity(line.plannedQuantity, "Planned quantity")] as const;
    }));
    let incomplete = false;
    for (const outcome of details.lineOutcomes) {
      const planned = expected.get(outcome.deliveryJobLineId);
      if (planned === undefined) throw new Error("A reported delivery line is not part of this job.");
      if (!closeQuantity(outcome.deliveredQuantity + outcome.missingQuantity, planned)) {
        throw new Error("Delivered and missing quantities must equal the planned line quantity.");
      }
      if (outcome.missingQuantity > 0) incomplete = true;
    }
    if (eventType === "DELIVERED" && incomplete) {
      throw new Error("Use partial delivery when any planned quantity is missing.");
    }
    if (eventType === "PARTIALLY_DELIVERED" && !incomplete) {
      throw new Error("A partial delivery must include a missing quantity.");
    }
  }
  return details;
}

export function deliveryEventMetadata(
  eventType: DeliveryClientEventType,
  value: unknown,
  expectedLines?: readonly DeliveryExpectedLine[],
): WorkflowMetadata {
  const details = validateDeliveryEventDetails(eventType, value, expectedLines);
  const metadata: WorkflowMetadata = {};
  if (details.note) metadata.note = details.note;
  if (details.issueCode) metadata.issueCode = details.issueCode;
  if (details.receiverName) metadata.receiverName = details.receiverName;
  if (details.lineOutcomes) {
    metadata.lineOutcomes = details.lineOutcomes.map((line) => ({
      deliveryJobLineId: line.deliveryJobLineId,
      deliveredQuantity: line.deliveredQuantity,
      damagedQuantity: line.damagedQuantity,
      missingQuantity: line.missingQuantity,
    }));
  }
  return validateWorkflowMetadata(metadata);
}

const STATE_CHANGING_DRIVER_EVENTS = new Set<DeliveryClientEventType>([
  "ACCEPTED", "REJECTED", "EN_ROUTE", "ARRIVED", "DELIVERY_ATTEMPTED",
  "PARTIALLY_DELIVERED", "DELIVERED", "FAILED",
]);

export function isStateChangingDriverEvent(eventType: DeliveryClientEventType) {
  return STATE_CHANGING_DRIVER_EVENTS.has(eventType);
}

export function canRecordDriverEvent(
  current: DeliveryProgressStatus,
  eventType: DeliveryClientEventType,
) {
  if (eventType === "NOTE_ADDED" || eventType === "ISSUE_REPORTED") {
    return !["REJECTED", "PARTIALLY_DELIVERED", "DELIVERED", "FAILED", "CANCELLED"].includes(current);
  }
  const allowed: Partial<Record<DeliveryProgressStatus, readonly DeliveryClientEventType[]>> = {
    ASSIGNED: ["ACCEPTED", "REJECTED"],
    ACCEPTED: ["EN_ROUTE", "REJECTED"],
    EN_ROUTE: ["ARRIVED", "FAILED"],
    ARRIVED: ["DELIVERY_ATTEMPTED", "PARTIALLY_DELIVERED", "DELIVERED", "FAILED"],
    DELIVERY_ATTEMPTED: ["EN_ROUTE", "ARRIVED", "FAILED"],
  };
  return allowed[current]?.includes(eventType) ?? false;
}

export function assertDriverEventTransition(
  current: DeliveryProgressStatus,
  eventType: DeliveryClientEventType,
) {
  if (!canRecordDriverEvent(current, eventType)) {
    throw new Error(`Delivery event ${eventType} cannot follow ${current}.`);
  }
}

export function buildDeliveryNavigationUrl(address: string) {
  const destination = boundedText(address, "Delivery address", 3, 1_000);
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", destination);
  return url.toString();
}

export function resolveDeliveryDriverScope(
  userId: string,
  profile: DeliveryDriverProfile | undefined,
): DeliveryDriverScope {
  assertUuid(userId, "Delivery Agent user id");
  if (!profile || profile.userId !== userId || !profile.active) {
    throw new Error("An active Delivery Agent profile is required.");
  }
  return Object.freeze({ driverUserId: userId, [driverScopeBrand]: true as const });
}

export function visibleDeliveryJobs(
  scope: DeliveryDriverScope,
  jobs: readonly DeliveryJobRecord[],
  assignments: readonly DeliveryAssignmentRecord[],
) {
  const assignedJobIds = new Set(assignments
    .filter((assignment) => (
      assignment.driverUserId === scope.driverUserId
        && assignment.status !== "REASSIGNED"
        && assignment.status !== "CANCELLED"
    ))
    .map((assignment) => assignment.deliveryJobId));
  return jobs.filter((job) => assignedJobIds.has(job.id));
}

function assignmentForEvent(
  scope: DeliveryDriverScope,
  assignment: DeliveryAssignmentRecord,
  deliveryJobId: string,
  clientRecordedAt: Date,
) {
  if (assignment.driverUserId !== scope.driverUserId
    || assignment.deliveryJobId !== deliveryJobId) {
    throw new Error("A Delivery Agent may only record events for their own assignment.");
  }
  const assignedAt = new Date(assignment.assignedAt);
  const endedAt = assignment.endedAt ? new Date(assignment.endedAt) : null;
  if (Number.isNaN(assignedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) {
    throw new Error("Delivery assignment time is invalid.");
  }
  if (clientRecordedAt.getTime() < assignedAt.getTime() - 5 * 60_000
    || (endedAt && clientRecordedAt.getTime() > endedAt.getTime() + 15 * 60_000)) {
    throw new Error("Delivery event is outside the Delivery Agent assignment window.");
  }
}

export function buildDeliveryClientEvent(
  scope: DeliveryDriverScope,
  assignment: DeliveryAssignmentRecord,
  input: Omit<DeliveryClientEvent, "assignmentId" | "driverUserId" | "clientRecordedAt" | "metadata"> & {
    clientRecordedAt?: Date | string;
    metadata?: WorkflowMetadata;
  },
): DeliveryClientEvent {
  assertUuid(input.companyId, "Delivery company id");
  assertUuid(input.deliveryJobId, "Delivery job id");
  assertUuid(input.deviceId, "Delivery device id");
  assertUuid(input.clientEventId, "Delivery client event id");
  if (!Number.isSafeInteger(input.deviceSequence) || input.deviceSequence < 0) {
    throw new Error("Delivery device sequence must be a non-negative integer.");
  }
  const clientRecordedAt = new Date(input.clientRecordedAt ?? new Date());
  if (Number.isNaN(clientRecordedAt.getTime())) {
    throw new Error("Delivery client event time is invalid.");
  }
  if (clientRecordedAt.getTime() > Date.now() + MAX_DEVICE_CLOCK_AHEAD_MS) {
    throw new Error("The delivery device clock is too far ahead.");
  }
  assignmentForEvent(scope, assignment, input.deliveryJobId, clientRecordedAt);
  return {
    companyId: input.companyId,
    deliveryJobId: input.deliveryJobId,
    assignmentId: assignment.id,
    driverUserId: scope.driverUserId,
    deviceId: input.deviceId,
    clientEventId: input.clientEventId,
    deviceSequence: input.deviceSequence,
    eventType: input.eventType,
    clientRecordedAt: clientRecordedAt.toISOString(),
    metadata: validateWorkflowMetadata(input.metadata ?? {}),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function eventFingerprint(event: DeliveryClientEvent) {
  return stableJson([
    event.companyId,
    event.deliveryJobId,
    event.assignmentId,
    event.driverUserId,
    event.deviceId,
    event.clientEventId,
    event.deviceSequence,
    event.eventType,
    event.clientRecordedAt,
    event.metadata,
  ]);
}

export function reconcileDeliveryEvents(
  localEvents: readonly DeliveryClientEvent[],
  serverEvents: readonly DeliveryClientEvent[],
) {
  const byClientId = new Map<string, DeliveryClientEvent>();
  const serverKeys = new Set<string>();
  for (const [source, events] of [["server", serverEvents], ["local", localEvents]] as const) {
    for (const event of events) {
      const key = `${event.driverUserId}:${event.clientEventId}`;
      const existing = byClientId.get(key);
      if (existing && eventFingerprint(existing) !== eventFingerprint(event)) {
        throw new Error("Conflicting delivery events reuse the same client event id.");
      }
      if (!existing) byClientId.set(key, event);
      if (source === "server") serverKeys.add(key);
    }
  }
  const timeline = [...byClientId.values()].sort((left, right) => (
    left.deviceSequence - right.deviceSequence
      || new Date(left.clientRecordedAt).getTime() - new Date(right.clientRecordedAt).getTime()
      || left.clientEventId.localeCompare(right.clientEventId)
  ));
  return {
    timeline,
    pending: timeline.filter((event) => (
      !serverKeys.has(`${event.driverUserId}:${event.clientEventId}`)
    )),
  };
}

export function deliveryStatusFromEvents(
  initialStatus: DeliveryJobStatus,
  events: readonly DeliveryClientEvent[],
): DeliveryProgressStatus {
  const ordered = [...events].sort((left, right) => (
    left.deviceSequence - right.deviceSequence
      || new Date(left.clientRecordedAt).getTime() - new Date(right.clientRecordedAt).getTime()
  ));
  let status: DeliveryProgressStatus = initialStatus;
  const stage: Partial<Record<DeliveryProgressStatus, number>> = {
    CREATED: 0,
    ASSIGNED: 1,
    ACCEPTED: 2,
    EN_ROUTE: 3,
    ARRIVED: 4,
    DELIVERY_ATTEMPTED: 5,
  };
  for (const event of ordered) {
    if (status === "REJECTED" || status === "PARTIALLY_DELIVERED" || status === "DELIVERED" || status === "FAILED" || status === "CANCELLED") break;
    let candidate: DeliveryProgressStatus | undefined;
    switch (event.eventType) {
      case "ACCEPTED": candidate = "ACCEPTED"; break;
      case "REJECTED": candidate = "REJECTED"; break;
      case "EN_ROUTE": candidate = "EN_ROUTE"; break;
      case "ARRIVED": candidate = "ARRIVED"; break;
      case "DELIVERY_ATTEMPTED": candidate = "DELIVERY_ATTEMPTED"; break;
      case "PARTIALLY_DELIVERED": candidate = "PARTIALLY_DELIVERED"; break;
      case "DELIVERED": candidate = "DELIVERED"; break;
      case "FAILED": candidate = "FAILED"; break;
      case "ISSUE_REPORTED": break;
      case "NOTE_ADDED": break;
    }
    if (candidate === "REJECTED" || candidate === "PARTIALLY_DELIVERED" || candidate === "DELIVERED" || candidate === "FAILED") status = candidate;
    else if (status === "DELIVERY_ATTEMPTED" && (candidate === "EN_ROUTE" || candidate === "ARRIVED")) status = candidate;
    else if (candidate && (stage[candidate] ?? -1) >= (stage[status] ?? -1)) status = candidate;
  }
  return status;
}

export type DriverEvidenceType = "PHOTO" | "SIGNATURE" | "DELIVERY_NOTE" | "LOCATION";

export type DriverEvidenceDraft = {
  deliveryJobId: string;
  deliveryJobEventId: string;
  driverUserId: string;
  clientEvidenceId: string;
  evidenceType: DriverEvidenceType;
  capturedAt: string;
  metadata: WorkflowMetadata;
} & ({
  evidenceType: "LOCATION";
} | {
  evidenceType: Exclude<DriverEvidenceType, "LOCATION">;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  storagePath: string;
  sha256: string;
});

export type BuildDriverEvidenceInput = {
  deliveryJobEventId: string;
  clientEvidenceId: string;
  capturedAt?: Date | string;
  metadata?: WorkflowMetadata;
} & ({
  evidenceType: "LOCATION";
} | {
  evidenceType: Exclude<DriverEvidenceType, "LOCATION">;
  fileName: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp";
  storagePath: string;
  sha256: string;
});

export function buildDriverEvidence(
  scope: DeliveryDriverScope,
  event: DeliveryClientEvent,
  input: BuildDriverEvidenceInput,
): DriverEvidenceDraft {
  if (event.driverUserId !== scope.driverUserId) {
    throw new Error("Delivery Agent evidence must belong to the Delivery Agent's own event.");
  }
  assertUuid(input.deliveryJobEventId, "Delivery job event id");
  assertUuid(input.clientEvidenceId, "Client evidence id");
  const capturedAt = new Date(input.capturedAt ?? event.clientRecordedAt);
  if (Number.isNaN(capturedAt.getTime())) throw new Error("Evidence capture time is invalid.");
  if (input.evidenceType !== "LOCATION") {
    if (!input.fileName.trim() || input.fileName.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(input.fileName)) {
      throw new Error("Evidence file name is invalid.");
    }
    if (!/^delivery-evidence\/[A-Za-z0-9._/-]+$/.test(input.storagePath)
      || /(^|\/)\.\.(\/|$)/.test(input.storagePath)
      || !/^[0-9a-f]{64}$/.test(input.sha256)) {
      throw new Error("Evidence storage metadata is invalid.");
    }
  }
  return {
    ...input,
    deliveryJobId: event.deliveryJobId,
    deliveryJobEventId: input.deliveryJobEventId,
    driverUserId: scope.driverUserId,
    capturedAt: capturedAt.toISOString(),
    metadata: validateWorkflowMetadata(input.metadata ?? {}),
  } as DriverEvidenceDraft;
}

import {
  validateDeliveryEventDetails,
  type DeliveryClientEventType,
  type DeliveryIssueCode,
  type DriverReportedLineOutcome,
} from "./delivery-portal";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_QUEUE_EVENTS = 500;
const MAX_QUEUE_STORAGE_BYTES = 2_000_000;
const QUEUE_SCHEMA = "axora.driver-offline-events";
const QUEUE_SCHEMA_VERSION = 1;
const QUEUE_ENVELOPE_KEYS = new Set(["schema", "version", "driverId", "events"]);
const EVENT_KEYS = new Set([
  "deliveryJobId",
  "assignmentId",
  "deviceId",
  "clientEventId",
  "deviceSequence",
  "eventType",
  "clientRecordedAt",
  "note",
  "issueCode",
  "receiverName",
  "lineOutcomes",
]);

export const DRIVER_EVENT_TYPES = [
  "ACCEPTED",
  "REJECTED",
  "EN_ROUTE",
  "ARRIVED",
  "DELIVERY_ATTEMPTED",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "FAILED",
  "ISSUE_REPORTED",
  "NOTE_ADDED",
] as const satisfies readonly DeliveryClientEventType[];

export interface DriverOfflineEvent {
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
}

export type DriverQueueRecoveryReason =
  | "CORRUPT_JSON"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_VERSION"
  | "DRIVER_SCOPE_MISMATCH"
  | "INVALID_EVENT"
  | "CONFLICTING_EVENT_ID"
  | "QUEUE_LIMIT_EXCEEDED"
  | "STORAGE_LIMIT_EXCEEDED";

export type DriverOfflineQueueInspection =
  | {
    status: "ready";
    events: DriverOfflineEvent[];
    format: "empty" | "legacy" | "envelope";
  }
  | {
    status: "recovery-required";
    events: DriverOfflineEvent[];
    raw: string;
    reason: DriverQueueRecoveryReason;
    totalEventCount?: number;
  };

interface PersistedDriverQueue {
  schema: typeof QUEUE_SCHEMA;
  version: typeof QUEUE_SCHEMA_VERSION;
  driverId: string;
  events: DriverOfflineEvent[];
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function scopedStorageKey(actorId: string, suffix: string) {
  if (!isUuid(actorId)) throw new Error("Driver identity is invalid.");
  return `axora:driver:${actorId}:${suffix}:v1`;
}

export function driverQueueStorageKey(actorId: string) {
  return scopedStorageKey(actorId, "event-queue");
}

export function driverDeviceStorageKey(actorId: string) {
  return scopedStorageKey(actorId, "device-id");
}

export function driverSequenceStorageKey(actorId: string) {
  return scopedStorageKey(actorId, "device-sequence");
}

function normalizedEvent(value: unknown): DriverOfflineEvent | undefined {
  if (!isPlainRecord(value) || Object.keys(value).some((key) => !EVENT_KEYS.has(key))) return undefined;
  const event = value;
  if (!isUuid(event.deliveryJobId) || !isUuid(event.assignmentId)
    || !isUuid(event.deviceId) || !isUuid(event.clientEventId)
    || !Number.isSafeInteger(event.deviceSequence) || Number(event.deviceSequence) < 0
    || !DRIVER_EVENT_TYPES.includes(event.eventType as DeliveryClientEventType)
    || typeof event.clientRecordedAt !== "string"
    || Number.isNaN(new Date(event.clientRecordedAt).getTime())) return undefined;
  try {
    const details = validateDeliveryEventDetails(event.eventType as DeliveryClientEventType, {
      ...(event.note !== undefined ? { note: event.note } : {}),
      ...(event.issueCode !== undefined ? { issueCode: event.issueCode } : {}),
      ...(event.receiverName !== undefined ? { receiverName: event.receiverName } : {}),
      ...(event.lineOutcomes !== undefined ? { lineOutcomes: event.lineOutcomes } : {}),
    });
    return {
      deliveryJobId: event.deliveryJobId,
      assignmentId: event.assignmentId,
      deviceId: event.deviceId,
      clientEventId: event.clientEventId,
      deviceSequence: Number(event.deviceSequence),
      eventType: event.eventType as DeliveryClientEventType,
      clientRecordedAt: new Date(event.clientRecordedAt).toISOString(),
      ...details,
    };
  } catch {
    return undefined;
  }
}

function fingerprint(event: DriverOfflineEvent) {
  return JSON.stringify([
    event.deliveryJobId,
    event.assignmentId,
    event.deviceId,
    event.clientEventId,
    event.deviceSequence,
    event.eventType,
    event.clientRecordedAt,
    event.note ?? null,
    event.issueCode ?? null,
    event.receiverName ?? null,
    event.lineOutcomes ?? null,
  ]);
}

function inspectEvents(raw: string, values: unknown[]): DriverOfflineQueueInspection {
  if (values.length > MAX_QUEUE_EVENTS) {
    return {
      status: "recovery-required",
      events: [],
      raw,
      reason: "QUEUE_LIMIT_EXCEEDED",
      totalEventCount: values.length,
    };
  }

  const events: DriverOfflineEvent[] = [];
  const byClientId = new Map<string, string>();
  let hasInvalidEvent = false;
  let hasConflict = false;
  for (const value of values) {
    const event = normalizedEvent(value);
    if (!event) {
      hasInvalidEvent = true;
      continue;
    }
    const current = fingerprint(event);
    const prior = byClientId.get(event.clientEventId);
    if (prior !== undefined) {
      // Even an exact duplicate is quarantined. Silently de-duplicating a
      // persisted queue would rewrite information the driver may need to
      // recover or explain to support.
      hasConflict = true;
      continue;
    }
    byClientId.set(event.clientEventId, current);
    events.push(event);
  }

  events.sort((left, right) => (
    left.deviceSequence - right.deviceSequence
      || left.clientRecordedAt.localeCompare(right.clientRecordedAt)
  ));

  if (hasConflict || hasInvalidEvent) {
    return {
      status: "recovery-required",
      events,
      raw,
      reason: hasConflict ? "CONFLICTING_EVENT_ID" : "INVALID_EVENT",
      totalEventCount: values.length,
    };
  }
  return { status: "ready", events, format: "legacy" };
}

/**
 * Validates the complete persisted queue. A partially valid queue is never
 * treated as ready: the original raw value remains untouched until the driver
 * retries, exports it for recovery, or explicitly confirms removal.
 */
export function parseDriverOfflineQueue(
  raw: string | null,
  actorId: string,
): DriverOfflineQueueInspection {
  if (!isUuid(actorId)) throw new Error("Driver identity is invalid.");
  if (raw === null) return { status: "ready", events: [], format: "empty" };
  if (new TextEncoder().encode(raw).byteLength > MAX_QUEUE_STORAGE_BYTES) {
    return {
      status: "recovery-required",
      events: [],
      raw,
      reason: "STORAGE_LIMIT_EXCEEDED",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "recovery-required", events: [], raw, reason: "CORRUPT_JSON" };
  }

  // Arrays are the fully validated pre-envelope format. They are retained for
  // a safe transition and are rewritten only after a later successful queue
  // mutation, never merely because the page loaded.
  if (Array.isArray(parsed)) return inspectEvents(raw, parsed);
  if (!isPlainRecord(parsed)
    || Object.keys(parsed).some((key) => !QUEUE_ENVELOPE_KEYS.has(key))
    || parsed.schema !== QUEUE_SCHEMA) {
    return { status: "recovery-required", events: [], raw, reason: "UNSUPPORTED_FORMAT" };
  }
  if (parsed.version !== QUEUE_SCHEMA_VERSION) {
    return { status: "recovery-required", events: [], raw, reason: "UNSUPPORTED_VERSION" };
  }
  if (parsed.driverId !== actorId) {
    return { status: "recovery-required", events: [], raw, reason: "DRIVER_SCOPE_MISMATCH" };
  }
  if (!Array.isArray(parsed.events)) {
    return { status: "recovery-required", events: [], raw, reason: "UNSUPPORTED_FORMAT" };
  }
  const result = inspectEvents(raw, parsed.events);
  return result.status === "ready" ? { ...result, format: "envelope" } : result;
}

export function serializeDriverOfflineQueue(
  actorId: string,
  queue: readonly DriverOfflineEvent[],
) {
  if (!isUuid(actorId)) throw new Error("Driver identity is invalid.");
  if (queue.length > MAX_QUEUE_EVENTS) {
    throw new Error("Sync saved delivery updates before recording more on this device.");
  }
  const events = queue.map((event) => createDriverOfflineEvent(event));
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.clientEventId)) {
      throw new Error("A queued delivery event ID may appear only once.");
    }
    ids.add(event.clientEventId);
  }
  const envelope: PersistedDriverQueue = {
    schema: QUEUE_SCHEMA,
    version: QUEUE_SCHEMA_VERSION,
    driverId: actorId,
    events,
  };
  const serialized = JSON.stringify(envelope);
  if (new TextEncoder().encode(serialized).byteLength > MAX_QUEUE_STORAGE_BYTES) {
    throw new Error("Sync saved delivery updates before recording more on this device.");
  }
  return serialized;
}

export function createDriverOfflineEvent(input: DriverOfflineEvent): DriverOfflineEvent {
  const event = normalizedEvent(input);
  if (!event) throw new Error("Delivery event is invalid.");
  return event;
}

export function enqueueDriverOfflineEvent(
  queue: readonly DriverOfflineEvent[],
  event: DriverOfflineEvent,
) {
  const nextEvent = createDriverOfflineEvent(event);
  const existing = queue.find((candidate) => candidate.clientEventId === nextEvent.clientEventId);
  if (existing) {
    if (fingerprint(existing) !== fingerprint(nextEvent)) {
      throw new Error("A queued delivery event ID cannot be reused with different data.");
    }
    return [...queue];
  }
  if (queue.length >= MAX_QUEUE_EVENTS) {
    throw new Error("Sync saved delivery updates before recording more on this device.");
  }
  return [...queue, nextEvent].sort((left, right) => (
    left.deviceSequence - right.deviceSequence
      || left.clientRecordedAt.localeCompare(right.clientRecordedAt)
  ));
}

export function acknowledgeSyncedDriverEvent(
  queue: readonly DriverOfflineEvent[],
  clientEventId: string,
) {
  return queue.filter((event) => event.clientEventId !== clientEventId);
}

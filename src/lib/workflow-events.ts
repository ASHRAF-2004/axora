import { createHash, randomUUID } from "node:crypto";

export const WORKFLOW_METADATA_MAX_BYTES = 16_384;
export const WORKFLOW_METADATA_MAX_ARRAY_ITEMS = 100;
export const WORKFLOW_METADATA_MAX_STRING_BYTES = 2_048;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const FORBIDDEN_METADATA_KEY = /(password|passphrase|secret|token|authorization|cookie|credential|private[_-]?key|raw[_-]?(body|content)|file[_-]?(body|content|bytes))/i;

export type WorkflowActorKind =
  | "PLATFORM"
  | "COMPANY"
  | "SUPPLIER"
  | "DELIVERY"
  | "SYSTEM";

export type WorkflowJson =
  | null
  | boolean
  | number
  | string
  | WorkflowJson[]
  | { [key: string]: WorkflowJson };

export type WorkflowMetadata = Record<string, WorkflowJson>;

export interface WorkflowEventDraft {
  id: string;
  companyId: string;
  branchId?: string;
  requestId?: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  eventVersion: number;
  actorUserId?: string;
  actorKind: WorkflowActorKind;
  correlationId: string;
  causationEventId?: string;
  idempotencyKey: string;
  occurredAt: string;
  metadata: WorkflowMetadata;
}

export interface BuildWorkflowEventInput
  extends Omit<WorkflowEventDraft, "id" | "correlationId" | "occurredAt" | "metadata"> {
  id?: string;
  correlationId?: string;
  occurredAt?: Date | string;
  metadata?: WorkflowMetadata;
}

function assertUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function assertEventKey(value: string, label: string, maximum: number) {
  if (value.length < 2 || value.length > maximum || !EVENT_KEY_PATTERN.test(value)) {
    throw new Error(`${label} must be a lower-case workflow key.`);
  }
}

function canonicalJson(value: WorkflowJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function validateMetadataValue(value: unknown, path: string): asserts value is WorkflowJson {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string"
      && Buffer.byteLength(JSON.stringify(value), "utf8") > WORKFLOW_METADATA_MAX_STRING_BYTES) {
      throw new Error(`Workflow metadata string at ${path} is too large.`);
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Workflow metadata at ${path} must be finite.`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > WORKFLOW_METADATA_MAX_ARRAY_ITEMS) {
      throw new Error(`Workflow metadata array at ${path} is too large.`);
    }
    value.forEach((item, index) => validateMetadataValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      if (key.length > 120 || FORBIDDEN_METADATA_KEY.test(key)) {
        throw new Error(`Workflow metadata key ${path}.${key} is not allowed.`);
      }
      validateMetadataValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Workflow metadata at ${path} is not JSON-safe.`);
}

export function validateWorkflowMetadata(metadata: WorkflowMetadata): WorkflowMetadata {
  validateMetadataValue(metadata, "metadata");
  const canonical = canonicalJson(metadata);
  if (Buffer.byteLength(canonical, "utf8") > WORKFLOW_METADATA_MAX_BYTES) {
    throw new Error("Workflow metadata exceeds 16 KB.");
  }
  return structuredClone(metadata);
}

export function workflowIdempotencyKey(
  namespace: string,
  ...stableParts: readonly (string | number)[]
) {
  assertEventKey(namespace, "Idempotency namespace", 80);
  if (stableParts.length === 0) throw new Error("At least one idempotency component is required.");
  const hash = createHash("sha256");
  for (const part of stableParts) {
    const value = String(part);
    hash.update(String(Buffer.byteLength(value, "utf8")), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("\0", "utf8");
  }
  return `${namespace}:${hash.digest("hex")}`;
}

export function buildWorkflowEvent(input: BuildWorkflowEventInput): WorkflowEventDraft {
  const id = input.id ?? randomUUID();
  const correlationId = input.correlationId ?? randomUUID();
  assertUuid(id, "Workflow event id");
  assertUuid(correlationId, "Correlation id");
  assertUuid(input.companyId, "Company id");
  assertUuid(input.aggregateId, "Aggregate id");
  if (input.branchId) assertUuid(input.branchId, "Branch id");
  if (input.requestId) assertUuid(input.requestId, "Request id");
  if (input.actorUserId) assertUuid(input.actorUserId, "Actor user id");
  if (input.causationEventId) {
    assertUuid(input.causationEventId, "Causation event id");
    if (input.causationEventId === id) throw new Error("An event cannot cause itself.");
  }
  assertEventKey(input.aggregateType, "Aggregate type", 80);
  assertEventKey(input.eventKey, "Event key", 120);
  if (!Number.isSafeInteger(input.eventVersion) || input.eventVersion < 1) {
    throw new Error("Event version must be a positive integer.");
  }
  if (input.actorKind !== "SYSTEM" && !input.actorUserId) {
    throw new Error("A non-system workflow event requires an actor user id.");
  }
  if (input.actorKind === "SYSTEM" && input.actorUserId) {
    throw new Error("A system workflow event cannot impersonate a user.");
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200
    || /[\u0000-\u001f\u007f]/.test(input.idempotencyKey)) {
    throw new Error("Workflow idempotency key is invalid.");
  }
  const occurredAt = new Date(input.occurredAt ?? new Date());
  if (Number.isNaN(occurredAt.getTime())) throw new Error("Workflow occurrence time is invalid.");

  return {
    ...input,
    id,
    correlationId,
    occurredAt: occurredAt.toISOString(),
    metadata: validateWorkflowMetadata(input.metadata ?? {}),
  };
}

export function sameIdempotentWorkflowEvent(
  left: Pick<WorkflowEventDraft, "companyId" | "idempotencyKey">,
  right: Pick<WorkflowEventDraft, "companyId" | "idempotencyKey">,
) {
  return left.companyId === right.companyId
    && left.idempotencyKey === right.idempotencyKey;
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  acknowledgeSyncedDriverEvent,
  createDriverOfflineEvent,
  driverDeviceStorageKey,
  driverQueueStorageKey,
  enqueueDriverOfflineEvent,
  parseDriverOfflineQueue,
  serializeDriverOfflineQueue,
  type DriverOfflineEvent,
} from "@/lib/driver-offline-queue";
import { parseReceiptConfirmationForm } from "@/lib/receiving-form";
import { landingPathForSession } from "@/lib/session-landing";
import { workflowRepositoryInternals } from "@/lib/workflow-repository";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  otherActor: "10000000-0000-4000-8000-000000000002",
  job: "20000000-0000-4000-8000-000000000001",
  assignment: "30000000-0000-4000-8000-000000000001",
  device: "40000000-0000-4000-8000-000000000001",
  event: "50000000-0000-4000-8000-000000000001",
  line: "60000000-0000-4000-8000-000000000001",
  requestLine: "70000000-0000-4000-8000-000000000001",
  deliveryLine: "80000000-0000-4000-8000-000000000001",
};

const queued: DriverOfflineEvent = {
  deliveryJobId: ids.job,
  assignmentId: ids.assignment,
  deviceId: ids.device,
  clientEventId: ids.event,
  deviceSequence: 1,
  eventType: "ARRIVED",
  clientRecordedAt: "2026-08-02T08:00:00.000Z",
};

describe("role-aware portal landing", () => {
  it("routes each canonical external role to its dedicated workspace", () => {
    expect(landingPathForSession({ role: "SUPPLIER_USER", accountKind: "SUPPLIER", isOwner: false })).toBe("/supplier");
    expect(landingPathForSession({ role: "DELIVERY_DRIVER", accountKind: "DELIVERY", isOwner: false })).toBe("/driver");
    expect(landingPathForSession({ role: "RECEIVING_USER", accountKind: "COMPANY", isOwner: false })).toBe("/receiving");
    expect(landingPathForSession({ role: "TECHNICAL_SUPPORT", accountKind: "PLATFORM", isOwner: false })).toBe("/support");
  });

  it("does not route a role with a mismatched account kind into a privileged portal", () => {
    expect(landingPathForSession({ role: "SUPPLIER_USER", accountKind: "COMPANY", isOwner: false })).toBe("/dashboard");
    expect(landingPathForSession({ role: "DELIVERY_DRIVER", accountKind: "SUPPLIER", isOwner: false })).toBe("/dashboard");
  });
});

describe("durable driver browser queue", () => {
  it("namespaces device state and pending events per authenticated driver", () => {
    expect(driverQueueStorageKey(ids.actor)).not.toBe(driverQueueStorageKey(ids.otherActor));
    expect(driverDeviceStorageKey(ids.actor)).toContain(ids.actor);
    expect(() => driverQueueStorageKey("../../shared")).toThrow("invalid");
  });

  it("quarantines corrupt JSON without changing or discarding its original bytes", () => {
    const raw = "{not-valid-json";
    expect(parseDriverOfflineQueue(raw, ids.actor)).toEqual({
      status: "recovery-required",
      events: [],
      raw,
      reason: "CORRUPT_JSON",
    });
  });

  it("quarantines a partially invalid queue while retaining every valid item for recovery", () => {
    const raw = JSON.stringify([queued, { ...queued, clientEventId: "not-a-uuid" }, null]);
    expect(parseDriverOfflineQueue(raw, ids.actor)).toEqual({
      status: "recovery-required",
      events: [queued],
      raw,
      reason: "INVALID_EVENT",
      totalEventCount: 3,
    });
  });

  it("rejects unknown queue schema versions and cross-driver envelopes", () => {
    const envelope = JSON.parse(serializeDriverOfflineQueue(ids.actor, [queued])) as Record<string, unknown>;
    const wrongSchemaRaw = JSON.stringify({ ...envelope, schema: "another.application.queue" });
    expect(parseDriverOfflineQueue(wrongSchemaRaw, ids.actor)).toMatchObject({
      status: "recovery-required",
      raw: wrongSchemaRaw,
      reason: "UNSUPPORTED_FORMAT",
    });

    const futureRaw = JSON.stringify({ ...envelope, version: 99 });
    expect(parseDriverOfflineQueue(futureRaw, ids.actor)).toMatchObject({
      status: "recovery-required",
      raw: futureRaw,
      reason: "UNSUPPORTED_VERSION",
    });

    const wrongDriverRaw = JSON.stringify({ ...envelope, driverId: ids.otherActor });
    expect(parseDriverOfflineQueue(wrongDriverRaw, ids.actor)).toMatchObject({
      status: "recovery-required",
      raw: wrongDriverRaw,
      reason: "DRIVER_SCOPE_MISMATCH",
    });
  });

  it("round-trips a normal scoped queue without loss and removes only a confirmed event", () => {
    const legacyRaw = JSON.stringify([queued]);
    expect(parseDriverOfflineQueue(legacyRaw, ids.actor)).toEqual({
      status: "ready",
      events: [queued],
      format: "legacy",
    });
    const raw = serializeDriverOfflineQueue(ids.actor, [queued]);
    const inspection = parseDriverOfflineQueue(raw, ids.actor);
    expect(inspection).toEqual({ status: "ready", events: [queued], format: "envelope" });
    // Parsing is read-only. The exact persisted value remains available to the
    // storage owner until a later validated queue mutation succeeds.
    expect(raw).toBe(serializeDriverOfflineQueue(ids.actor, inspection.events));
    const second = createDriverOfflineEvent({ ...queued, clientEventId: "50000000-0000-4000-8000-000000000002", deviceSequence: 2, eventType: "DELIVERED" });
    const queue = enqueueDriverOfflineEvent([queued], second);
    expect(acknowledgeSyncedDriverEvent(queue, queued.clientEventId)).toEqual([second]);
  });

  it("quarantines duplicate client IDs rather than silently de-duplicating storage", () => {
    const raw = JSON.stringify([queued, { ...queued }]);
    expect(parseDriverOfflineQueue(raw, ids.actor)).toEqual({
      status: "recovery-required",
      events: [queued],
      raw,
      reason: "CONFLICTING_EVENT_ID",
      totalEventCount: 2,
    });
  });

  it("makes an exact retry idempotent and rejects conflicting reuse", () => {
    expect(enqueueDriverOfflineEvent([queued], { ...queued })).toEqual([queued]);
    expect(() => enqueueDriverOfflineEvent([queued], { ...queued, eventType: "FAILED" }))
      .toThrow("cannot be reused");
  });

  it("keeps partial handover evidence intact until the server acknowledges its id", () => {
    const partial = createDriverOfflineEvent({
      ...queued,
      clientEventId: "50000000-0000-4000-8000-000000000003",
      deviceSequence: 3,
      eventType: "PARTIALLY_DELIVERED",
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 1,
        missingQuantity: 2,
      }],
    });
    const restored = parseDriverOfflineQueue(
      serializeDriverOfflineQueue(ids.actor, [partial]),
      ids.actor,
    );
    expect(restored).toEqual({ status: "ready", events: [partial], format: "envelope" });
    expect(acknowledgeSyncedDriverEvent(restored.events, "50000000-0000-4000-8000-000000000099"))
      .toEqual([partial]);
  });
});

describe("receiver line confirmation form", () => {
  it("parses every line independently without accepting driver evidence fields", () => {
    const form = new FormData();
    form.set("deliveryJobId", ids.job);
    form.append("deliveryJobLineId", ids.line);
    form.append("requestLineId", ids.requestLine);
    form.append("deliveredQuantity", "9");
    form.append("acceptedQuantity", "8");
    form.append("damagedQuantity", "1");
    form.append("discrepancyCode", "QUALITY");
    form.append("discrepancyNote", "Outer packaging was wet");
    form.set("driverEvidenceId", ids.event);
    expect(parseReceiptConfirmationForm(form)).toEqual({
      deliveryJobId: ids.job,
      notes: undefined,
      lines: [{
        deliveryJobLineId: ids.line,
        requestLineId: ids.requestLine,
        deliveredQuantity: 9,
        acceptedQuantity: 8,
        damagedQuantity: 1,
        discrepancyCode: "QUALITY",
        discrepancyNote: "Outer packaging was wet",
      }],
    });
    expect(parseReceiptConfirmationForm(form)).not.toHaveProperty("driverEvidenceId");
  });

  it("rejects truncated or misaligned line arrays", () => {
    const form = new FormData();
    form.set("deliveryJobId", ids.job);
    form.append("deliveryJobLineId", ids.line);
    form.append("requestLineId", ids.requestLine);
    form.append("deliveredQuantity", "10");
    expect(() => parseReceiptConfirmationForm(form)).toThrow("every delivery line");
  });
});

describe("external workflow RLS visibility", () => {
  it("exposes only assigned domain aggregates needed for safe event versioning", () => {
    const migration = readFileSync("database/migrations/023_workflow_event_rls_and_baseline.sql", "utf8");
    expect(migration).toContain("workflow_events.aggregate_type='supplier-rfq'");
    expect(migration).toContain("axora_context_has_supplier_access(rfq.supplier_id)");
    expect(migration).toContain("workflow_events.aggregate_type='delivery-job'");
    expect(migration).toContain("assignment.driver_user_id=axora_context_user_id()");
    expect(migration).toContain("assignment.status IN ('ASSIGNED','ACCEPTED')");
  });

  it("masks supplier identities from the customer request timeline", () => {
    expect(workflowRepositoryInternals.customerVisibleActorName("SUPPLIER", "Private Supplier User")).toBeUndefined();
    expect(workflowRepositoryInternals.customerVisibleActorName("COMPANY", "Customer Receiver")).toBe("Customer Receiver");
  });
});

import { describe, expect, it } from "vitest";
import {
  assertDriverEventTransition,
  buildDeliveryClientEvent,
  buildDeliveryNavigationUrl,
  buildDriverEvidence,
  deliveryEventMetadata,
  deliveryStatusFromEvents,
  reconcileDeliveryEvents,
  resolveDeliveryDriverScope,
  visibleDeliveryJobs,
  type DeliveryAssignmentRecord,
  type DeliveryJobRecord,
} from "@/lib/delivery-portal";

const ids = {
  driver: "10000000-0000-4000-8000-000000000001",
  otherDriver: "10000000-0000-4000-8000-000000000002",
  company: "20000000-0000-4000-8000-000000000001",
  branch: "30000000-0000-4000-8000-000000000001",
  job: "40000000-0000-4000-8000-000000000001",
  otherJob: "40000000-0000-4000-8000-000000000002",
  assignment: "50000000-0000-4000-8000-000000000001",
  device: "50000000-0000-4000-8000-000000000002",
  clientEvent: "60000000-0000-4000-8000-000000000001",
  serverEvent: "70000000-0000-4000-8000-000000000001",
  clientEvidence: "80000000-0000-4000-8000-000000000001",
  deliveryLine: "90000000-0000-4000-8000-000000000001",
};

const assignment: DeliveryAssignmentRecord = {
  id: ids.assignment,
  deliveryJobId: ids.job,
  driverUserId: ids.driver,
  status: "ACCEPTED",
  assignedAt: "2026-08-02T08:00:00.000Z",
};

describe("offline-safe delivery portal", () => {
  it("shows only jobs assigned to the active driver", () => {
    const scope = resolveDeliveryDriverScope(ids.driver, { userId: ids.driver, active: true });
    const job: DeliveryJobRecord = {
      id: ids.job,
      companyId: ids.company,
      branchId: ids.branch,
      jobCode: "JOB-1",
      status: "ASSIGNED",
      deliveryAddress: "Branch one",
    };
    expect(visibleDeliveryJobs(scope, [job, { ...job, id: ids.otherJob }], [assignment]))
      .toEqual([job]);
  });

  it("deduplicates a synced client event and leaves only unsynced events pending", () => {
    const scope = resolveDeliveryDriverScope(ids.driver, { userId: ids.driver, active: true });
    const accepted = buildDeliveryClientEvent(scope, assignment, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 1,
      eventType: "ACCEPTED",
      clientRecordedAt: "2026-08-02T08:01:00.000Z",
    });
    const enRoute = buildDeliveryClientEvent(scope, assignment, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.serverEvent,
      deviceSequence: 2,
      eventType: "EN_ROUTE",
      clientRecordedAt: "2026-08-02T08:02:00.000Z",
    });
    const reconciled = reconcileDeliveryEvents([accepted, enRoute], [accepted]);
    expect(reconciled.timeline).toHaveLength(2);
    expect(reconciled.pending.map((event) => event.clientEventId)).toEqual([ids.serverEvent]);
    expect(deliveryStatusFromEvents("ASSIGNED", reconciled.timeline)).toBe("EN_ROUTE");
    expect(deliveryStatusFromEvents("ASSIGNED", [
      { ...enRoute, eventType: "ARRIVED", clientRecordedAt: "2026-08-02T08:03:00.000Z" },
      { ...accepted, deviceSequence: 3, clientRecordedAt: "2026-08-02T08:04:00.000Z" },
    ])).toBe("ARRIVED");
    expect(deliveryStatusFromEvents("ARRIVED", [
      { ...enRoute, eventType: "PARTIALLY_DELIVERED", clientRecordedAt: "2026-08-02T08:05:00.000Z" },
      { ...accepted, eventType: "ISSUE_REPORTED", deviceSequence: 3, clientRecordedAt: "2026-08-02T08:06:00.000Z" },
    ])).toBe("PARTIALLY_DELIVERED");

    const clockSkewed = reconcileDeliveryEvents([
      { ...accepted, clientRecordedAt: "2099-08-02T08:04:00.000Z" },
      { ...enRoute, clientRecordedAt: "2026-08-02T08:02:00.000Z" },
    ], []);
    expect(clockSkewed.timeline.map((event) => event.eventType))
      .toEqual(["ACCEPTED", "EN_ROUTE"]);
  });

  it("rejects a device clock materially ahead of the server", () => {
    const scope = resolveDeliveryDriverScope(ids.driver, { userId: ids.driver, active: true });
    const futureAssignment: DeliveryAssignmentRecord = {
      ...assignment,
      assignedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    };
    expect(() => buildDeliveryClientEvent(scope, futureAssignment, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 1,
      eventType: "ACCEPTED",
      clientRecordedAt: new Date(Date.now() + 6 * 60_000).toISOString(),
    })).toThrow("device clock is too far ahead");
  });

  it("rejects another driver's assignment and conflicting retry payloads", () => {
    const scope = resolveDeliveryDriverScope(ids.driver, { userId: ids.driver, active: true });
    expect(() => buildDeliveryClientEvent(scope, { ...assignment, driverUserId: ids.otherDriver }, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 1,
      eventType: "ARRIVED",
      clientRecordedAt: "2026-08-02T08:01:00.000Z",
    })).toThrow("own assignment");
    const first = buildDeliveryClientEvent(scope, assignment, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 1,
      eventType: "ARRIVED",
      clientRecordedAt: "2026-08-02T08:01:00.000Z",
    });
    expect(() => reconcileDeliveryEvents(
      [{ ...first, eventType: "FAILED" }],
      [first],
    )).toThrow("Conflicting");
  });

  it("creates driver evidence as a distinct, assignment-bound record", () => {
    const scope = resolveDeliveryDriverScope(ids.driver, { userId: ids.driver, active: true });
    const event = buildDeliveryClientEvent(scope, assignment, {
      companyId: ids.company,
      deliveryJobId: ids.job,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 3,
      eventType: "DELIVERED",
      clientRecordedAt: "2026-08-02T08:10:00.000Z",
    });
    const evidence = buildDriverEvidence(scope, event, {
      deliveryJobEventId: ids.serverEvent,
      clientEvidenceId: ids.clientEvidence,
      evidenceType: "PHOTO",
      fileName: "doorstep.jpg",
      contentType: "image/jpeg",
      storagePath: "delivery-evidence/job-1/doorstep.jpg",
      sha256: "a".repeat(64),
    });
    expect(evidence).toMatchObject({
      deliveryJobId: ids.job,
      driverUserId: ids.driver,
      evidenceType: "PHOTO",
    });
    expect(evidence).not.toHaveProperty("acceptedQuantity");
  });

  it("records bounded partial-handover quantities as evidence without customer acceptance", () => {
    const metadata = deliveryEventMetadata("PARTIALLY_DELIVERED", {
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 1,
        missingQuantity: 2,
      }],
    }, [{ id: ids.deliveryLine, plannedQuantity: 10 }]);
    expect(metadata).toEqual({
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 1,
        missingQuantity: 2,
      }],
    });
    expect(metadata).not.toHaveProperty("acceptedQuantity");
    expect(() => deliveryEventMetadata("PARTIALLY_DELIVERED", {
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 0,
        missingQuantity: 1,
      }],
    }, [{ id: ids.deliveryLine, plannedQuantity: 10 }])).toThrow("must equal");
  });

  it("enforces deterministic driver progress and creates an encoded navigation link", () => {
    expect(() => assertDriverEventTransition("ASSIGNED", "ARRIVED")).toThrow("cannot follow");
    expect(() => assertDriverEventTransition("ARRIVED", "DELIVERY_ATTEMPTED")).not.toThrow();
    expect(() => assertDriverEventTransition("ARRIVED", "PARTIALLY_DELIVERED")).not.toThrow();
    const url = new URL(buildDeliveryNavigationUrl("10 Jalan Example, Kuala Lumpur"));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("www.google.com");
    expect(url.searchParams.get("query")).toBe("10 Jalan Example, Kuala Lumpur");
  });
});

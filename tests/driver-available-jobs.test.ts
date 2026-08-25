import { beforeEach, describe, expect, it } from "vitest";

import {
  claimAvailableDeliveryJob,
  driverAvailableJobInternals,
  getAvailableDeliveryJobs,
  getDeliveryClaimResult,
  setDriverAvailability,
  type AvailableDeliveryWorkspace,
} from "@/lib/driver-operations";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  getDeliveryExecutionWorkspace,
  recordCanonicalDeliveryEvent,
} from "@/lib/delivery-execution";
import {
  controlDriverTracking,
  getDriverDeliveryTracking,
  recordDeliveryTrackingPoint,
} from "@/lib/delivery-tracking";

const workspace: AvailableDeliveryWorkspace = {
  sequence: 1,
  capturedAt: "2026-08-20T02:03:04.000Z",
  availability: "AVAILABLE",
  jobs: [{
    id: "10000000-0000-4000-8000-000000000001",
    code: "DEL-001",
    requestReference: "REQ-001",
    companyName: "Controlled company",
    branchName: "Main branch",
    area: "Kuala Lumpur",
    destinationTimezone: "Asia/Kuala_Lumpur",
    lineCount: 1,
    status: "AVAILABLE",
  }],
};

function driver(id: string): AuthenticatedSessionUser {
  return {
    id,
    email: `${id}@axora.invalid`,
    name: `Driver ${id}`,
    role: "DELIVERY_GUY",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
    isOwner: false,
    authVersion: 1,
  };
}

describe("available delivery job application guard", () => {
  beforeEach(() => {
    global.__axoraDemoDeliveryClaimState = undefined;
    global.__axoraDemoDeliveryExecutionState = undefined;
    global.__axoraDemoDeliveryTrackingState = undefined;
  });

  it("hides the pool while the authenticated driver has a current job", () => {
    expect(driverAvailableJobInternals.hideAvailableJobsWhileAssigned(workspace, true))
      .toEqual({ ...workspace, jobs: [] });
  });

  it("does not invent geographic eligibility when no current job exists", () => {
    expect(driverAvailableJobInternals.hideAvailableJobsWhileAssigned(workspace, false))
      .toBe(workspace);
  });

  it("allows exactly one demo driver to claim and binds command replay", async () => {
    const driverA = driver("70000000-0000-4000-8000-000000000001");
    const driverB = driver("70000000-0000-4000-8000-000000000002");
    const job = (await getAvailableDeliveryJobs(driverA)).jobs[0]!;
    const commandA = "70000000-0000-4000-8000-000000000003";
    const commandB = "70000000-0000-4000-8000-000000000004";

    const outcomes = await Promise.allSettled([
      claimAvailableDeliveryJob(driverA, job.id, commandA),
      claimAvailableDeliveryJob(driverB, job.id, commandB),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const winner = outcomes[0].status === "fulfilled" ? driverA : driverB;
    const winningCommand = winner.id === driverA.id ? commandA : commandB;
    const first = outcomes.find((outcome) => outcome.status === "fulfilled");
    const replay = await claimAvailableDeliveryJob(winner, job.id, winningCommand);
    expect(first?.status === "fulfilled" ? first.value : null).toEqual(replay);
    await expect(getDeliveryClaimResult(winner, job.id, winningCommand))
      .resolves.toEqual({ ...replay, created: false });
    await expect(getDeliveryClaimResult(
      winner.id === driverA.id ? driverB : driverA,
      job.id,
      winningCommand,
    )).resolves.toBeNull();
    expect((await getAvailableDeliveryJobs(driverA)).jobs).toEqual([]);
    expect((await getAvailableDeliveryJobs(driverB)).jobs).toEqual([]);
    expect(driverAvailableJobInternals.demoDeliveryClaimState().claimedByJob.size).toBe(1);
  });

  it("honors demo availability and refuses customer impersonation", async () => {
    const deliveryActor = driver("70000000-0000-4000-8000-000000000005");
    await setDriverAvailability(deliveryActor, "UNAVAILABLE");
    expect((await getAvailableDeliveryJobs(deliveryActor)).jobs).toEqual([]);

    await expect(getAvailableDeliveryJobs({
      ...deliveryActor,
      role: "COMPANY_ADMIN",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId: "co-youruni",
    })).rejects.toThrow("unavailable");
  });

  it("projects a claimed demo job and advances to its immutable navigation snapshot", async () => {
    const actor = driver("70000000-0000-4000-8000-000000000006");
    const job = (await getAvailableDeliveryJobs(actor)).jobs[0]!;
    await claimAvailableDeliveryJob(
      actor,
      job.id,
      "70000000-0000-4000-8000-000000000007",
    );
    await setDriverAvailability(actor, "UNAVAILABLE");
    await expect(getAvailableDeliveryJobs(actor)).resolves.toMatchObject({
      availability: "UNAVAILABLE",
      jobs: [],
    });

    const initial = (await getDeliveryExecutionWorkspace(actor)).jobs[0]!;
    expect(initial).toMatchObject({
      status: "ASSIGNED",
      workflowVersion: 1,
      destinationLatitude: 3.1516,
      destinationLongitude: 101.7113,
    });
    const pendingTracking = await getDriverDeliveryTracking(actor);
    expect(pendingTracking.sessions[0]).toMatchObject({
      jobId: job.id,
      status: "NOT_STARTED",
      pointCount: 0,
    });

    let version = initial.workflowVersion;
    for (const [index, type] of [
      "ACCEPTED", "SHOPPING_STARTED", "ITEMS_ACQUIRED", "OUT_FOR_DELIVERY",
    ].entries()) {
      const commandId = `71000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      const input = {
        jobId: job.id,
        assignmentId: initial.assignmentId,
        expectedVersion: version,
        commandId,
        deviceId: "72000000-0000-4000-8000-000000000001",
        deviceSequence: index + 1,
        eventType: type,
        clientRecordedAt: `2026-08-21T00:0${index}:00.000Z`,
        metadata: {},
      };
      const result = await recordCanonicalDeliveryEvent(actor, input);
      expect(result).toMatchObject({ workflowVersion: version + 1 });
      expect(await recordCanonicalDeliveryEvent(actor, input)).toEqual(result);
      await expect(recordCanonicalDeliveryEvent(actor, {
        ...input,
        metadata: { changed: true },
      })).rejects.toThrow(/conflict/i);
      version += 1;
    }

    const current = (await getDeliveryExecutionWorkspace(actor)).jobs[0]!;
    expect(current).toMatchObject({
      status: "OUT_FOR_DELIVERY",
      workflowVersion: 5,
      destinationLatitude: initial.destinationLatitude,
      destinationLongitude: initial.destinationLongitude,
    });
    const events = (current as Record<string, unknown>).events as Array<{ type: string }>;
    expect(events.map((event) => event.type)).toEqual([
      "ASSIGNED", "ACCEPTED", "SHOPPING_STARTED", "ITEMS_ACQUIRED", "OUT_FOR_DELIVERY",
    ]);

    const activeTracking = await getDriverDeliveryTracking(actor);
    const sessionId = activeTracking.sessions[0]!.sessionId;
    expect(activeTracking.sessions[0]).toMatchObject({
      jobId: job.id,
      status: "ACTIVE",
      destinationLatitude: initial.destinationLatitude,
      destinationLongitude: initial.destinationLongitude,
      locationAvailable: false,
    });
    const point = {
      action: "POINT" as const,
      sessionId,
      pointId: "73000000-0000-4000-8000-000000000001",
      deviceId: "74000000-0000-4000-8000-000000000001",
      deviceSequence: 1,
      latitude: 3.15,
      longitude: 101.7,
      accuracyMeters: 20,
      speedMps: 8,
      headingDegrees: 90,
      recordedAt: new Date(),
    };
    await expect(recordDeliveryTrackingPoint(actor, point)).resolves
      .toMatchObject({ pointId: point.pointId, replayed: false });
    await expect(recordDeliveryTrackingPoint(actor, point)).resolves
      .toMatchObject({ pointId: point.pointId, replayed: true });
    await expect(recordDeliveryTrackingPoint(actor, {
      ...point,
      pointId: "73000000-0000-4000-8000-000000000002",
    })).rejects.toThrow(/out of order/i);
    await expect(controlDriverTracking(actor, {
      action: "PAUSE",
      sessionId,
      reason: "Delivery Agent paused location sharing",
    })).resolves.toMatchObject({ status: "PAUSED" });
    expect((await getDriverDeliveryTracking(actor)).sessions[0]!.status).toBe("PAUSED");
    await expect(controlDriverTracking(actor, {
      action: "RESUME",
      sessionId,
      reason: "Delivery Agent resumed location sharing",
    })).resolves.toMatchObject({ status: "ACTIVE" });
  });
});

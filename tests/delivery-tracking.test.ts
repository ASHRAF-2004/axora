import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedSessionUser } from "../src/lib/auth";
import {
  getCompanyDeliveryTracking,
  trackingConfigurationSchema,
  trackingControlSchema,
  trackingFailureSchema,
  trackingPointSchema,
} from "../src/lib/delivery-tracking";
import { deliveryTrackingMessages } from "../src/lib/delivery-tracking-i18n";

const ids = {
  session: "10000000-0000-4000-8000-000000000001",
  point: "20000000-0000-4000-8000-000000000001",
  device: "30000000-0000-4000-8000-000000000001",
};

describe("live delivery tracking validation", () => {
  beforeEach(() => {
    global.__axoraDemoDeliveryClaimState = undefined;
    global.__axoraDemoDeliveryExecutionState = undefined;
    global.__axoraDemoDeliveryTrackingState = undefined;
  });

  it("accepts bounded GPS samples and rejects impossible coordinate inputs", () => {
    expect(trackingPointSchema.parse({
      action: "POINT",
      sessionId: ids.session,
      pointId: ids.point,
      deviceId: ids.device,
      deviceSequence: 7,
      latitude: 3.139,
      longitude: 101.6869,
      accuracyMeters: 12,
      speedMps: 8.3,
      headingDegrees: 180,
      recordedAt: "2026-08-09T04:00:00Z",
    })).toMatchObject({ latitude: 3.139, longitude: 101.6869 });
    expect(() => trackingPointSchema.parse({
      action: "POINT",
      sessionId: ids.session,
      pointId: ids.point,
      deviceId: ids.device,
      deviceSequence: 7,
      latitude: 91,
      longitude: 101.6869,
      accuracyMeters: 12,
      recordedAt: "2026-08-09T04:00:00Z",
    })).toThrow();
    expect(() => trackingPointSchema.parse({
      action: "POINT",
      sessionId: ids.session,
      pointId: ids.point,
      deviceId: ids.device,
      deviceSequence: 7,
      latitude: 3.139,
      longitude: 101.6869,
      accuracyMeters: 2_001,
      recordedAt: "2026-08-09T04:00:00Z",
    })).toThrow();
  });

  it("requires paired destination coordinates and bounded retention", () => {
    expect(trackingConfigurationSchema.parse({
      action: "CONFIGURE",
      sessionId: ids.session,
      destinationLatitude: 3.1412,
      destinationLongitude: 101.69,
      visibilityPrecision: "APPROXIMATE",
      showVehicleDetails: true,
      contactMode: "AXORA_RELAY",
      rawRetentionDays: 30,
      vehicleType: "Van",
      vehicleColour: "White",
      vehicleRegistration: "AXR 204",
      reason: "Approved customer tracking policy",
    })).toMatchObject({ rawRetentionDays: 30 });
    expect(() => trackingConfigurationSchema.parse({
      action: "CONFIGURE",
      sessionId: ids.session,
      destinationLatitude: 3.1412,
      destinationLongitude: null,
      visibilityPrecision: "EXACT",
      showVehicleDetails: false,
      contactMode: "NONE",
      rawRetentionDays: 30,
      reason: "Incomplete destination",
    })).toThrow();
    expect(() => trackingConfigurationSchema.parse({
      action: "CONFIGURE",
      sessionId: ids.session,
      destinationLatitude: null,
      destinationLongitude: null,
      visibilityPrecision: "APPROXIMATE",
      showVehicleDetails: false,
      contactMode: "NONE",
      rawRetentionDays: 91,
      reason: "Retention outside policy",
    })).toThrow();
  });

  it("allows Delivery Agent pause/resume while reserving terminal END for supervisors", () => {
    expect(trackingControlSchema.parse({
      action: "PAUSE",
      sessionId: ids.session,
      reason: "Approved battery preservation condition",
    }).action).toBe("PAUSE");
    expect(trackingFailureSchema.parse({
      action: "RESUME",
      sessionId: ids.session,
      reason: "Delivery Agent resumed location sharing",
    }).action).toBe("RESUME");
    expect(() => trackingFailureSchema.parse({
      action: "END",
      sessionId: ids.session,
      reason: "Delivery Agent attempted to end tracking",
    })).toThrow();
    expect(trackingControlSchema.parse({
      action: "END",
      sessionId: ids.session,
      reason: "Supervisor ended an operational tracking session",
    }).action).toBe("END");
    expect(trackingFailureSchema.parse({
      action: "REPORT_FAILURE",
      sessionId: ids.session,
      reason: "Browser location permission was denied",
      failureCode: "PERMISSION_DENIED",
    }).failureCode).toBe("PERMISSION_DENIED");
    expect(() => trackingFailureSchema.parse({
      action: "REPORT_FAILURE",
      sessionId: ids.session,
      reason: "Location failed",
    })).toThrow();
  });

  it("ships complete English, Arabic and Malay tracking catalogs", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = deliveryTrackingMessages(locale);
      expect(copy.activeIndicator).toBeTruthy();
      expect(copy.permissionDenied).toBeTruthy();
      expect(copy.etaUnavailable).toBeTruthy();
      expect(copy.destinationUnavailable).toBeTruthy();
    }
    expect(deliveryTrackingMessages("ar").companyTitle).toContain("تسليم");
    expect(deliveryTrackingMessages("ms").companyTitle).toContain("Penghantaran");
  });

  it("shows an authorized company a privacy-safe preparing card before claim", async () => {
    const companyActor: AuthenticatedSessionUser = {
      id: "40000000-0000-4000-8000-000000000001",
      email: "company-tracking@example.test",
      name: "Company tracking fixture",
      role: "COMPANY_ADMIN",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId: "66666666-6666-4666-8666-666666666666",
      roleAssignmentId: "40000000-0000-4000-8000-000000000002",
      isOwner: false,
      authVersion: 1,
    };
    const workspace = await getCompanyDeliveryTracking(companyActor);
    expect(workspace.sessions).toHaveLength(1);
    expect(workspace.sessions[0]).toMatchObject({
      sessionId: "customer:DEL-DEMO-AVAILABLE-001",
      jobId: "",
      jobCode: "DEL-DEMO-AVAILABLE-001",
      jobStatus: "PREPARING",
      status: "NOT_STARTED",
      stale: false,
      locationAvailable: false,
      visibilityPrecision: "APPROXIMATE",
      contactMode: "NONE",
    });
    expect(workspace.sessions[0]).not.toHaveProperty("agentUserId");
    expect(workspace.sessions[0]).not.toHaveProperty("agentName");
    expect(workspace.sessions[0]).not.toHaveProperty("rawRetentionDays");
    expect(workspace.sessions[0]).not.toHaveProperty("pointCount");
    expect(workspace.sessions[0]).not.toHaveProperty("accuracyMeters");

    const foreign = await getCompanyDeliveryTracking({
      ...companyActor,
      companyId: "77777777-7777-4777-8777-777777777777",
    });
    expect(foreign.sessions).toEqual([]);
  });
});

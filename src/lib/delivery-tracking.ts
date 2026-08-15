import type { QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(1_000);
const optionalCoordinate = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().finite().nullable(),
);

export const trackingPointSchema = z.object({
  action: z.literal("POINT").default("POINT"),
  sessionId: uuid,
  pointId: uuid,
  deviceId: uuid,
  deviceSequence: z.number().int().nonnegative(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().positive().max(2_000),
  speedMps: z.number().finite().min(0).max(100).nullable().optional().default(null),
  headingDegrees: z.number().finite().min(0).max(360).nullable().optional().default(null),
  recordedAt: z.coerce.date(),
});

export const trackingFailureSchema = z.object({
  action: z.enum(["REPORT_FAILURE", "END"]),
  sessionId: uuid,
  reason,
  failureCode: z.enum([
    "PERMISSION_DENIED",
    "LOCATION_UNAVAILABLE",
    "LOCATION_TIMEOUT",
    "BATTERY_RESTRICTED",
    "OFFLINE",
  ]).optional(),
}).superRefine((value, context) => {
  if (value.action === "REPORT_FAILURE" && !value.failureCode) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "Failure code required" });
  }
});

export const trackingConfigurationSchema = z.object({
  action: z.literal("CONFIGURE"),
  sessionId: uuid,
  destinationLatitude: optionalCoordinate,
  destinationLongitude: optionalCoordinate,
  visibilityPrecision: z.enum(["APPROXIMATE", "EXACT"]),
  showVehicleDetails: z.boolean(),
  contactMode: z.enum(["AXORA_RELAY", "NONE"]),
  rawRetentionDays: z.coerce.number().int().min(1).max(90),
  vehicleType: z.string().trim().max(80).optional().default(""),
  vehicleColour: z.string().trim().max(80).optional().default(""),
  vehicleRegistration: z.string().trim().max(80).optional().default(""),
  reason,
}).superRefine((value, context) => {
  if ((value.destinationLatitude === null) !== (value.destinationLongitude === null)) {
    context.addIssue({
      code: "custom",
      path: ["destinationLatitude"],
      message: "Both destination coordinates are required",
    });
  }
  if (value.destinationLatitude !== null
    && (value.destinationLatitude < -90 || value.destinationLatitude > 90)) {
    context.addIssue({ code: "custom", path: ["destinationLatitude"], message: "Invalid latitude" });
  }
  if (value.destinationLongitude !== null
    && (value.destinationLongitude < -180 || value.destinationLongitude > 180)) {
    context.addIssue({ code: "custom", path: ["destinationLongitude"], message: "Invalid longitude" });
  }
});

export const trackingControlSchema = z.object({
  action: z.enum(["PAUSE", "RESUME", "END"]),
  sessionId: uuid,
  reason,
});

export type TrackingWorkspace = {
  actorId?: string;
  capturedAt: string;
  sessions: Array<Record<string, unknown> & {
    sessionId: string;
    jobId: string;
    jobCode: string;
    status: string;
  }>;
};

interface JsonRow<T> extends QueryResultRow {
  value: T | null;
}

function roleAssignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) {
    throw new Error("The delivery tracking workspace is unavailable.");
  }
  return actor.roleAssignmentId;
}

async function readWorkspace(
  actor: AuthenticatedSessionUser,
  capability: string,
): Promise<TrackingWorkspace> {
  if (isDemoMode()) {
    return { actorId: actor.id, capturedAt: new Date().toISOString(), sessions: [] };
  }
  const result = await query<JsonRow<TrackingWorkspace>>(
    `SELECT public.${capability}($1,$2,$3) AS value`,
    [actor.id, roleAssignmentId(actor), new Date()],
  );
  if (!result.rows[0]?.value) {
    throw new Error("The delivery tracking workspace is unavailable.");
  }
  return result.rows[0].value;
}

export function getDriverDeliveryTracking(actor: AuthenticatedSessionUser) {
  return readWorkspace(actor, "axora_driver_delivery_tracking_workspace");
}

export function getSupervisorDeliveryTracking(actor: AuthenticatedSessionUser) {
  return readWorkspace(actor, "axora_supervisor_delivery_tracking_workspace");
}

const CUSTOMER_DELIVERY_STATUS: Record<string, string> = {
  AWAITING_ASSIGNMENT: "PREPARING",
  ASSIGNED: "PREPARING",
  ACCEPTED: "PREPARING",
  SHOPPING: "PREPARING",
  PURCHASING: "PREPARING",
  ITEMS_ACQUIRED: "PREPARING",
  AWAITING_DELIVERY: "PREPARING",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  ARRIVED: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  PARTIALLY_DELIVERED: "DELIVERED",
  COMPLETED: "COMPLETED",
};

export function customerVisibleDeliveryStatus(status: unknown) {
  if (typeof status !== "string") return "PREPARING";
  return CUSTOMER_DELIVERY_STATUS[status.toUpperCase()] ?? "PREPARING";
}

function customerTrackingWorkspace(workspace: TrackingWorkspace): TrackingWorkspace {
  return {
    capturedAt: workspace.capturedAt,
    sessions: workspace.sessions.map((session) => ({
      sessionId: session.sessionId,
      jobId: "",
      jobCode: session.jobCode,
      branchName: session.branchName,
      companyName: session.companyName,
      status: session.status,
      jobStatus: customerVisibleDeliveryStatus(session.jobStatus),
      startedAt: session.startedAt,
      pausedAt: session.pausedAt,
      lastUpdatedAt: session.lastUpdatedAt,
      stale: Boolean(session.stale),
      locationAvailable: Number.isFinite(session.latitude)
        && Number.isFinite(session.longitude),
      latitude: null,
      longitude: null,
      destinationLatitude: null,
      destinationLongitude: null,
      remainingMeters: session.remainingMeters,
      etaSeconds: session.etaSeconds,
      visibilityPrecision: "APPROXIMATE",
      showVehicleDetails: Boolean(session.showVehicleDetails),
      contactMode: session.contactMode === "AXORA_RELAY" ? "AXORA_RELAY" : "NONE",
      contactPath: session.contactMode === "AXORA_RELAY" ? session.contactPath : null,
      rawRetentionDays: 0,
      vehicleType: session.showVehicleDetails ? session.vehicleType : null,
      vehicleColour: session.showVehicleDetails ? session.vehicleColour : null,
      vehicleRegistration: session.showVehicleDetails ? session.vehicleRegistration : null,
    })),
  };
}

export async function getCompanyDeliveryTracking(actor: AuthenticatedSessionUser) {
  return customerTrackingWorkspace(
    await readWorkspace(actor, "axora_company_delivery_tracking_workspace"),
  );
}

export async function recordDeliveryTrackingPoint(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = trackingPointSchema.parse(input);
  if (isDemoMode()) {
    return {
      pointId: parsed.pointId,
      sessionId: parsed.sessionId,
      acceptedAt: new Date().toISOString(),
      replayed: false,
    };
  }
  const now = new Date();
  return withAuditTransaction({
    actor,
    reason: "Delivery location sample received",
    commandId: parsed.pointId,
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_record_delivery_location(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      ) AS value
    `, [
      actor.id,
      roleAssignmentId(actor),
      parsed.sessionId,
      parsed.pointId,
      parsed.deviceId,
      parsed.deviceSequence,
      parsed.latitude,
      parsed.longitude,
      parsed.accuracyMeters,
      parsed.speedMps,
      parsed.headingDegrees,
      parsed.recordedAt,
      now,
    ]);
    if (!result.rows[0]?.value) {
      throw new Error("The delivery location is unavailable.");
    }
    return result.rows[0].value;
  });
}

export async function reportOrEndDriverTracking(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = trackingFailureSchema.parse(input);
  if (isDemoMode()) {
    return { sessionId: parsed.sessionId, status: parsed.action === "END" ? "ENDED" : "ACTIVE" };
  }
  const now = new Date();
  return withAuditTransaction({
    actor,
    reason: parsed.reason,
    commandId: randomUUID(),
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_control_delivery_tracking(
        $1,$2,$3,$4,$5,$6,$7
      ) AS value
    `, [
      actor.id,
      roleAssignmentId(actor),
      parsed.sessionId,
      parsed.action,
      parsed.reason,
      parsed.failureCode ?? null,
      now,
    ]);
    if (!result.rows[0]?.value) {
      throw new Error("The delivery tracking command is unavailable.");
    }
    return result.rows[0].value;
  });
}

export async function configureDeliveryTracking(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = trackingConfigurationSchema.parse(input);
  if (isDemoMode()) {
    return {
      sessionId: parsed.sessionId,
      status: "NOT_STARTED",
      destinationConfigured: parsed.destinationLatitude !== null,
    };
  }
  const now = new Date();
  return withAuditTransaction({
    actor,
    reason: parsed.reason,
    commandId: randomUUID(),
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_configure_delivery_tracking(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
      ) AS value
    `, [
      actor.id,
      roleAssignmentId(actor),
      parsed.sessionId,
      parsed.destinationLatitude,
      parsed.destinationLongitude,
      parsed.visibilityPrecision,
      parsed.showVehicleDetails,
      parsed.contactMode,
      parsed.rawRetentionDays,
      parsed.vehicleType,
      parsed.vehicleColour,
      parsed.vehicleRegistration,
      parsed.reason,
      now,
    ]);
    if (!result.rows[0]?.value) {
      throw new Error("The delivery tracking policy is unavailable.");
    }
    return result.rows[0].value;
  });
}

export async function controlSupervisorDeliveryTracking(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = trackingControlSchema.parse(input);
  if (isDemoMode()) return { sessionId: parsed.sessionId, status: parsed.action };
  const now = new Date();
  return withAuditTransaction({
    actor,
    reason: parsed.reason,
    commandId: randomUUID(),
  }, async (client) => {
    const result = await client.query<JsonRow<Record<string, unknown>>>(`
      SELECT public.axora_control_delivery_tracking(
        $1,$2,$3,$4,$5,NULL,$6
      ) AS value
    `, [
      actor.id,
      roleAssignmentId(actor),
      parsed.sessionId,
      parsed.action,
      parsed.reason,
      now,
    ]);
    if (!result.rows[0]?.value) {
      throw new Error("The delivery tracking command is unavailable.");
    }
    return result.rows[0].value;
  });
}

export const deliveryTrackingInternals = {
  trackingPointSchema,
  trackingFailureSchema,
  trackingConfigurationSchema,
  trackingControlSchema,
};

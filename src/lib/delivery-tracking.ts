import type { QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { deliveryExecutionDestinationInternals } from "./delivery-execution";
import { driverAvailableJobInternals } from "./driver-operations";

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
  action: z.enum(["REPORT_FAILURE", "PAUSE", "RESUME"]),
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

type DemoTrackingPoint = z.infer<typeof trackingPointSchema>;

type DemoTrackingSession = {
  actorId: string;
  assignmentId: string;
  sessionId: string;
  jobId: string;
  status: "NOT_STARTED" | "ACTIVE" | "PAUSED" | "ENDED";
  createdAt: string;
  startedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  lastFailureCode: string | null;
  lastFailureAt: string | null;
  latestPoint: DemoTrackingPoint | null;
  points: Map<string, { fingerprint: string; result: Record<string, unknown> }>;
  deviceSequences: Map<string, number>;
};

type DemoTrackingState = { sessionsByJob: Map<string, DemoTrackingSession> };

declare global {
  var __axoraDemoDeliveryTrackingState: DemoTrackingState | undefined;
}

function demoTrackingState() {
  if (!global.__axoraDemoDeliveryTrackingState) {
    global.__axoraDemoDeliveryTrackingState = { sessionsByJob: new Map() };
  }
  return global.__axoraDemoDeliveryTrackingState;
}

function directDistanceMeters(
  latitude: number,
  longitude: number,
  destinationLatitude: number,
  destinationLongitude: number,
) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(destinationLatitude - latitude);
  const longitudeDelta = radians(destinationLongitude - longitude);
  const originLatitude = radians(latitude);
  const targetLatitude = radians(destinationLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(targetLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(
    Math.sqrt(haversine),
    Math.sqrt(1 - haversine),
  ));
}

function synchronizedDemoTrackingSession(actor: AuthenticatedSessionUser) {
  const job = deliveryExecutionDestinationInternals
    .demoDeliveryExecutionWorkspace(actor).jobs[0];
  if (!job) return null;
  const state = demoTrackingState();
  let session = state.sessionsByJob.get(job.id);
  if (!session) {
    const now = new Date().toISOString();
    session = {
      actorId: actor.id,
      assignmentId: job.assignmentId,
      sessionId: randomUUID(),
      jobId: job.id,
      status: "NOT_STARTED",
      createdAt: now,
      startedAt: null,
      pausedAt: null,
      endedAt: null,
      updatedAt: now,
      lastFailureCode: null,
      lastFailureAt: null,
      latestPoint: null,
      points: new Map(),
      deviceSequences: new Map(),
    };
    state.sessionsByJob.set(job.id, session);
  }
  if (session.actorId !== actor.id || session.assignmentId !== job.assignmentId) {
    throw new Error("The delivery tracking workspace is unavailable.");
  }
  const terminal = ["COMPLETED", "CANCELLED", "FAILED", "RETURNED"]
    .includes(job.status);
  const inTransit = [
    "OUT_FOR_DELIVERY", "ARRIVED", "PARTIALLY_DELIVERED", "DELIVERED",
  ].includes(job.status);
  if (terminal && session.status !== "ENDED") {
    const now = new Date().toISOString();
    session.status = "ENDED";
    session.endedAt = now;
    session.updatedAt = now;
  } else if (inTransit && session.status === "NOT_STARTED") {
    const now = new Date().toISOString();
    session.status = "ACTIVE";
    session.startedAt = now;
    session.updatedAt = now;
  }
  return { job, session };
}

function demoDriverTrackingWorkspace(actor: AuthenticatedSessionUser): TrackingWorkspace {
  const synchronized = synchronizedDemoTrackingSession(actor);
  if (!synchronized || synchronized.session.status === "ENDED") {
    return { actorId: actor.id, capturedAt: new Date().toISOString(), sessions: [] };
  }
  const { job, session } = synchronized;
  const point = session.latestPoint;
  const destinationLatitude = typeof job.destinationLatitude === "number"
    ? job.destinationLatitude : null;
  const destinationLongitude = typeof job.destinationLongitude === "number"
    ? job.destinationLongitude : null;
  const remainingMeters = point && destinationLatitude !== null
    && destinationLongitude !== null
    ? directDistanceMeters(
      point.latitude,
      point.longitude,
      destinationLatitude,
      destinationLongitude,
    ) : null;
  const stale = !point || point.recordedAt.getTime() < Date.now() - 120_000;
  return {
    actorId: actor.id,
    capturedAt: new Date().toISOString(),
    sessions: [{
      sessionId: session.sessionId,
      jobId: job.id,
      jobCode: job.code,
      companyName: typeof job.companyName === "string" ? job.companyName : undefined,
      branchName: typeof job.branchName === "string" ? job.branchName : undefined,
      jobStatus: job.status,
      status: session.status,
      startedAt: session.startedAt,
      pausedAt: session.pausedAt,
      lastUpdatedAt: point?.recordedAt.toISOString() ?? session.updatedAt,
      pointCount: session.points.size,
      stale,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      locationAvailable: Boolean(point),
      accuracyMeters: point?.accuracyMeters ?? null,
      destinationLatitude,
      destinationLongitude,
      remainingMeters,
      etaSeconds: stale || remainingMeters === null ? null : Math.ceil(
        remainingMeters / Math.max(
          point?.speedMps && point.speedMps >= 1 ? point.speedMps : 8.33,
          1,
        ),
      ),
      routeMode: "DIRECT_ESTIMATE",
      visibilityPrecision: "APPROXIMATE",
      rawRetentionDays: 30,
      lastFailureCode: session.lastFailureCode,
      lastFailureAt: session.lastFailureAt,
    }],
  };
}

function demoCompanyTrackingWorkspace(actor: AuthenticatedSessionUser): TrackingWorkspace {
  const capturedAt = new Date().toISOString();
  if (actor.accountKind !== "COMPANY"
    || actor.companyId !== driverAvailableJobInternals.demoDeliveryCompanyId) {
    return { actorId: actor.id, capturedAt, sessions: [] };
  }
  const job = driverAvailableJobInternals.demoAvailableJob;
  const claim = driverAvailableJobInternals.demoDeliveryClaimState()
    .claimedByJob.get(job.id);
  const execution = deliveryExecutionDestinationInternals
    .demoDeliveryExecutionState().jobs.get(job.id);
  const session = demoTrackingState().sessionsByJob.get(job.id);
  const jobStatus = execution?.status ?? (claim ? "ASSIGNED" : "AWAITING_ASSIGNMENT");
  const terminal = ["COMPLETED", "CANCELLED", "FAILED", "RETURNED"].includes(jobStatus);
  if (session && terminal && session.status !== "ENDED") {
    session.status = "ENDED";
    session.endedAt = capturedAt;
    session.updatedAt = capturedAt;
  }
  const point = terminal ? null : session?.latestPoint ?? null;
  const latitude = point ? Math.round(point.latitude * 1_000) / 1_000 : null;
  const longitude = point ? Math.round(point.longitude * 1_000) / 1_000 : null;
  const destinationLatitude = terminal ? null : 3.152;
  const destinationLongitude = terminal ? null : 101.711;
  const remainingMeters = latitude !== null && longitude !== null
    && destinationLatitude !== null && destinationLongitude !== null
    ? directDistanceMeters(
      latitude,
      longitude,
      destinationLatitude,
      destinationLongitude,
    ) : null;
  const status = terminal ? "ENDED" : session?.status ?? "NOT_STARTED";
  const stale = status === "NOT_STARTED" || status === "ENDED"
    ? false
    : Boolean(point && point.recordedAt.getTime() < Date.now() - 120_000);
  return {
    actorId: actor.id,
    capturedAt,
    sessions: [{
      sessionId: session?.sessionId ?? job.id,
      jobId: job.id,
      jobCode: job.code,
      companyName: job.companyName,
      branchName: job.branchName,
      jobStatus,
      status,
      startedAt: session?.startedAt ?? null,
      pausedAt: session?.pausedAt ?? null,
      lastUpdatedAt: point?.recordedAt.toISOString()
        ?? session?.updatedAt
        ?? capturedAt,
      pointCount: session?.points.size ?? 0,
      stale,
      latitude,
      longitude,
      locationAvailable: latitude !== null && longitude !== null,
      accuracyMeters: point ? Math.max(point.accuracyMeters, 150) : null,
      destinationLatitude,
      destinationLongitude,
      remainingMeters,
      etaSeconds: stale || remainingMeters === null ? null : Math.ceil(
        remainingMeters / Math.max(
          point?.speedMps && point.speedMps >= 1 ? point.speedMps : 8.33,
          1,
        ),
      ),
      routeMode: "PRIVACY_SAFE_DIRECT_ESTIMATE",
      visibilityPrecision: "APPROXIMATE",
      rawRetentionDays: 0,
      showVehicleDetails: false,
      contactMode: "NONE",
    }],
  };
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
    if (capability === "axora_driver_delivery_tracking_workspace") {
      return demoDriverTrackingWorkspace(actor);
    }
    if (capability === "axora_company_delivery_tracking_workspace") {
      return demoCompanyTrackingWorkspace(actor);
    }
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
  ARRIVED: "ARRIVED",
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
      sessionId: `customer:${String(session.jobCode)}`,
      jobId: "",
      jobCode: session.jobCode,
      branchName: session.branchName,
      companyName: session.companyName,
      status: session.status,
      jobStatus: customerVisibleDeliveryStatus(session.jobStatus),
      lastUpdatedAt: session.lastUpdatedAt,
      stale: Boolean(session.stale),
      locationAvailable: Number.isFinite(session.latitude)
        && Number.isFinite(session.longitude),
      // The database capability has already applied the session's customer
      // visibility precision. Preserve those privacy-rounded coordinates so
      // the portal can render the real active route instead of a schematic.
      latitude: session.latitude,
      longitude: session.longitude,
      destinationLatitude: session.destinationLatitude,
      destinationLongitude: session.destinationLongitude,
      remainingMeters: session.remainingMeters,
      etaSeconds: session.etaSeconds,
      routeMode: session.routeMode,
      visibilityPrecision: "APPROXIMATE",
      showVehicleDetails: Boolean(session.showVehicleDetails),
      contactMode: session.contactMode === "AXORA_RELAY" ? "AXORA_RELAY" : "NONE",
      contactPath: session.contactMode === "AXORA_RELAY" ? session.contactPath : null,
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
    const synchronized = synchronizedDemoTrackingSession(actor);
    if (!synchronized || synchronized.session.sessionId !== parsed.sessionId
      || synchronized.session.status !== "ACTIVE") {
      throw new Error("The delivery location is unavailable.");
    }
    const { session } = synchronized;
    const fingerprint = JSON.stringify({
      ...parsed,
      recordedAt: parsed.recordedAt.toISOString(),
    });
    const replay = session.points.get(parsed.pointId);
    if (replay) {
      if (replay.fingerprint !== fingerprint) {
        throw new Error("The delivery location is unavailable.");
      }
      return { ...replay.result, replayed: true };
    }
    const previousSequence = session.deviceSequences.get(parsed.deviceId);
    if ((previousSequence !== undefined && parsed.deviceSequence <= previousSequence)
      || (session.latestPoint
        && parsed.recordedAt.getTime() <= session.latestPoint.recordedAt.getTime())) {
      throw new Error("The delivery location is out of order.");
    }
    const result = {
      pointId: parsed.pointId,
      sessionId: parsed.sessionId,
      acceptedAt: new Date().toISOString(),
      replayed: false,
    };
    session.points.set(parsed.pointId, { fingerprint, result });
    session.deviceSequences.set(parsed.deviceId, parsed.deviceSequence);
    session.latestPoint = parsed;
    session.updatedAt = result.acceptedAt;
    session.lastFailureCode = null;
    session.lastFailureAt = null;
    return result;
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

export async function controlDriverTracking(
  actor: AuthenticatedSessionUser,
  input: unknown,
) {
  const parsed = trackingFailureSchema.parse(input);
  if (isDemoMode()) {
    const synchronized = synchronizedDemoTrackingSession(actor);
    if (!synchronized || synchronized.session.sessionId !== parsed.sessionId) {
      throw new Error("The delivery tracking command is unavailable.");
    }
    const { session } = synchronized;
    if (parsed.action === "REPORT_FAILURE") {
      if (!(["ACTIVE", "PAUSED"] as const).includes(
        session.status as "ACTIVE" | "PAUSED",
      )) throw new Error("The delivery tracking command is unavailable.");
      session.lastFailureCode = parsed.failureCode ?? null;
      session.lastFailureAt = new Date().toISOString();
      session.updatedAt = session.lastFailureAt;
      return {
        sessionId: parsed.sessionId,
        status: session.status,
        failureCode: parsed.failureCode,
      };
    }
    const expected = parsed.action === "PAUSE" ? "ACTIVE" : "PAUSED";
    const next = parsed.action === "PAUSE" ? "PAUSED" : "ACTIVE";
    if (session.status !== expected && session.status !== next) {
      throw new Error("The delivery tracking command is unavailable.");
    }
    const now = new Date().toISOString();
    session.status = next;
    session.pausedAt = next === "PAUSED" ? now : session.pausedAt;
    session.updatedAt = now;
    return {
      sessionId: parsed.sessionId,
      status: next,
    };
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
  demoDriverTrackingWorkspace,
  demoTrackingState,
  trackingPointSchema,
  trackingFailureSchema,
  trackingConfigurationSchema,
  trackingControlSchema,
};

import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";

interface ValueRow<T> extends QueryResultRow { value: T | null }

export type AvailableDeliveryJob = {
  id: string;
  code: string;
  requestReference: string;
  companyName: string;
  branchName: string;
  area: string;
  destinationTimezone: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  lineCount: number;
  status: "AVAILABLE";
};

export type AvailableDeliveryWorkspace = {
  sequence: number;
  capturedAt: string;
  jobs: AvailableDeliveryJob[];
};

export type DriverManagementRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
  availability: "AVAILABLE" | "UNAVAILABLE" | "OFFLINE" | "DEACTIVATED";
  currentJobId?: string;
  currentJobCode?: string;
  currentJobStatus?: string;
  completedJobs: number;
  lastLatitude?: number;
  lastLongitude?: number;
  lastAccuracy?: number;
  lastLocationAt?: string;
  locationStale: boolean;
};

export type DriverManagementWorkspace = {
  sequence: number;
  capturedAt: string;
  drivers: DriverManagementRecord[];
};

export type DriverDetailWorkspace = {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  active: boolean;
  availability: string;
  jobs: Array<{
    id: string; code: string; status: string; companyName: string;
    branchName: string; assignedAt: string; endedAt?: string;
  }>;
  locations: Array<{ latitude: number; longitude: number; accuracy: number; capturedAt: string }>;
  recoveryEligibility?: {
    eligible: boolean;
    reasonCode: "TERMINAL_JOB" | "NO_ACTIVE_ASSIGNMENT" | "DRIVER_INACTIVE" | "ACCEPTANCE_EXPIRED" | "DRIVER_OFFLINE" | "TRACKING_STALE" | "WORKFLOW_STALE" | "HEALTHY_ACTIVE_JOB";
    reason: string;
    facts: Record<string, unknown>;
  };
};

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("Delivery workspace unavailable.");
  return actor.roleAssignmentId;
}

async function capability<T>(name: string, values: unknown[]) {
  const placeholders = values.map((_, index) => `$${index + 1}`).join(",");
  const result = await query<ValueRow<T>>(`SELECT public.${name}(${placeholders}) AS value`, values);
  if (!result.rows[0]?.value) throw new Error("Delivery workspace unavailable.");
  return result.rows[0].value;
}

function hideAvailableJobsWhileAssigned(
  workspace: AvailableDeliveryWorkspace,
  hasActiveAssignment: boolean,
): AvailableDeliveryWorkspace {
  return hasActiveAssignment && workspace.jobs.length
    ? { ...workspace, jobs: [] }
    : workspace;
}

const demoAvailableJob = Object.freeze({
  id: "10000000-0000-4000-8000-000000000001",
  code: "DEL-DEMO-AVAILABLE-001",
  requestReference: "REQ-DEMO-PAID-001",
  companyName: "Controlled demo company",
  branchName: "Kuala Lumpur receiving branch",
  area: "Kuala Lumpur",
  destinationTimezone: "Asia/Kuala_Lumpur",
  lineCount: 2,
  status: "AVAILABLE" as const,
});

type DemoClaimResult = {
  assignmentId: string;
  jobId: string;
  status: "ASSIGNED";
  created: true;
};

type DemoDeliveryClaimState = {
  sequence: number;
  claimedByJob: Map<string, { actorId: string; result: DemoClaimResult }>;
  commands: Map<string, { actorId: string; jobId: string; result: DemoClaimResult }>;
  availability: Map<string, "AVAILABLE" | "UNAVAILABLE">;
};

declare global {
  var __axoraDemoDeliveryClaimState: DemoDeliveryClaimState | undefined;
}

function demoDeliveryClaimState() {
  if (!global.__axoraDemoDeliveryClaimState) {
    global.__axoraDemoDeliveryClaimState = {
      sequence: 1,
      claimedByJob: new Map(),
      commands: new Map(),
      availability: new Map(),
    };
  }
  return global.__axoraDemoDeliveryClaimState;
}

function requireDemoDeliveryActor(actor: AuthenticatedSessionUser) {
  if (actor.accountKind !== "DELIVERY"
    || !["DELIVERY_GUY", "DELIVERY_AGENT"].includes(actor.role ?? "")) {
    throw new Error("Delivery job unavailable.");
  }
}

function deterministicDemoAssignmentId(actorId: string, commandId: string) {
  const bytes = createHash("sha256").update(`${actorId}:${commandId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function demoAvailableDeliveryJobs(actor: AuthenticatedSessionUser): AvailableDeliveryWorkspace {
  requireDemoDeliveryActor(actor);
  const state = demoDeliveryClaimState();
  const hasActiveAssignment = [...state.claimedByJob.values()]
    .some((claim) => claim.actorId === actor.id);
  const isAvailable = state.availability.get(actor.id) !== "UNAVAILABLE";
  return {
    sequence: state.sequence,
    capturedAt: new Date().toISOString(),
    jobs: isAvailable && !hasActiveAssignment
      && !state.claimedByJob.has(demoAvailableJob.id)
      ? [{ ...demoAvailableJob }]
      : [],
  };
}

function demoClaimedDeliveryJob(actorId: string) {
  const state = demoDeliveryClaimState();
  const claimed = [...state.claimedByJob.entries()].find(([, claim]) => (
    claim.actorId === actorId
  ));
  if (!claimed) return undefined;
  const [jobId, claim] = claimed;
  return jobId === demoAvailableJob.id
    ? { job: demoAvailableJob,claim: claim.result }
    : undefined;
}

export async function getAvailableDeliveryJobs(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return demoAvailableDeliveryJobs(actor);
  const at = new Date();
  return withAuditTransaction({ actor, reason: "Viewed available delivery jobs" }, async (client) => {
    const available = await client.query<ValueRow<AvailableDeliveryWorkspace>>(
      "SELECT public.axora_driver_available_jobs($1,$2,$3) AS value",
      [actor.id, assignmentId(actor), at],
    );
    const workspace = available.rows[0]?.value;
    if (!workspace) throw new Error("Delivery workspace unavailable.");
    const active = await client.query<{ present: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM public.delivery_job_assignments assignment
        JOIN public.delivery_jobs job ON job.id=assignment.delivery_job_id
        WHERE assignment.driver_user_id=$1
          AND assignment.driver_role_assignment_id=$2
          AND assignment.status IN ('ASSIGNED','ACCEPTED')
          AND assignment.ended_at IS NULL
          AND job.status NOT IN ('COMPLETED','CANCELLED','FAILED','RETURNED')
      ) AS present
    `, [actor.id, assignmentId(actor)]);
    return hideAvailableJobsWhileAssigned(workspace, active.rows[0]?.present === true);
  });
}

export const driverAvailableJobInternals = {
  demoAvailableDeliveryJobs,
  demoDeliveryClaimState,
  demoClaimedDeliveryJob,
  hideAvailableJobsWhileAssigned,
};

export async function claimAvailableDeliveryJob(actor: AuthenticatedSessionUser, jobId: string, commandId: string) {
  if (isDemoMode()) {
    requireDemoDeliveryActor(actor);
    const parsedJobId = z.string().uuid().parse(jobId);
    const parsedCommandId = z.string().uuid().parse(commandId);
    const state = demoDeliveryClaimState();
    const existing = state.commands.get(parsedCommandId);
    if (existing) {
      if (existing.actorId !== actor.id || existing.jobId !== parsedJobId) {
        throw new Error("Delivery job unavailable.");
      }
      return existing.result;
    }
    if (parsedJobId !== demoAvailableJob.id
      || state.availability.get(actor.id) === "UNAVAILABLE"
      || state.claimedByJob.has(parsedJobId)
      || [...state.claimedByJob.values()].some((claim) => claim.actorId === actor.id)) {
      throw new Error("This job was already claimed.");
    }
    const result: DemoClaimResult = Object.freeze({
      assignmentId: deterministicDemoAssignmentId(actor.id, parsedCommandId),
      jobId: parsedJobId,
      status: "ASSIGNED",
      created: true,
    });
    state.claimedByJob.set(parsedJobId, { actorId: actor.id, result });
    state.commands.set(parsedCommandId, { actorId: actor.id, jobId: parsedJobId, result });
    state.sequence += 1;
    return result;
  }
  return withAuditTransaction({ actor, reason: "Delivery job self-claimed", commandId }, async (client) => {
    const result = await client.query<ValueRow<{ assignmentId: string; jobId: string; status: string; created: boolean }>>(
      "SELECT public.axora_claim_available_delivery_job($1,$2,$3,$4,$5) AS value",
      [actor.id, assignmentId(actor), jobId, commandId, new Date()],
    );
    if (!result.rows[0]?.value) throw new Error("This job was already claimed.");
    return result.rows[0].value;
  });
}

export async function setDriverAvailability(actor: AuthenticatedSessionUser, availability: string) {
  if (isDemoMode()) {
    requireDemoDeliveryActor(actor);
    const parsed = z.enum(["AVAILABLE", "UNAVAILABLE"]).parse(availability);
    const state = demoDeliveryClaimState();
    state.availability.set(actor.id, parsed);
    state.sequence += 1;
    return parsed;
  }
  return capability<string>("axora_set_driver_availability", [actor.id, assignmentId(actor), availability, new Date()]);
}

export async function getDriverManagementWorkspace(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return { sequence: Date.now(), capturedAt: new Date().toISOString(), drivers: [] } satisfies DriverManagementWorkspace;
  return capability<DriverManagementWorkspace>("axora_driver_management_workspace", [actor.id, assignmentId(actor), new Date()]);
}

export async function getDriverDetailWorkspace(actor: AuthenticatedSessionUser, driverId: string) {
  if (isDemoMode()) return {
    id: driverId,
    name: "Demo Delivery Guy",
    email: "driver.fixture@axora.invalid",
    phone: "+60 12-000 0000",
    vehicle: "Axora van 01",
    active: true,
    availability: "AVAILABLE",
    jobs: [{ id: "10000000-0000-4000-8000-000000000001", code: "DEL-DEMO-001", status: "COMPLETED", companyName: "Demo company", branchName: "Kuala Lumpur", assignedAt: "2026-08-14T00:00:00.000Z", endedAt: "2026-08-14T01:00:00.000Z" }],
    locations: [
      { latitude: 3.139, longitude: 101.6869, accuracy: 18, capturedAt: "2026-08-14T00:45:00.000Z" },
      { latitude: 3.145, longitude: 101.695, accuracy: 12, capturedAt: "2026-08-14T00:46:00.000Z" },
    ],
  } satisfies DriverDetailWorkspace;
  try {
    const at = new Date();
    const detail = await capability<DriverDetailWorkspace>("axora_driver_detail_workspace", [actor.id, assignmentId(actor), driverId, at]);
    const activeJob = detail.jobs.find((job) => !["DELIVERED", "COMPLETED", "CANCELLED", "FAILED", "RETURNED"].includes(job.status));
    if (!activeJob) return detail;
    const recoveryEligibility = await capability<NonNullable<DriverDetailWorkspace["recoveryEligibility"]>>(
      "axora_delivery_recovery_eligibility",
      [actor.id, assignmentId(actor), activeJob.id, at],
    );
    return { ...detail, recoveryEligibility };
  } catch {
    return null;
  }
}

export async function releaseStuckDeliveryJob(
  actor: AuthenticatedSessionUser,
  jobId: string,
  commandId: string,
  reason: string,
) {
  if (isDemoMode()) throw new Error("The demo delivery is healthy and cannot be released.");
  return withAuditTransaction({ actor, reason: "Stuck delivery recovery", commandId }, async (client) => {
    const result = await client.query<ValueRow<Record<string, unknown>>>(
      "SELECT public.axora_release_stuck_delivery_job($1,$2,$3,$4,$5,$6) AS value",
      [actor.id, assignmentId(actor), jobId, commandId, reason, new Date()],
    );
    if (!result.rows[0]?.value) throw new Error("Delivery recovery unavailable.");
    return result.rows[0].value;
  });
}

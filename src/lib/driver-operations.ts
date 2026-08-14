import type { QueryResultRow } from "pg";
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

export async function getAvailableDeliveryJobs(actor: AuthenticatedSessionUser) {
  if (isDemoMode()) return { sequence: Date.now(), capturedAt: new Date().toISOString(), jobs: [] } satisfies AvailableDeliveryWorkspace;
  return capability<AvailableDeliveryWorkspace>("axora_driver_available_jobs", [actor.id, assignmentId(actor), new Date()]);
}

export async function claimAvailableDeliveryJob(actor: AuthenticatedSessionUser, jobId: string, commandId: string) {
  if (isDemoMode()) return { assignmentId: "demo", jobId, status: "ASSIGNED", created: true };
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
  if (isDemoMode()) return availability;
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
    return await capability<DriverDetailWorkspace>("axora_driver_detail_workspace", [actor.id, assignmentId(actor), driverId, new Date()]);
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
  if (isDemoMode()) return { jobId, released: true, status: "AWAITING_ASSIGNMENT" };
  return withAuditTransaction({ actor, reason: "Stuck delivery recovery", commandId }, async (client) => {
    const result = await client.query<ValueRow<Record<string, unknown>>>(
      "SELECT public.axora_release_stuck_delivery_job($1,$2,$3,$4,$5,$6) AS value",
      [actor.id, assignmentId(actor), jobId, commandId, reason, new Date()],
    );
    if (!result.rows[0]?.value) throw new Error("Delivery recovery unavailable.");
    return result.rows[0].value;
  });
}

import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import { authorize } from "@/lib/authorization-policy";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { demoCompanyVisibleToActor } from "@/lib/company-lifecycle";
import {
  deliveryCoordinatesSchema,
  type DeliveryCoordinates,
} from "@/lib/delivery-navigation";
import { isDemoMode, query, withAuditTransaction } from "@/lib/db";
import { loadEffectiveAccess } from "@/lib/effective-access";
import { loadOrganizationDirectory } from "@/lib/organization-access";

const uuid = z.string().uuid();
const demoBranchId = z.string().regex(/^br-[a-z0-9-]{3,80}$/);
const safeOperationalText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

const coordinateText = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const rawLocationSchema = z.strictObject({
  id: uuid,
  addressLabel: z.string().trim().min(3).max(5_000),
  latitude: coordinateText.nullable(),
  longitude: coordinateText.nullable(),
  instructions: z.string().max(5_000).nullable(),
  updatedAt: z.coerce.date(),
}).superRefine((location, context) => {
  if ((location.latitude === null) !== (location.longitude === null)) {
    context.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "Delivery coordinates must be paired.",
    });
  }
});

const rawWorkspaceSchema = z.strictObject({
  capturedAt: z.coerce.date(),
  companyId: uuid,
  branchId: uuid,
  branchName: z.string().trim().min(1).max(300),
  canManage: z.boolean(),
  location: rawLocationSchema.nullable(),
  commandId: uuid.optional(),
});

const saveInputSchema = z.strictObject({
  branchId: uuid,
  addressLabel: safeOperationalText(3, 5_000),
  coordinates: deliveryCoordinatesSchema,
  instructions: safeOperationalText(0, 5_000).optional(),
  reason: safeOperationalText(3, 1_000),
  commandId: uuid,
});
const demoSaveInputSchema = saveInputSchema.extend({ branchId: demoBranchId });

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export type BranchDeliveryLocation = {
  id: string;
  addressLabel: string;
  coordinates: DeliveryCoordinates | null;
  instructions?: string;
  updatedAt: Date;
};

export type BranchDeliveryLocationWorkspace = {
  capturedAt: Date;
  companyId: string;
  branchId: string;
  branchName: string;
  canManage: boolean;
  location: BranchDeliveryLocation | null;
};

export type SaveBranchDeliveryLocationInput = z.infer<typeof saveInputSchema>;

export class BranchDeliveryLocationUnavailableError extends Error {
  constructor() {
    super("The branch delivery location is unavailable.");
    this.name = "BranchDeliveryLocationUnavailableError";
  }
}

type DemoLocationCommand = {
  payloadHash: string;
  location: BranchDeliveryLocation;
};

type DemoLocationState = {
  locations: Map<string, BranchDeliveryLocation>;
  commands: Map<string, DemoLocationCommand>;
};

declare global {
  var __axoraDemoDeliveryLocationState: DemoLocationState | undefined;
}

function demoLocationState() {
  if (!global.__axoraDemoDeliveryLocationState) {
    global.__axoraDemoDeliveryLocationState = {
      locations: new Map(),
      commands: new Map(),
    };
  }
  return global.__axoraDemoDeliveryLocationState;
}

function assignmentId(actor: AuthenticatedSessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new BranchDeliveryLocationUnavailableError();
  return parsed.data;
}

function parseWorkspace(
  value: unknown,
  expectedBranchId: string,
  expectedCapturedAt: Date,
): BranchDeliveryLocationWorkspace & { commandId?: string } {
  const parsed = rawWorkspaceSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.branchId !== expectedBranchId
    || parsed.data.capturedAt.getTime() !== expectedCapturedAt.getTime()) {
    throw new BranchDeliveryLocationUnavailableError();
  }

  let location: BranchDeliveryLocation | null = null;
  if (parsed.data.location) {
    const rawLocation = parsed.data.location;
    let coordinates: DeliveryCoordinates | null = null;
    if (rawLocation.latitude !== null && rawLocation.longitude !== null) {
      const coordinateResult = deliveryCoordinatesSchema.safeParse({
        latitude: Number(rawLocation.latitude),
        longitude: Number(rawLocation.longitude),
      });
      if (!coordinateResult.success) throw new BranchDeliveryLocationUnavailableError();
      coordinates = Object.freeze(coordinateResult.data);
    }
    location = {
      id: rawLocation.id,
      addressLabel: rawLocation.addressLabel,
      coordinates,
      ...(rawLocation.instructions ? { instructions: rawLocation.instructions } : {}),
      updatedAt: rawLocation.updatedAt,
    };
  }

  return {
    capturedAt: parsed.data.capturedAt,
    companyId: parsed.data.companyId,
    branchId: parsed.data.branchId,
    branchName: parsed.data.branchName,
    canManage: parsed.data.canManage,
    location,
    ...(parsed.data.commandId ? { commandId: parsed.data.commandId } : {}),
  };
}

async function loadDemoWorkspace(
  actor: AuthenticatedSessionUser,
  branchId: string,
  capturedAt: Date,
): Promise<BranchDeliveryLocationWorkspace | null> {
  const [directory, effective] = await Promise.all([
    loadOrganizationDirectory(actor, capturedAt),
    loadEffectiveAccess(actor, capturedAt),
  ]);
  const branch = directory.branches.find((candidate) => candidate.id === branchId);
  if (!branch || branch.status !== "Active"
    || !demoCompanyVisibleToActor(actor, branch.companyId)) return null;
  const branchScope = {
    type: "BRANCH" as const,
    companyId: branch.companyId,
    branchId: branch.id,
  };
  const canManage = authorize({
    subject: effective.subject,
    permission: "organization.delivery_location.manage",
    resource: { scope: branchScope },
    now: capturedAt,
  }).allowed;
  const savedLocation = demoLocationState().locations.get(branch.id);
  return {
    capturedAt,
    companyId: branch.companyId,
    branchId: branch.id,
    branchName: branch.name,
    canManage,
    location: savedLocation ?? (branch.deliveryAddress ? {
      id: branch.id,
      addressLabel: branch.deliveryAddress,
      coordinates: null,
      ...(branch.deliveryInstructions ? { instructions: branch.deliveryInstructions } : {}),
      updatedAt: capturedAt,
    } : null),
  };
}

export async function loadBranchDeliveryLocationWorkspace(
  actor: AuthenticatedSessionUser,
  branchIdInput: string,
  capturedAt = new Date(),
) {
  const branchId = (isDemoMode() ? demoBranchId : uuid).safeParse(branchIdInput);
  if (!branchId.success || !Number.isFinite(capturedAt.getTime())) {
    throw new BranchDeliveryLocationUnavailableError();
  }
  if (isDemoMode()) return loadDemoWorkspace(actor, branchId.data, capturedAt);

  try {
    const result = await query<SnapshotRow>(
      `SELECT public.axora_branch_delivery_location_workspace(
         $1,$2,$3,$4
       ) AS snapshot`,
      [actor.id, assignmentId(actor), branchId.data, capturedAt],
    );
    if (result.rowCount !== 1 || !result.rows[0]?.snapshot) return null;
    return parseWorkspace(result.rows[0].snapshot, branchId.data, capturedAt);
  } catch (error) {
    if (error instanceof BranchDeliveryLocationUnavailableError) throw error;
    throw new BranchDeliveryLocationUnavailableError();
  }
}

export async function saveBranchDeliveryLocation(
  actor: AuthenticatedSessionUser,
  value: unknown,
) {
  const demo = isDemoMode();
  const input = (demo ? demoSaveInputSchema : saveInputSchema).parse(value);
  const capturedAt = new Date();
  if (demo) {
    const workspace = await loadDemoWorkspace(actor, input.branchId, capturedAt);
    if (!workspace?.canManage) throw new BranchDeliveryLocationUnavailableError();
    const state = demoLocationState();
    const commandKey = `${actor.id}:${input.commandId}`;
    const payloadHash = createHash("sha256").update(JSON.stringify({
      actorId: actor.id,
      branchId: input.branchId,
      addressLabel: input.addressLabel,
      latitude: input.coordinates.latitude.toFixed(6),
      longitude: input.coordinates.longitude.toFixed(6),
      instructions: input.instructions ?? "",
      reason: input.reason,
    })).digest("hex");
    const existing = state.commands.get(commandKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new BranchDeliveryLocationUnavailableError();
      }
      return { ...workspace, location: existing.location };
    }
    const location: BranchDeliveryLocation = Object.freeze({
      id: `demo-location-${input.branchId}`,
      addressLabel: input.addressLabel,
      coordinates: Object.freeze({ ...input.coordinates }),
      ...(input.instructions ? { instructions: input.instructions } : {}),
      updatedAt: capturedAt,
    });
    state.locations.set(input.branchId, location);
    state.commands.set(commandKey, { payloadHash, location });
    return { ...workspace, location };
  }
  try {
    return await withAuditTransaction({
      actor,
      reason: input.reason,
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<SnapshotRow>(
        `SELECT public.axora_save_branch_delivery_location(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         ) AS snapshot`,
        [
          actor.id,
          assignmentId(actor),
          input.branchId,
          input.addressLabel,
          input.coordinates.latitude.toFixed(6),
          input.coordinates.longitude.toFixed(6),
          input.instructions ?? "",
          input.reason,
          input.commandId,
          capturedAt,
        ],
      );
      const workspace = parseWorkspace(
        result.rows[0]?.snapshot,
        input.branchId,
        capturedAt,
      );
      if (!workspace.canManage || workspace.commandId !== input.commandId) {
        throw new BranchDeliveryLocationUnavailableError();
      }
      return workspace;
    });
  } catch (error) {
    if (error instanceof BranchDeliveryLocationUnavailableError) throw error;
    throw new BranchDeliveryLocationUnavailableError();
  }
}

export const branchDeliveryLocationInternals = {
  parseWorkspace,
  rawWorkspaceSchema,
  saveInputSchema,
};

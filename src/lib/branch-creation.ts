import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { saveBranchDeliveryLocation } from "@/lib/branch-delivery-location";
import { isDemoMode, withAuditTransaction } from "@/lib/db";
import { getDemoStore } from "@/lib/demo-data";
import { canAccess } from "@/lib/permissions";

const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

export const createBranchWithLocationSchema = z.strictObject({
  companyId: z.string().uuid(),
  name: text(2, 300),
  branchCode: text(2, 50).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
  city: text(2, 300),
  addressLabel: text(3, 5_000),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  providerId: text(2, 100),
  providerPlaceId: text(0, 500).optional(),
  providerAttribution: text(0, 1_000).optional(),
  contactName: text(2, 300),
  contactPhone: text(5, 120),
  contactEmail: z.union([z.literal(""), z.email().max(320)]),
  deliveryInstructions: text(0, 5_000).optional(),
  notes: text(0, 1_000).optional(),
  commandId: z.string().uuid(),
});

export type CreateBranchWithLocationInput = z.infer<typeof createBranchWithLocationSchema>;

interface ResultRow extends QueryResultRow { result: { branchId?: string } | null }

export class BranchCreationError extends Error {
  constructor(public readonly code: "INVALID" | "FORBIDDEN" | "DUPLICATE" | "UNAVAILABLE") {
    super(code);
    this.name = "BranchCreationError";
  }
}

function resolvedCompany(actor: AuthenticatedSessionUser, requested: string) {
  if (actor.accountKind === "COMPANY") {
    if (!actor.companyId || requested !== actor.companyId) throw new BranchCreationError("FORBIDDEN");
    return actor.companyId;
  }
  if (actor.accountKind === "PLATFORM" && canAccess(actor, "view_all_companies")) return requested;
  throw new BranchCreationError("FORBIDDEN");
}

export async function createBranchWithLocation(actor: AuthenticatedSessionUser, value: unknown) {
  const parsed = createBranchWithLocationSchema.safeParse(value);
  if (!parsed.success || !canAccess(actor, "manage_branches")) throw new BranchCreationError("INVALID");
  const input = { ...parsed.data, companyId: resolvedCompany(actor, parsed.data.companyId) };
  if (isDemoMode()) {
    const store = getDemoStore();
    const company = store.companies.find((candidate) => candidate.id === input.companyId && candidate.status === "Active");
    if (!company) throw new BranchCreationError("UNAVAILABLE");
    if (store.branches.some((branch) => branch.companyId === input.companyId
      && (branch.name.trim().toLowerCase() === input.name.toLowerCase() || branch.branchCode.toLowerCase() === input.branchCode.toLowerCase()))) {
      throw new BranchCreationError("DUPLICATE");
    }
    const branchId = `br-${randomUUID()}`;
    store.branches.push({
      id: branchId, code: `B-${String(store.branches.length + 1).padStart(3, "0")}`,
      companyId: input.companyId, companyName: company.name, name: input.name,
      branchCode: input.branchCode.toUpperCase(), deliveryAddress: input.addressLabel,
      city: input.city, contactName: input.contactName, contactPhone: input.contactPhone,
      contactEmail: input.contactEmail, deliveryInstructions: input.deliveryInstructions,
      notes: input.notes, committedAmount: 0, status: "Active",
    });
    await saveBranchDeliveryLocation(actor, {
      branchId, addressLabel: input.addressLabel,
      coordinates: { latitude: input.latitude, longitude: input.longitude },
      instructions: input.deliveryInstructions, providerId: input.providerId,
      providerPlaceId: input.providerPlaceId, providerAttribution: input.providerAttribution,
      reason: "BRANCH_CREATED_WITH_PRIMARY_LOCATION", commandId: input.commandId,
    });
    return branchId;
  }
  if (!actor.roleAssignmentId) throw new BranchCreationError("FORBIDDEN");
  try {
    return await withAuditTransaction({ actor, reason: "BRANCH_CREATED_WITH_PRIMARY_LOCATION", commandId: input.commandId }, async (client) => {
      const result = await client.query<ResultRow>(
        "SELECT public.axora_create_branch_with_primary_location($1,$2,$3::jsonb,$4,$5) AS result",
        [actor.id, actor.roleAssignmentId, JSON.stringify(input), input.commandId, new Date()],
      );
      const branchId = result.rows[0]?.result?.branchId;
      if (!branchId || !z.string().uuid().safeParse(branchId).success) throw new BranchCreationError("UNAVAILABLE");
      return branchId;
    });
  } catch (error) {
    if (error instanceof BranchCreationError) throw error;
    const databaseError = error as { code?: string; constraint?: string; message?: string };
    if (databaseError.code === "23505") throw new BranchCreationError("DUPLICATE");
    throw new BranchCreationError("UNAVAILABLE");
  }
}

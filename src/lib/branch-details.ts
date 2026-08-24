import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { isDemoMode, withAuditTransaction } from "@/lib/db";
import { getDemoStore } from "@/lib/demo-data";
import { canAccess } from "@/lib/permissions";

const cleanText = (minimum: number, maximum: number) => z.string().trim()
  .min(minimum).max(maximum)
  .refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));

export const branchDetailsSchema = z.strictObject({
  branchId: z.string().uuid(),
  name: cleanText(2, 300),
  city: cleanText(2, 300),
  contactName: cleanText(2, 300),
  contactPhone: cleanText(5, 120),
  contactEmail: z.union([z.literal(""), z.email().max(320)]),
  notes: cleanText(0, 1_000).optional(),
  commandId: z.string().uuid(),
});

const demoBranchDetailsSchema = branchDetailsSchema.extend({
  branchId: z.string().regex(/^br-[a-z0-9-]{3,80}$/),
});

type BranchDetailsInput = z.infer<typeof branchDetailsSchema>;

interface ResultRow extends QueryResultRow {
  result: { status?: string; branchId?: string } | null;
}
const demoCommands = new Map<string, string>();

export class BranchDetailsError extends Error {
  constructor(public readonly code: "INVALID" | "FORBIDDEN" | "DUPLICATE" | "UNAVAILABLE") {
    super(code);
    this.name = "BranchDetailsError";
  }
}

export async function updateBranchDetails(
  actor: AuthenticatedSessionUser,
  value: unknown,
) {
  const demo = isDemoMode();
  const parsed = (demo ? demoBranchDetailsSchema : branchDetailsSchema).safeParse(value);
  if (!parsed.success || !canAccess(actor, "manage_branches")) {
    throw new BranchDetailsError("INVALID");
  }
  const input = parsed.data as BranchDetailsInput;
  if (demo) {
    const branch = getDemoStore().branches.find((candidate) => candidate.id === input.branchId);
    const inScope = branch && (actor.accountKind === "PLATFORM"
      || (branch.companyId === actor.companyId && (!actor.branchId || actor.branchId === branch.id)));
    if (!branch || !inScope) throw new BranchDetailsError("FORBIDDEN");
    const commandKey = `${actor.id}:${input.commandId}`;
    const payloadHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = demoCommands.get(commandKey);
    if (existing && existing !== payloadHash) throw new BranchDetailsError("UNAVAILABLE");
    if (existing) return branch.id;
    if (getDemoStore().branches.some((candidate) => candidate.id !== branch.id
      && candidate.companyId === branch.companyId
      && candidate.name.trim().toLocaleLowerCase() === input.name.toLocaleLowerCase())) {
      throw new BranchDetailsError("DUPLICATE");
    }
    Object.assign(branch, {
      name: input.name,
      city: input.city,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      notes: input.notes || undefined,
    });
    demoCommands.set(commandKey, payloadHash);
    return branch.id;
  }
  if (!actor.roleAssignmentId) throw new BranchDetailsError("FORBIDDEN");
  try {
    return await withAuditTransaction({
      actor,
      reason: "BRANCH_DETAILS_UPDATED",
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<ResultRow>(
        "SELECT public.axora_update_branch_details($1,$2,$3,$4::jsonb,$5,$6) AS result",
        [
          actor.id,
          actor.roleAssignmentId,
          input.branchId,
          JSON.stringify({
            name: input.name,
            city: input.city,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            contactEmail: input.contactEmail,
            notes: input.notes ?? "",
          }),
          input.commandId,
          new Date(),
        ],
      );
      const updated = result.rows[0]?.result;
      if (updated?.status !== "UPDATED" || updated.branchId !== input.branchId) {
        throw new BranchDetailsError("UNAVAILABLE");
      }
      return input.branchId;
    });
  } catch (error) {
    if (error instanceof BranchDetailsError) throw error;
    if ((error as { code?: string }).code === "23505") {
      throw new BranchDetailsError("DUPLICATE");
    }
    throw new BranchDetailsError("UNAVAILABLE");
  }
}

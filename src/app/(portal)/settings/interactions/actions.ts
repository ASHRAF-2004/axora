"use server";

import { requirePermission } from "@/lib/auth";
import {
  InteractionConfigSchema,
  OwnerInteractionChoiceSchema,
  interactionProfileFromCompany,
  recommendInteraction,
  type InteractionConfig,
  type OwnerInteractionChoice,
} from "@/lib/interactions";
import {
  clearCompanyInteractionOverride,
  publishCompanyInteraction,
  regenerateCompanyInteractionRecommendation,
  rollbackCompanyInteraction,
  saveCompanyInteractionOverride,
} from "@/lib/interactions/repository";
import { listCompanies } from "@/lib/repository";
import { revalidatePath } from "next/cache";

function revalidateInteractionEditor() {
  revalidatePath("/settings/interactions");
}

export async function regenerateInteractionRecommendationAction(
  companyId: string | undefined,
) {
  const actor = await requirePermission("manage_interactions");
  const selectedCompanyId = actor.isOwner ? companyId : actor.companyId;
  const company = (await listCompanies(actor)).find(
    (candidate) => candidate.id === selectedCompanyId,
  );
  if (!company) throw new Error("The selected company is unavailable or inactive.");
  const recommendation = recommendInteraction(
    interactionProfileFromCompany(company),
  );
  const workspace = await regenerateCompanyInteractionRecommendation(
    companyId,
    recommendation,
    actor,
  );
  revalidateInteractionEditor();
  return workspace;
}

export async function saveInteractionOverrideAction(
  companyId: string | undefined,
  choiceInput: OwnerInteractionChoice,
) {
  const actor = await requirePermission("manage_interactions");
  const choice = OwnerInteractionChoiceSchema.parse(choiceInput);
  const workspace = await saveCompanyInteractionOverride(
    companyId,
    choice,
    actor,
  );
  revalidateInteractionEditor();
  return workspace;
}

export async function clearInteractionOverrideAction(companyId?: string) {
  const actor = await requirePermission("manage_interactions");
  const workspace = await clearCompanyInteractionOverride(companyId, actor);
  revalidateInteractionEditor();
  return workspace;
}

export async function publishInteractionAction(
  companyId: string | undefined,
  configInput: InteractionConfig,
) {
  const actor = await requirePermission("manage_interactions");
  const config = InteractionConfigSchema.parse(configInput);
  const revision = await publishCompanyInteraction(companyId, config, actor);
  revalidateInteractionEditor();
  return revision;
}

export async function rollbackInteractionAction(
  companyId: string | undefined,
  revisionId: string,
) {
  const actor = await requirePermission("manage_interactions");
  const revision = await rollbackCompanyInteraction(
    companyId,
    revisionId,
    actor,
  );
  revalidateInteractionEditor();
  return revision;
}

export async function rollbackInteractionRevisionFormAction(formData: FormData) {
  const companyId = String(formData.get("companyId") ?? "").trim() || undefined;
  const revisionId = String(formData.get("revisionId") ?? "").trim();
  await rollbackInteractionAction(companyId, revisionId);
}

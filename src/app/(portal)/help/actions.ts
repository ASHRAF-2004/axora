"use server";

import { requireAccountLifecycleSession } from "@/lib/auth";
import { updateTutorialStep, type TutorialStepStatus } from "@/lib/onboarding";
import { revalidatePath } from "next/cache";

export async function updateTutorialStepAction(input: {
  roleKey: string;
  stepKey: string;
  status: TutorialStepStatus;
}) {
  const actor = await requireAccountLifecycleSession();
  await updateTutorialStep(input, actor);
  revalidatePath("/help");
  revalidatePath("/dashboard");
}

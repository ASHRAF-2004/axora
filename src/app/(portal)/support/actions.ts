"use server";

import { requirePermission } from "@/lib/auth";
import {
  diagnoseSupportAccount,
  revokeSupportTargetSessions,
  type SupportAccountDiagnostic,
} from "@/lib/support-diagnostics";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type SupportDiagnosticActionState = {
  status: "idle" | "found" | "not_found" | "invalid" | "unavailable";
  diagnostic?: SupportAccountDiagnostic;
};

export async function diagnoseSupportAccountAction(
  _previous: SupportDiagnosticActionState,
  formData: FormData,
): Promise<SupportDiagnosticActionState> {
  const actor = await requirePermission("view_system_diagnostics");
  try {
    const diagnostic = await diagnoseSupportAccount(
      actor,
      String(formData.get("email") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    return diagnostic
      ? { status: "found", diagnostic }
      : { status: "not_found" };
  } catch (error) {
    if (error instanceof Error
      && ["invalid_email", "invalid_reason"].includes(error.message)) {
      return { status: "invalid" };
    }
    return { status: "unavailable" };
  }
}

export async function revokeSupportSessionsAction(
  targetId: string,
  formData: FormData,
) {
  const actor = await requirePermission("view_system_diagnostics");
  try {
    const count = await revokeSupportTargetSessions(
      actor,
      targetId,
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/support");
    redirect(`/support?notice=sessions-revoked&count=${Math.min(999, count)}`);
  } catch (error) {
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect("/support?notice=session-action-denied");
  }
}

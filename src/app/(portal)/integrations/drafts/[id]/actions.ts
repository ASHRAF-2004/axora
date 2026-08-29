"use server";

import { requirePermission } from "@/lib/auth";
import {
  importIntegrationRequestDraft,
  IntegrationDraftReviewError,
} from "@/lib/integrations/request-drafts";
import { redirect } from "next/navigation";

export async function importIntegrationRequestDraftAction(draftId: string) {
  const actor = await requirePermission("create_requests");
  try {
    const result = await importIntegrationRequestDraft(actor,draftId);
    if (result.status === "SUBMITTED") {
      redirect(`/requests/${encodeURIComponent(result.requestId)}`);
    }
    const query = new URLSearchParams({
      branch:result.branchId,
      integrationDraft:result.draftId,
    });
    redirect(`/requests/new?${query.toString()}`);
  } catch (error) {
    if (!(error instanceof IntegrationDraftReviewError)) throw error;
    redirect(`/integrations/drafts/${encodeURIComponent(draftId)}?notice=${error.reason.toLowerCase()}`);
  }
}

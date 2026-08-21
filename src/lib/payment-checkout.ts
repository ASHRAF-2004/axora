import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query } from "./db";

export interface FinalInvoiceSummary {
  invoiceId: string;
  invoiceNumber: string;
  status: "FINALIZED";
  paymentStatus: "PAID";
  amount: string;
  currency: string;
  issuedAt: string;
  paidAt: string;
  documentId?: string;
  downloadUrl?: string;
  emailStatus?: string;
}

interface ValueRow<T> extends QueryResultRow { value: T | null }

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("The request is unavailable.");
  return actor.roleAssignmentId;
}

export async function getFinalInvoiceSummary(
  actor: AuthenticatedSessionUser,
  requestId: string,
) {
  if (isDemoMode()) return null;
  const result = await query<ValueRow<FinalInvoiceSummary>>(
    "SELECT public.axora_final_invoice_summary($1,$2,$3,$4) AS value",
    [actor.id, assignmentId(actor), requestId, new Date()],
  );
  return result.rows[0]?.value ?? null;
}

import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { INTERNAL_PAYMENT_STRATEGY } from "./types";

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

export async function completePayment(
  actor: AuthenticatedSessionUser,
  requestId: string,
  idempotencyKey: string,
) {
  if (isDemoMode()) throw new Error("Payment is unavailable in demonstration mode.");
  return withAuditTransaction(
    { actor, reason: "Checkout payment completed", reasonCode: "payment.checkout.complete" },
    async (client) => {
      const result = await client.query<ValueRow<FinalInvoiceSummary>>(
        "SELECT public.axora_complete_payment($1,$2,$3,$4,$5,$6) AS value",
        [actor.id, assignmentId(actor), requestId, INTERNAL_PAYMENT_STRATEGY,
          idempotencyKey, new Date()],
      );
      if (!result.rows[0]?.value) throw new Error("Payment could not be completed.");
      return result.rows[0].value;
    },
  );
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

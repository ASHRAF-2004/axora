import type { AuthenticatedSessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";

export type CompanyDeletionImpact = {
  companyId: string; companyCode: string; confirmation: string;
  users: number; memberships: number; branches: number; departments: number;
  roleAssignments: number; sessions: number; requests: number; budgets: number;
  approvalPolicies: number;
  invoices: number; finalizedInvoices: number; paidPayments: number;
  deliveries: number; completedDeliveries: number; receipts: number;
  documents: number; branding: number;
  notifications: number; workflowEvents: number; protectedEvidence: number;
  lifecycleHistory: number; pendingInvitations: number; pendingWorkflowEmails: number;
  inFlightWork: number;
  hardDeleteEligible: boolean;
};

function assignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId || !actor.isOwner) throw new Error("Company deletion is unavailable.");
  return actor.roleAssignmentId;
}

export async function getCompanyDeletionImpact(actor: AuthenticatedSessionUser, companyId: string) {
  if (isDemoMode()) return { companyId, companyCode: "DEMO", confirmation: "DELETE DEMO", users: 0, memberships: 0, branches: 0, departments: 0, roleAssignments: 0, sessions: 0, requests: 0, budgets: 0, approvalPolicies: 0, invoices: 0, finalizedInvoices: 0, paidPayments: 0, deliveries: 0, completedDeliveries: 0, receipts: 0, documents: 0, branding: 0, notifications: 0, workflowEvents: 0, lifecycleHistory: 0, pendingInvitations: 0, pendingWorkflowEmails: 0, inFlightWork: 0, protectedEvidence: 0, hardDeleteEligible: true } satisfies CompanyDeletionImpact;
  const result = await query<{ value: CompanyDeletionImpact }>(
    "SELECT public.axora_company_deletion_impact($1,$2,$3,$4) AS value",
    [actor.id, assignment(actor), companyId, new Date()],
  );
  if (!result.rows[0]?.value) throw new Error("Company deletion is unavailable.");
  return result.rows[0].value;
}

export async function deleteOrArchiveCompany(actor: AuthenticatedSessionUser, input: { companyId: string; confirmation: string; reason: string }) {
  if (isDemoMode()) return { companyId: input.companyId, mode: "HARD_DELETED" };
  return withAuditTransaction({ actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ value: Record<string, unknown> }>(
      "SELECT public.axora_delete_or_archive_company($1,$2,$3,$4,$5,$6) AS value",
      [actor.id, assignment(actor), input.companyId, input.confirmation, input.reason, new Date()],
    );
    return result.rows[0]?.value;
  });
}

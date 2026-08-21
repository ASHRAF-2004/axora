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
  wallets: number; walletTopUpRequests: number; walletLedgerEntries: number;
  walletTopUpEvents: number; approveAndPayCommands: number;
  walletProtectedEvidence: number;
  lifecycleHistory: number; pendingInvitations: number; pendingWorkflowEmails: number;
  inFlightWork: number;
  hardDeleteEligible: boolean;
  recommendedMode: "HARD_DELETE" | "ARCHIVE_RETAIN" | "BLOCK";
  ownership: Record<string, {
    count: number;
    unprotectedAction: "HARD_DELETE" | "CASCADE_DELETE" | "ANONYMIZE_AND_RETAIN" | "RETAIN_WITH_ACCESS_REVOKED" | "BLOCK";
    protectedAction: "HARD_DELETE" | "CASCADE_DELETE" | "ANONYMIZE_AND_RETAIN" | "RETAIN_WITH_ACCESS_REVOKED" | "BLOCK";
  }>;
  externalFileCount: number;
  externalCleanupRequired: boolean;
  retentionPolicy: string;
};

export type CompanyDeletionCommandStatus = {
  commandId: string;
  companyId: string;
  companyCode: string;
  mode: "HARD_DELETE" | "ARCHIVE_RETAIN";
  status: "RUNNING" | "DATABASE_COMPLETE" | "CLEANUP_PENDING" | "COMPLETE" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  result: Record<string, unknown> | null;
  tasks: Array<{
    taskId: string;
    kind: "FILE" | "CACHE" | "SEARCH_INDEX";
    status: "PENDING" | "LEASED" | "RETRY_WAIT" | "COMPLETE" | "TERMINAL_FAILED";
    attempts: number;
    maximumAttempts: number;
    availableAt: string;
    lastError: string | null;
    completedAt: string | null;
  }>;
};

function assignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId || !actor.isOwner) throw new Error("Company deletion is unavailable.");
  return actor.roleAssignmentId;
}

export async function getCompanyDeletionImpact(actor: AuthenticatedSessionUser, companyId: string) {
  if (isDemoMode()) return { companyId, companyCode: "DEMO", confirmation: "PERMANENTLY DELETE DEMO", users: 0, memberships: 0, branches: 0, departments: 0, roleAssignments: 0, sessions: 0, requests: 0, budgets: 0, approvalPolicies: 0, invoices: 0, finalizedInvoices: 0, paidPayments: 0, deliveries: 0, completedDeliveries: 0, receipts: 0, documents: 0, branding: 0, notifications: 0, workflowEvents: 0, wallets: 0, walletTopUpRequests: 0, walletLedgerEntries: 0, walletTopUpEvents: 0, approveAndPayCommands: 0, walletProtectedEvidence: 0, lifecycleHistory: 0, pendingInvitations: 0, pendingWorkflowEmails: 0, inFlightWork: 0, protectedEvidence: 0, hardDeleteEligible: true, recommendedMode: "HARD_DELETE", ownership: {}, externalFileCount: 0, externalCleanupRequired: false, retentionPolicy: "Demo mode contains no protected evidence." } satisfies CompanyDeletionImpact;
  const result = await query<{ value: CompanyDeletionImpact }>(
    "SELECT public.axora_company_deletion_impact_v2($1,$2,$3,$4) AS value",
    [actor.id, assignment(actor), companyId, new Date()],
  );
  if (!result.rows[0]?.value) throw new Error("Company deletion is unavailable.");
  return result.rows[0].value;
}

export async function getCompanyDeletionCommandStatus(
  actor: AuthenticatedSessionUser,
  commandId: string,
) {
  if (isDemoMode()) return null;
  const result = await query<{ value: CompanyDeletionCommandStatus }>(
    "SELECT public.axora_company_deletion_command_status($1,$2,$3,$4) AS value",
    [actor.id, assignment(actor), commandId, new Date()],
  );
  if (!result.rows[0]?.value) throw new Error("Deletion command is unavailable.");
  return result.rows[0].value;
}

export async function deleteOrArchiveCompany(actor: AuthenticatedSessionUser, input: { companyId: string; commandId: string; confirmation: string; reason: string }) {
  if (isDemoMode()) return { companyId: input.companyId, commandId: input.commandId, mode: "HARD_DELETED" };
  return withAuditTransaction({ actor, reason: input.reason }, async (client) => {
    const result = await client.query<{ value: Record<string, unknown> }>(
      "SELECT public.axora_delete_or_archive_company_v2($1,$2,$3,$4,$5,$6,$7) AS value",
      [actor.id, assignment(actor), input.companyId, input.commandId, input.confirmation, input.reason, new Date()],
    );
    return result.rows[0]?.value;
  });
}

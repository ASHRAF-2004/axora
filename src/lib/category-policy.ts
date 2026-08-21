import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { AuthenticatedSessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";

export type CategoryPolicyScopeType = "COMPANY" | "BRANCH" | "DEPARTMENT";

export interface CategoryPolicyScope {
  type: CategoryPolicyScopeType;
  companyId: string;
  companyName: string;
  branchId?: string;
  branchName?: string;
  departmentId?: string;
  departmentName?: string;
  version?: number;
  enabled: boolean;
  allowedCategories: string[];
}

export interface CategoryPolicyWorkspace {
  capturedAt: string;
  categories: string[];
  scopes: CategoryPolicyScope[];
}

interface ValueRow<T> extends QueryResultRow { value: T | null }

function assignmentId(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new Error("The purchasing policy scope is unavailable.");
  return actor.roleAssignmentId;
}

export async function getCategoryPolicyWorkspace(
  actor: AuthenticatedSessionUser,
): Promise<CategoryPolicyWorkspace> {
  if (isDemoMode()) {
    const store = getDemoStore();
    const categories = [...new Set(store.products
      .filter((product) => product.status === "Active")
      .map((product) => product.category))].sort();
    const branches = store.branches.filter((branch) => (
      actor.companyId === branch.companyId
      && (!actor.branchId || actor.branchId === branch.id)
    ));
    const companyName = store.companies.find((company) => company.id === actor.companyId)?.name
      ?? "Company";
    const scopes: CategoryPolicyScope[] = actor.scopeType === "COMPANY" && actor.companyId
      ? [{ type: "COMPANY", companyId: actor.companyId, companyName,
        enabled: false, allowedCategories: [] }]
      : [];
    for (const branch of branches) {
      scopes.push({ type: "BRANCH", companyId: branch.companyId, companyName,
        branchId: branch.id, branchName: branch.name, enabled: false,
        allowedCategories: [] });
    }
    return { capturedAt: new Date().toISOString(), categories, scopes };
  }
  const result = await query<ValueRow<CategoryPolicyWorkspace>>(
    "SELECT public.axora_category_policy_workspace($1,$2,$3) AS value",
    [actor.id, assignmentId(actor), new Date()],
  );
  const workspace = result.rows[0]?.value;
  if (!workspace) throw new Error("The purchasing policy workspace is unavailable.");
  return workspace;
}

export async function setCategoryPolicy(
  actor: AuthenticatedSessionUser,
  input: {
    scopeType: CategoryPolicyScopeType;
    companyId: string;
    branchId?: string;
    departmentId?: string;
    enabled: boolean;
    allowedCategories: string[];
    expectedVersion: number;
    reason: string;
    commandId?: string;
  },
) {
  if (isDemoMode()) {
    return { policyId: randomUUID(), version: input.expectedVersion + 1,
      enabled: input.enabled, allowedCategories: input.allowedCategories };
  }
  return withAuditTransaction(
    { actor, reason: "Category purchasing policy updated" },
    async (client) => {
      const result = await client.query<ValueRow<{
        policyId: string; version: number; enabled: boolean; allowedCategories: string[];
      }>>(
        `SELECT public.axora_set_category_policy(
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
        ) AS value`,
        [actor.id, assignmentId(actor), input.scopeType, input.companyId,
          input.branchId ?? null, input.departmentId ?? null, input.enabled,
          input.allowedCategories, input.expectedVersion, input.reason,
          input.commandId ?? randomUUID(), new Date()],
      );
      const value = result.rows[0]?.value;
      if (!value) throw new Error("The purchasing policy could not be saved.");
      return value;
    },
  );
}

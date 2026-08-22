import type { SessionUser } from "./auth";
import { canAccess } from "./permissions";
import type { AccountKind, RoleScopeType, UserRole } from "./types";

export interface AccountRoleDefinition {
  key: UserRole;
  label: string;
  description: string;
  accountKind: AccountKind;
  allowedScopes: readonly RoleScopeType[];
  category: "Axora" | "Company" | "Delivery";
  availableForCreation?: boolean;
}

export const ACCOUNT_ROLE_CATALOG: readonly AccountRoleDefinition[] = [
  { key: "PLATFORM_OWNER", label: "Axora platform owner", description: "Full platform governance and protected tenant administration.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "HUMAN_RESOURCES_MANAGEMENT", label: "Human Resources Management", description: "Creates internal Axora accounts and supports company onboarding.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "CLIENT_ACCOUNT_MANAGER", label: "Client account manager", description: "Authorized Axora employee who creates and manages customer companies.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "PLATFORM_OPERATIONS", label: "Axora operations administrator", description: "Compatibility role for existing catalogue and delivery operations.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora", availableForCreation: false },
  { key: "TECHNICAL_SUPPORT", label: "Technical support", description: "Historical compatibility role.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora", availableForCreation: false },
  { key: "COMPANY_ADMIN", label: "Company administrator", description: "People, branches, budgets, and company-wide procurement oversight.", accountKind: "COMPANY", allowedScopes: ["COMPANY"], category: "Company" },
  { key: "BRANCH_ADMIN", label: "Branch administrator", description: "People and procurement activity for one assigned branch.", accountKind: "COMPANY", allowedScopes: ["BRANCH"], category: "Company" },
  { key: "DEPARTMENT_ADMIN", label: "Department administrator", description: "People, requests, approvals, and budget visibility for one assigned department.", accountKind: "COMPANY", allowedScopes: ["DEPARTMENT"], category: "Company" },
  { key: "COMPANY_APPROVER", label: "Company approver", description: "Eligible approval decisions across one customer company.", accountKind: "COMPANY", allowedScopes: ["COMPANY"], category: "Company" },
  { key: "BRANCH_APPROVER", label: "Branch approver", description: "Eligible approval decisions for one assigned branch.", accountKind: "COMPANY", allowedScopes: ["BRANCH"], category: "Company" },
  { key: "REQUESTER", label: "Purchase requester", description: "Shop and create purchase requests for one assigned branch or department.", accountKind: "COMPANY", allowedScopes: ["BRANCH", "DEPARTMENT"], category: "Company" },
  { key: "FINANCE_REVIEWER", label: "Finance reviewer", description: "Historical compatibility role.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company", availableForCreation: false },
  { key: "AUDITOR", label: "Read-only auditor", description: "Historical compatibility role.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company", availableForCreation: false },
  { key: "RECEIVING_USER", label: "Receiving user", description: "Historical compatibility role.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company", availableForCreation: false },
  { key: "DELIVERY_GUY", label: "Delivery Guy", description: "Buys requested items and completes only assigned deliveries with receipt evidence.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery" },
  { key: "DELIVERY_TEAM_SUPERVISOR", label: "Legacy delivery supervisor", description: "Historical compatibility role.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery", availableForCreation: false },
  { key: "DELIVERY_AGENT", label: "Legacy delivery account", description: "Historical compatibility role.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery", availableForCreation: false },
  { key: "DELIVERY_DRIVER", label: "Legacy delivery assignment", description: "Historical compatibility role.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery", availableForCreation: false },
] as const;

const roleByKey = new Map(ACCOUNT_ROLE_CATALOG.map((role) => [role.key, role]));

/**
 * Translate an expand/contract-era role into its canonical assignment key.
 *
 * Keeping this mapping in one place lets old clients finish an in-flight
 * request without allowing legacy role names to become a second authority
 * model. New UI surfaces only emit the canonical values.
 */
export function canonicalAccountRole(role: UserRole, branchId?: string): UserRole {
  if (role === "ADMIN") return "COMPANY_ADMIN";
  if (role === "APPROVER") return branchId ? "BRANCH_APPROVER" : "COMPANY_APPROVER";
  if (role === "FINANCE") return "FINANCE_REVIEWER";
  if (role === "VIEWER") return "AUDITOR";
  if (role === "IT_SUPPORT") return "TECHNICAL_SUPPORT";
  if (role === "OPERATIONS") return "REQUESTER";
  if (["DELIVERY_TEAM_SUPERVISOR", "DELIVERY_AGENT", "DELIVERY_DRIVER"].includes(role)) {
    return "DELIVERY_GUY";
  }
  return role;
}

export function accountRoleDefinition(role: UserRole) {
  return roleByKey.get(canonicalAccountRole(role));
}

export function creatableAccountRoles(actor: SessionUser) {
  if (actor.isOwner && actor.accountKind !== "COMPANY") {
    return ACCOUNT_ROLE_CATALOG.filter((role) => role.availableForCreation !== false);
  }
  // Expand/contract compatibility for tests, demo mode, and a retained session
  // created before effective permissions were attached. Live portal sessions
  // always carry effectivePermissions and take the granular path below.
  if (!actor.effectivePermissions) {
    if (actor.role === "ADMIN" || actor.role === "COMPANY_ADMIN") {
      return ACCOUNT_ROLE_CATALOG.filter((role) => (
        role.category === "Company" && role.availableForCreation !== false
      ));
    }
    if (actor.role === "BRANCH_ADMIN") {
      return ACCOUNT_ROLE_CATALOG.filter((role) => [
        "BRANCH_APPROVER", "REQUESTER",
      ].includes(role.key));
    }
  }
  return ACCOUNT_ROLE_CATALOG.filter((role) => {
    if (role.availableForCreation === false || role.key === "PLATFORM_OWNER") return false;
    if (role.category === "Axora") return canAccess(actor, "create_platform_users");
    if (role.category === "Delivery") return canAccess(actor, "create_delivery_users");
    if (!canAccess(actor, "create_company_users")) return false;
    if (actor.role === "BRANCH_ADMIN") {
      return ["BRANCH_APPROVER", "REQUESTER"].includes(role.key);
    }
    if (actor.role === "DEPARTMENT_ADMIN") {
      return role.key === "REQUESTER";
    }
    return true;
  });
}

export function accountRoleLabel(role: UserRole) {
  return accountRoleDefinition(role)?.label ?? role.replaceAll("_", " ").toLowerCase();
}

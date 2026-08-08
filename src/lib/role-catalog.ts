import type { SessionUser } from "./auth";
import type { AccountKind, RoleScopeType, UserRole } from "./types";

export interface AccountRoleDefinition {
  key: UserRole;
  label: string;
  description: string;
  accountKind: AccountKind;
  allowedScopes: readonly RoleScopeType[];
  category: "Axora" | "Company" | "Supplier" | "Delivery";
  availableForCreation?: boolean;
}

export const ACCOUNT_ROLE_CATALOG: readonly AccountRoleDefinition[] = [
  { key: "PLATFORM_OWNER", label: "Axora platform owner", description: "Full platform governance and protected tenant administration.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "CLIENT_ACCOUNT_MANAGER", label: "Client account manager", description: "Manages only explicitly assigned client companies and their onboarding work.", accountKind: "PLATFORM", allowedScopes: ["COMPANY"], category: "Axora", availableForCreation: false },
  { key: "PLATFORM_OPERATIONS", label: "Axora operations administrator", description: "Catalog, sourcing, fulfilment, and delivery coordination without owner governance.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "TECHNICAL_SUPPORT", label: "Technical support", description: "Audited diagnostics and safe support actions without commercial authority.", accountKind: "PLATFORM", allowedScopes: ["PLATFORM"], category: "Axora" },
  { key: "COMPANY_ADMIN", label: "Company administrator", description: "People, branches, budgets, and company-wide procurement oversight.", accountKind: "COMPANY", allowedScopes: ["COMPANY"], category: "Company" },
  { key: "BRANCH_ADMIN", label: "Branch administrator", description: "People and procurement activity for one assigned branch.", accountKind: "COMPANY", allowedScopes: ["BRANCH"], category: "Company" },
  { key: "DEPARTMENT_ADMIN", label: "Department administrator", description: "People, requests, approvals, and budget visibility for one assigned department.", accountKind: "COMPANY", allowedScopes: ["DEPARTMENT"], category: "Company" },
  { key: "COMPANY_APPROVER", label: "Company approver", description: "Eligible approval decisions across one customer company.", accountKind: "COMPANY", allowedScopes: ["COMPANY"], category: "Company" },
  { key: "BRANCH_APPROVER", label: "Branch approver", description: "Eligible approval decisions for one assigned branch.", accountKind: "COMPANY", allowedScopes: ["BRANCH"], category: "Company" },
  { key: "REQUESTER", label: "Purchase requester", description: "Shop and create purchase requests for one assigned branch or department.", accountKind: "COMPANY", allowedScopes: ["BRANCH", "DEPARTMENT"], category: "Company" },
  { key: "FINANCE_REVIEWER", label: "Finance reviewer", description: "Customer invoices, COD status, matching, and finance exceptions.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company" },
  { key: "AUDITOR", label: "Read-only auditor", description: "Read-only evidence and audit history within the assigned scope.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company" },
  { key: "RECEIVING_USER", label: "Receiving user", description: "Independent delivery inspection and receipt confirmation.", accountKind: "COMPANY", allowedScopes: ["COMPANY", "BRANCH", "DEPARTMENT"], category: "Company" },
  { key: "SUPPLIER_USER", label: "Supplier user", description: "RFQs, quotations, documents, and assigned supplier work only.", accountKind: "SUPPLIER", allowedScopes: ["SUPPLIER"], category: "Supplier" },
  { key: "DELIVERY_TEAM_SUPERVISOR", label: "Delivery team supervisor", description: "Assigns and supervises delivery work without platform or company authority.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery", availableForCreation: false },
  { key: "DELIVERY_AGENT", label: "Delivery agent", description: "Purchases, transports, and delivers only assigned work.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery", availableForCreation: false },
  { key: "DELIVERY_DRIVER", label: "Delivery driver", description: "Compatibility role for existing assigned mobile delivery jobs.", accountKind: "DELIVERY", allowedScopes: ["DELIVERY"], category: "Delivery" },
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
  return role;
}

export function accountRoleDefinition(role: UserRole) {
  return roleByKey.get(canonicalAccountRole(role));
}

export function creatableAccountRoles(actor: SessionUser) {
  if (actor.isOwner && actor.accountKind !== "COMPANY") {
    return ACCOUNT_ROLE_CATALOG.filter((role) => role.availableForCreation !== false);
  }
  if (actor.role === "ADMIN" || actor.role === "COMPANY_ADMIN") {
    return ACCOUNT_ROLE_CATALOG.filter((role) => (
      role.category === "Company" && role.availableForCreation !== false
    ));
  }
  if (actor.role === "BRANCH_ADMIN") {
    return ACCOUNT_ROLE_CATALOG.filter((role) => [
      "BRANCH_APPROVER", "REQUESTER", "RECEIVING_USER",
    ].includes(role.key));
  }
  return [];
}

export function accountRoleLabel(role: UserRole) {
  return accountRoleDefinition(role)?.label ?? role.replaceAll("_", " ").toLowerCase();
}

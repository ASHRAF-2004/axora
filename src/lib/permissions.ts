import type { UserRole } from "./types";

export type Permission =
  | "view_dashboard"
  | "view_catalog"
  | "view_requests"
  | "view_deliveries"
  | "view_branches"
  | "manage_companies"
  | "manage_catalog"
  | "manage_suppliers"
  | "manage_branches"
  | "manage_branch_budget"
  | "create_requests"
  | "view_approvals"
  | "approve_requests"
  | "manage_sourcing"
  | "manage_deliveries"
  | "view_invoices"
  | "manage_finance"
  | "view_documents"
  | "manage_documents"
  | "view_reports"
  | "view_audit"
  | "manage_users"
  | "manage_settings"
  | "manage_interactions";

export interface AccessSubject {
  role: UserRole;
  isOwner: boolean;
  branchId?: string;
}

const ownerPermissions = new Set<Permission>([
  "view_dashboard",
  "view_catalog",
  "view_requests",
  "view_deliveries",
  "view_branches",
  "manage_companies",
  "manage_catalog",
  "manage_suppliers",
  "manage_branches",
  "view_approvals",
  "manage_sourcing",
  "manage_deliveries",
  "view_invoices",
  "manage_finance",
  "view_documents",
  "manage_documents",
  "view_reports",
  "view_audit",
  "manage_users",
  "manage_settings",
  "manage_interactions",
]);

const companyPermissions: Record<UserRole, Permission[]> = {
  ADMIN: [
    "view_dashboard",
    "view_catalog",
    "view_requests",
    "view_deliveries",
    "view_branches",
    "manage_branches",
    "manage_branch_budget",
    "create_requests",
    "view_approvals",
    "approve_requests",
    "view_invoices",
    "view_documents",
    "manage_documents",
    "view_reports",
    "view_audit",
    "manage_users",
    "manage_settings",
    "manage_interactions",
  ],
  BRANCH_ADMIN: [
    "view_dashboard",
    "view_catalog",
    "view_requests",
    "view_deliveries",
    "view_branches",
    "create_requests",
    "view_approvals",
    "approve_requests",
    "view_invoices",
    "view_documents",
    "manage_documents",
    "view_reports",
    "manage_users",
  ],
  APPROVER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches",
    "create_requests", "view_approvals", "approve_requests", "view_documents", "manage_documents", "view_reports",
  ],
  REQUESTER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches",
    "create_requests", "view_documents", "manage_documents",
  ],
  OPERATIONS: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches",
    "create_requests", "view_documents", "manage_documents",
  ],
  FINANCE: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches",
    "view_invoices", "view_documents", "manage_documents", "view_reports",
  ],
  VIEWER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries", "view_branches",
    "view_invoices", "view_documents", "view_reports", "view_audit",
  ],
  IT_SUPPORT: ["manage_settings"],
};

export function canAccess(subject: AccessSubject, permission: Permission) {
  if (subject.isOwner) return ownerPermissions.has(permission);
  if (permission === "view_audit" && subject.branchId) return false;
  return companyPermissions[subject.role].includes(permission);
}

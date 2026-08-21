import {
  CANONICAL_USER_ROLES,
  LEGACY_USER_ROLES,
  isUserRole,
  type AccountKind,
  type RoleScopeType,
  type UserRole,
} from "./types";

export type Permission =
  | "view_dashboard"
  | "view_catalog"
  | "view_requests"
  | "view_deliveries"
  | "view_branches"
  | "manage_companies"
  | "manage_catalog"
  | "manage_branches"
  | "manage_branch_budget"
  | "create_requests"
  | "view_approvals"
  | "view_budgets"
  | "view_wallet"
  | "request_wallet_top_up"
  | "record_wallet_top_up"
  | "approve_requests"
  | "manage_deliveries"
  | "view_invoices"
  | "manage_finance"
  | "view_documents"
  | "manage_documents"
  | "view_reports"
  | "view_audit"
  | "manage_users"
  | "manage_settings"
  | "manage_commercial_pricing"
  | "view_system_diagnostics"
  | "view_email_operations"
  | "manage_email_operations"
  | "view_delivery_portal"
  | "update_assigned_deliveries"
  | "view_receiving"
  | "confirm_receipts"
  | "view_platform_revenue"
  | "view_platform_profit"
  | "view_internal_cost"
  | "create_platform_users"
  | "create_company_users"
  | "create_delivery_users"
  | "view_all_companies";

export interface AccessSubject {
  role: UserRole | string;
  isOwner: boolean;
  accountKind?: AccountKind;
  scopeType?: RoleScopeType;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  /** Live database-derived route permissions. Never persist these in the JWT. */
  effectivePermissions?: readonly Permission[];
}

const platformOwnerPermissions: readonly Permission[] = [
  "view_dashboard",
  "view_catalog",
  "view_requests",
  "view_deliveries",
  "view_receiving",
  "confirm_receipts",
    "view_branches",
    "view_approvals",
    "view_budgets",
    "view_wallet",
    "request_wallet_top_up",
    "record_wallet_top_up",
    "manage_companies",
  "manage_catalog",
  "manage_branches",
  "manage_deliveries",
  "view_invoices",
  "manage_finance",
  "view_documents",
  "manage_documents",
  "view_reports",
  "view_audit",
  "manage_users",
  "manage_settings",
  "manage_commercial_pricing",
  "view_system_diagnostics",
  "view_email_operations",
  "manage_email_operations",
  "view_receiving",
  "view_platform_revenue",
  "view_platform_profit",
  "view_internal_cost",
  "create_platform_users",
  "create_company_users",
  "create_delivery_users",
  "view_all_companies",
];

const legacyCompanyAdminPermissions: readonly Permission[] = [
  "view_dashboard",
  "view_catalog",
  "view_requests",
  "view_deliveries",
  "view_branches",
  "manage_branches",
  "manage_branch_budget",
  "create_requests",
  "view_approvals",
  "view_budgets",
  "view_wallet",
  "request_wallet_top_up",
  "approve_requests",
  "view_invoices",
  "view_documents",
  "manage_documents",
  "view_reports",
  "view_audit",
  "manage_users",
  "manage_settings",
];

const companyAdminPermissions: readonly Permission[] = [
  "view_dashboard",
  "view_catalog",
  "view_requests",
  "view_deliveries",
  "view_receiving",
  "confirm_receipts",
  "view_branches",
  "manage_branches",
  "manage_branch_budget",
  "view_approvals",
  "view_budgets",
  "view_wallet",
  "request_wallet_top_up",
  "approve_requests",
  "view_invoices",
  "view_documents",
  "manage_documents",
  "view_reports",
  "view_audit",
  "manage_users",
  "manage_settings",
];

// Legacy capabilities remain byte-for-byte compatible while active canonical
// assignments use the smaller role-specific sets below.
const rolePermissions: Readonly<Record<string, readonly Permission[]>> = {
  ADMIN: legacyCompanyAdminPermissions,
  BRANCH_ADMIN: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_receiving", "confirm_receipts",
    "view_branches", "create_requests", "view_approvals", "view_budgets", "approve_requests",
    "view_invoices", "view_documents", "manage_documents", "view_reports", "manage_users",
  ],
  APPROVER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "create_requests", "view_approvals", "view_budgets", "approve_requests",
    "view_documents", "manage_documents", "view_reports",
  ],
  REQUESTER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "create_requests", "view_documents", "manage_documents",
  ],
  OPERATIONS: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "create_requests", "view_documents", "manage_documents",
  ],
  FINANCE: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_invoices", "view_documents", "manage_documents", "view_reports",
  ],
  VIEWER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_invoices", "view_documents", "view_reports", "view_audit",
  ],
  IT_SUPPORT: ["view_system_diagnostics"],

  PLATFORM_OWNER: platformOwnerPermissions,
  CLIENT_ACCOUNT_MANAGER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "manage_companies", "view_invoices", "view_reports", "manage_users",
  ],
  HUMAN_RESOURCES_MANAGEMENT: ["view_dashboard", "manage_companies"],
  PLATFORM_OPERATIONS: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "manage_catalog", "manage_deliveries",
    "view_reports", "view_receiving",
    "view_email_operations", "manage_email_operations",
  ],
  COMPANY_ADMIN: companyAdminPermissions,
  DEPARTMENT_ADMIN: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "create_requests", "view_approvals", "view_budgets", "approve_requests",
    "view_invoices", "view_documents", "manage_documents", "view_reports", "manage_users",
  ],
  BRANCH_APPROVER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_approvals", "view_budgets", "approve_requests", "view_invoices", "view_documents", "view_reports",
  ],
  COMPANY_APPROVER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_approvals", "view_budgets", "approve_requests", "view_invoices", "view_documents", "view_reports",
  ],
  FINANCE_REVIEWER: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_budgets", "view_invoices", "view_documents",
    "view_reports",
  ],
  AUDITOR: [
    "view_dashboard", "view_catalog", "view_requests", "view_deliveries",
    "view_branches", "view_budgets", "view_invoices", "view_documents", "view_reports", "view_audit",
  ],
  TECHNICAL_SUPPORT: ["view_system_diagnostics"],
  DELIVERY_TEAM_SUPERVISOR: [
    "view_dashboard", "view_deliveries", "manage_deliveries", "view_reports",
    "view_delivery_portal", "update_assigned_deliveries",
  ],
  DELIVERY_AGENT: ["view_delivery_portal", "update_assigned_deliveries"],
  DELIVERY_DRIVER: ["view_delivery_portal", "update_assigned_deliveries"],
  DELIVERY_GUY: ["view_dashboard", "view_delivery_portal", "update_assigned_deliveries"],
  RECEIVING_USER: ["view_receiving", "confirm_receipts"],
};

function hasNormalizedScope(subject: AccessSubject) {
  return subject.accountKind !== undefined || subject.scopeType !== undefined;
}

function validCompanyScope(subject: AccessSubject, allowed: readonly RoleScopeType[]) {
  return subject.accountKind === "COMPANY"
    && subject.companyId !== undefined
    && subject.scopeType !== undefined
    && allowed.includes(subject.scopeType)
    && (subject.scopeType === "BRANCH" ? Boolean(subject.branchId) : !subject.branchId)
    && subject.departmentId === undefined
    && subject.supplierId === undefined;
}

function validPlatformCompanyScope(subject: AccessSubject) {
  return subject.accountKind === "PLATFORM"
    && subject.scopeType === "COMPANY"
    && Boolean(subject.companyId)
    && !subject.branchId && !subject.departmentId && !subject.supplierId;
}

function validDepartmentScope(subject: AccessSubject) {
  return subject.accountKind === "COMPANY"
    && subject.scopeType === "DEPARTMENT"
    && Boolean(subject.companyId && subject.departmentId)
    && !subject.supplierId;
}

function canonicalSubjectIsValid(subject: AccessSubject) {
  switch (subject.role) {
    case "PLATFORM_OWNER":
      return subject.isOwner
        && subject.accountKind === "PLATFORM"
        && subject.scopeType === "PLATFORM"
        && !subject.companyId && !subject.branchId
        && !subject.departmentId && !subject.supplierId;
    case "CLIENT_ACCOUNT_MANAGER":
      return !subject.isOwner && (
        validPlatformCompanyScope(subject)
        || (subject.accountKind === "PLATFORM" && subject.scopeType === "PLATFORM"
          && !subject.companyId && !subject.branchId && !subject.departmentId && !subject.supplierId)
      );
    case "HUMAN_RESOURCES_MANAGEMENT":
    case "PLATFORM_OPERATIONS":
    case "TECHNICAL_SUPPORT":
      return !subject.isOwner
        && subject.accountKind === "PLATFORM"
        && subject.scopeType === "PLATFORM"
        && !subject.companyId && !subject.branchId
        && !subject.departmentId && !subject.supplierId;
    case "COMPANY_ADMIN":
    case "COMPANY_APPROVER":
      return !subject.isOwner && validCompanyScope(subject, ["COMPANY"]);
    case "BRANCH_ADMIN":
    case "BRANCH_APPROVER":
      return !subject.isOwner && validCompanyScope(subject, ["BRANCH"]);
    case "REQUESTER":
      return !subject.isOwner && (
        validCompanyScope(subject, ["BRANCH"])
        || validDepartmentScope(subject)
      );
    case "DEPARTMENT_ADMIN":
      return !subject.isOwner && validDepartmentScope(subject);
    case "FINANCE_REVIEWER":
    case "AUDITOR":
    case "RECEIVING_USER":
      return !subject.isOwner && (
        validCompanyScope(subject, ["COMPANY", "BRANCH"])
        || validDepartmentScope(subject)
      );
    case "DELIVERY_TEAM_SUPERVISOR":
    case "DELIVERY_AGENT":
    case "DELIVERY_DRIVER":
    case "DELIVERY_GUY":
      return !subject.isOwner
        && subject.accountKind === "DELIVERY"
        && subject.scopeType === "DELIVERY"
        && !subject.companyId && !subject.branchId
        && !subject.departmentId && !subject.supplierId;
    default:
      return true;
  }
}

function legacySubjectIsValid(subject: AccessSubject) {
  if (!hasNormalizedScope(subject)) return true;
  if (subject.role === "ADMIN" && subject.isOwner) {
    return subject.accountKind === "PLATFORM" && subject.scopeType === "PLATFORM"
      && !subject.companyId && !subject.branchId && !subject.supplierId;
  }
  if (subject.role === "IT_SUPPORT") {
    return !subject.isOwner && subject.accountKind === "PLATFORM"
      && subject.scopeType === "PLATFORM"
      && !subject.companyId && !subject.branchId && !subject.supplierId;
  }
  return !subject.isOwner && validCompanyScope(subject, ["COMPANY", "BRANCH"]);
}

export function canAccess(subject: AccessSubject, permission: Permission) {
  if (!isUserRole(subject.role)) return false;
  const isCanonicalRole = (CANONICAL_USER_ROLES as readonly string[])
    .includes(subject.role);
  const isLegacyRole = (LEGACY_USER_ROLES as readonly string[])
    .includes(subject.role);
  const useCanonicalScope = isCanonicalRole
    && (!isLegacyRole || hasNormalizedScope(subject));
  if (useCanonicalScope ? !canonicalSubjectIsValid(subject) : !legacySubjectIsValid(subject)) {
    return false;
  }
  if (subject.isOwner) {
    if (subject.role !== "ADMIN" && subject.role !== "PLATFORM_OWNER") return false;
    return platformOwnerPermissions.includes(permission);
  }
  if (subject.effectivePermissions) {
    return subject.effectivePermissions.includes(permission);
  }
  if (permission === "view_audit"
    && (subject.scopeType === "BRANCH" || subject.scopeType === "DEPARTMENT")) {
    return false;
  }
  // Legacy callers only carry branchId. Preserve the old audit restriction.
  if (permission === "view_audit" && !subject.scopeType && subject.branchId) return false;
  return Boolean(rolePermissions[subject.role]?.includes(permission));
}

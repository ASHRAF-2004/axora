import { accountRoleDefinition, ACCOUNT_ROLE_CATALOG } from "./role-catalog";
import type { PermissionCode } from "./authorization-policy";
import type { AccountKind, RoleScopeType, UserRole } from "./types";

export type UserProvisioningCategory = "Axora" | "Company" | "Delivery";

export interface UserProvisioningRoleConfig {
  role: UserRole;
  category: UserProvisioningCategory;
  accountKind: AccountKind;
  creationScopes: readonly RoleScopeType[];
  showCompany: boolean;
  showBranch: boolean;
  showDepartment: boolean;
}

export class UserProvisioningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProvisioningValidationError";
  }
}

const CREATION_SCOPES: Partial<Record<UserRole, readonly RoleScopeType[]>> = {
  PLATFORM_OWNER: ["PLATFORM"],
  HUMAN_RESOURCES_MANAGEMENT: ["PLATFORM"],
  CLIENT_ACCOUNT_MANAGER: ["PLATFORM"],
  COMPANY_ADMIN: ["COMPANY"],
  BRANCH_ADMIN: ["BRANCH"],
  COMPANY_APPROVER: ["COMPANY"],
  BRANCH_APPROVER: ["BRANCH"],
  REQUESTER: ["BRANCH"],
  DELIVERY_GUY: ["DELIVERY"],
};

function organizationVisibility(scopes: readonly RoleScopeType[]) {
  const company = scopes.some((scope) => ["COMPANY", "BRANCH", "DEPARTMENT"].includes(scope));
  const branch = scopes.some((scope) => scope === "BRANCH" || scope === "DEPARTMENT");
  const department = scopes.includes("DEPARTMENT");
  return { company, branch, department };
}

export const USER_PROVISIONING_ROLE_CONFIGS: readonly UserProvisioningRoleConfig[] =
  ACCOUNT_ROLE_CATALOG.flatMap((role) => {
    if (role.availableForCreation === false) return [];
    const creationScopes = CREATION_SCOPES[role.key];
    if (!creationScopes) return [];
    const visible = organizationVisibility(creationScopes);
    return [{
      role: role.key,
      category: role.category,
      accountKind: role.accountKind,
      creationScopes,
      showCompany: visible.company,
      showBranch: visible.branch,
      showDepartment: visible.department,
    }];
  });

const configByRole = new Map(USER_PROVISIONING_ROLE_CONFIGS.map((config) => [config.role, config]));

export function userProvisioningRoleConfig(role: UserRole) {
  return configByRole.get(role);
}

export function isCreatableProvisioningRole(role: UserRole) {
  const definition = accountRoleDefinition(role);
  return Boolean(definition && definition.key === role && definition.availableForCreation !== false && configByRole.has(role));
}

export function validateProvisioningOrganizationShape(input: {
  role: UserRole;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
}) {
  const config = userProvisioningRoleConfig(input.role);
  if (!config || !isCreatableProvisioningRole(input.role)) {
    throw new UserProvisioningValidationError("Choose an approved account role.");
  }
  if (input.supplierId) {
    throw new UserProvisioningValidationError("Supplier scope is not supported by Create User.");
  }

  if (!config.showCompany && input.companyId) {
    throw new UserProvisioningValidationError("The selected role does not accept a customer company scope.");
  }
  if (!config.showBranch && input.branchId) {
    throw new UserProvisioningValidationError("The selected role does not accept a branch scope.");
  }
  if (!config.showDepartment && input.departmentId) {
    throw new UserProvisioningValidationError("The selected role does not accept a department scope.");
  }
  if (config.showCompany && !input.companyId) {
    throw new UserProvisioningValidationError("Select the approved customer company for this user.");
  }
  if (config.creationScopes.length === 1 && config.creationScopes[0] === "BRANCH" && !input.branchId) {
    throw new UserProvisioningValidationError("Select the branch this person will work with.");
  }
  if (config.creationScopes.length === 1 && config.creationScopes[0] === "DEPARTMENT"
    && (!input.branchId || !input.departmentId)) {
    throw new UserProvisioningValidationError("Select the branch and department this person will work with.");
  }
  if (input.departmentId && !input.branchId) {
    throw new UserProvisioningValidationError("Select a branch before selecting a department.");
  }
}

const ACCESS_GROUP_LABELS: Record<string, string> = {
  platform: "Platform",
  company: "Companies",
  platform_user: "User Management",
  company_user: "User Management",
  delivery_user: "User Management",
  organization: "Organization",
  product: "Catalogue",
  catalog: "Catalogue",
  cart: "Requests",
  request: "Requests",
  budget: "Budgets",
  commercial: "Finance",
  finance: "Finance",
  delivery: "Delivery",
  receiving: "Receiving",
  document: "Documents",
  report: "Reports",
  analytics: "Reports",
  audit: "Reports",
};

export function accessGroupsForPermissions(permissions: readonly PermissionCode[]) {
  const groups = new Set<string>();
  for (const permission of permissions) {
    const prefix = permission.split(".")[0];
    groups.add(ACCESS_GROUP_LABELS[prefix] ?? "Other access");
  }
  return [...groups].sort();
}

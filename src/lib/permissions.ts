import type { UserRole } from "./types";

export type Permission =
  | "manage_masters"
  | "manage_requests"
  | "manage_sourcing"
  | "manage_approvals"
  | "manage_deliveries"
  | "manage_finance"
  | "manage_documents"
  | "view_audit"
  | "manage_users"
  | "manage_settings";

const permissions: Record<Permission, UserRole[]> = {
  manage_masters: ["ADMIN", "OPERATIONS"],
  manage_requests: ["ADMIN", "OPERATIONS"],
  manage_sourcing: ["ADMIN", "OPERATIONS"],
  manage_approvals: ["ADMIN"],
  manage_deliveries: ["ADMIN", "OPERATIONS"],
  manage_finance: ["ADMIN", "FINANCE"],
  manage_documents: ["ADMIN", "OPERATIONS", "FINANCE"],
  view_audit: ["ADMIN", "VIEWER"],
  manage_users: ["ADMIN"],
  manage_settings: ["ADMIN", "IT_SUPPORT"],
};

export function hasPermission(role: UserRole, permission: Permission) {
  return permissions[permission].includes(role);
}

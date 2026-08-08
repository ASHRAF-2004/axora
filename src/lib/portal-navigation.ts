import type { PortalMessages } from "./portal-i18n";
import { canAccess, type AccessSubject, type Permission } from "./permissions";

export interface PortalNavigationItem {
  href: string;
  label: string;
  description?: string;
  group?: "workspace" | "administration" | "insight" | "support";
}

interface NavigationDefinition extends PortalNavigationItem {
  permission?: Permission;
  ownerOnly?: boolean;
}

export const PRIMARY_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/dashboard", label: "Dashboard", permission: "view_dashboard" },
  { href: "/supplier", label: "RFQs", permission: "view_supplier_portal" },
  { href: "/driver", label: "Driver", permission: "view_delivery_portal" },
  { href: "/receiving", label: "Receiving", permission: "view_receiving" },
  { href: "/products", label: "Shop", permission: "view_catalog" },
  { href: "/requests", label: "Requests", permission: "view_requests" },
  { href: "/approvals", label: "Approvals", permission: "view_approvals" },
  { href: "/budgets", label: "Budgets", permission: "view_budgets" },
  { href: "/sourcing", label: "Sourcing", permission: "manage_sourcing" },
  { href: "/deliveries", label: "Deliveries", permission: "view_deliveries" },
  { href: "/finance", label: "Invoices", permission: "view_invoices" },
];

export const DRAWER_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/supplier", label: "Supplier RFQs", description: "Assigned RFQs, quotations and documents", permission: "view_supplier_portal", group: "workspace" },
  { href: "/driver", label: "Driver assignments", description: "Offline-safe status and delivery evidence", permission: "view_delivery_portal", group: "workspace" },
  { href: "/receiving", label: "Receiving", description: "Independent line-by-line receipt confirmation", permission: "view_receiving", group: "workspace" },
  { href: "/companies", label: "Companies", description: "Onboarding and tenant health", permission: "manage_companies", group: "administration" },
  { href: "/products", label: "Global catalog", description: "Products and customer-facing images", permission: "manage_catalog", group: "administration" },
  { href: "/branches", label: "Branches & budgets", description: "Company structure and controls", permission: "view_branches", group: "administration" },
  { href: "/budgets", label: "Budget ledger", description: "Authorization periods, balances and reservations", permission: "view_budgets", group: "administration" },
  { href: "/suppliers", label: "Suppliers", description: "Private supplier organizations", permission: "manage_suppliers", group: "administration" },
  { href: "/users", label: "People & access", description: "Invitations, roles and scope", permission: "manage_users", group: "administration" },
  { href: "/documents", label: "Documents", description: "Permitted evidence and records", permission: "view_documents", group: "workspace" },
  { href: "/reports", label: "Reports", description: "Operational and company insights", permission: "view_reports", group: "insight" },
  { href: "/audit", label: "Audit history", description: "Read-only evidence trail", permission: "view_audit", group: "insight" },
  { href: "/support", label: "Support diagnostics", description: "Audited system and account checks", permission: "view_system_diagnostics", group: "support" },
  { href: "/settings", label: "Settings", description: "Personal and permitted administration", group: "support" },
  { href: "/help", label: "Help & tutorial", description: "Guidance for your role", group: "support" },
];

export function visiblePortalNavigation(
  items: readonly NavigationDefinition[],
  user: AccessSubject,
  messages: PortalMessages,
): PortalNavigationItem[] {
  return items.filter((item) => {
    if (item.ownerOnly && !user.isOwner) return false;
    return !item.permission || canAccess(user, item.permission);
  }).map((item) => ({
    href: item.href,
    label: messages.navigation[item.href]?.label ?? item.label,
    description: messages.navigation[item.href]?.description ?? item.description,
    group: item.group,
  }));
}

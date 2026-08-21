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
  companyOnly?: boolean;
}

export const PRIMARY_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/dashboard", label: "Dashboard", permission: "view_dashboard" },
  { href: "/driver", label: "Delivery Guy", permission: "view_delivery_portal" },
  { href: "/receiving", label: "Receiving", permission: "view_receiving" },
  { href: "/products", label: "Shopping", permission: "view_catalog" },
  { href: "/requests", label: "Requests", permission: "view_requests" },
  { href: "/approvals", label: "Approvals", permission: "view_approvals" },
  { href: "/budgets", label: "Budgets", permission: "view_budgets", companyOnly: true },
  { href: "/wallet", label: "Company Wallet", permission: "view_wallet" },
  { href: "/deliveries", label: "Deliveries", permission: "view_deliveries" },
  { href: "/finance", label: "Invoices", permission: "view_invoices" },
];

export const DRAWER_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/driver", label: "Delivery Guy assignments", description: "Buy items and complete assigned deliveries with receipt evidence", permission: "view_delivery_portal", group: "workspace" },
  { href: "/receiving", label: "Receiving", description: "Independent line-by-line receipt confirmation", permission: "view_receiving", group: "workspace" },
  { href: "/companies", label: "Companies", description: "Onboarding and tenant health", permission: "manage_companies", group: "administration" },
  { href: "/products", label: "Global catalog", description: "Products and customer-facing images", permission: "manage_catalog", group: "administration" },
  { href: "/branches", label: "Branches & budgets", description: "Company structure and controls", permission: "view_branches", group: "administration" },
  { href: "/budgets", label: "Budget ledger", description: "Authorization periods, balances and reservations", permission: "view_budgets", companyOnly: true, group: "administration" },
  { href: "/wallet", label: "Company Wallet", description: "Actual funds, top-ups and immutable wallet evidence", permission: "view_wallet", group: "administration" },
  { href: "/users", label: "People & access", description: "Invitations, roles and scope", permission: "manage_users", group: "administration" },
  { href: "/settings/procurement", label: "Purchasing rules", description: "Category policy by company, branch and department", permission: "manage_category_policy", companyOnly: true, group: "administration" },
  { href: "/reports", label: "Reports", description: "Operational and company insights", permission: "view_reports", group: "insight" },
  { href: "/audit", label: "Audit history", description: "Read-only evidence trail", permission: "view_audit", group: "insight" },
  { href: "/email-operations", label: "Email operations", description: "Delivery, suppression and provider health", permission: "view_email_operations", group: "support" },
  { href: "/support", label: "Support diagnostics", description: "Audited system and account checks", permission: "view_system_diagnostics", group: "support" },
  { href: "/settings", label: "Settings", description: "Personal and permitted administration", group: "support" },
  { href: "/help", label: "Help", description: "Guidance for your role", group: "support" },
];

export function visiblePortalNavigation(
  items: readonly NavigationDefinition[],
  user: AccessSubject,
  messages: PortalMessages,
): PortalNavigationItem[] {
  return items.filter((item) => {
    if (item.ownerOnly && !user.isOwner) return false;
    if (item.companyOnly && user.accountKind !== "COMPANY") return false;
    return !item.permission || canAccess(user, item.permission);
  }).map((item) => ({
    href: item.href === "/users" && user.accountKind === "COMPANY" && user.companyId
      ? `/companies/${user.companyId}/users`
      : item.href,
    label: messages.navigation[
      item.href === "/users" && user.accountKind === "COMPANY" ? "/company-users" : item.href
    ]?.label ?? item.label,
    description: messages.navigation[
      item.href === "/users" && user.accountKind === "COMPANY" ? "/company-users" : item.href
    ]?.description ?? item.description,
    group: item.group,
  }));
}

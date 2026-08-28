import type { PortalMessages } from "./portal-i18n";
import { canAccess, type AccessSubject, type Permission } from "./permissions";

export interface PortalNavigationItem {
  href: string;
  label: string;
  description?: string;
  group?: "workspace" | "administration";
}

interface NavigationDefinition extends PortalNavigationItem {
  permission?: Permission;
  ownerOnly?: boolean;
  companyOnly?: boolean;
}

export const PRIMARY_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/dashboard", label: "Dashboard", permission: "view_dashboard" },
  { href: "/driver", label: "Delivery", permission: "view_delivery_portal" },
  { href: "/products", label: "Shopping", permission: "view_catalog" },
  { href: "/requests", label: "Requests", permission: "view_requests" },
  { href: "/approvals", label: "Approvals", permission: "view_approvals" },
  { href: "/branches", label: "Branches", permission: "view_branches", companyOnly: true },
  { href: "/budgets", label: "Budgets", permission: "view_budgets", companyOnly: true },
  { href: "/wallet", label: "Company Wallet", permission: "view_wallet" },
  { href: "/deliveries", label: "Deliveries", permission: "view_deliveries" },
  { href: "/finance", label: "Finance", permission: "view_invoices", ownerOnly: true },
];

export const DRAWER_NAVIGATION: readonly NavigationDefinition[] = [
  { href: "/driver", label: "Delivery", description: "Acquire items and complete assigned deliveries with proof", permission: "view_delivery_portal", group: "workspace" },
  { href: "/companies", label: "Companies", description: "Create and manage company workspaces", permission: "manage_companies", group: "administration" },
  { href: "/products", label: "Manage Products", description: "Products, base costs and images", permission: "manage_catalog", group: "administration" },
  { href: "/branches", label: "Branches", description: "Branches and delivery locations", permission: "view_branches", group: "administration" },
  { href: "/budgets", label: "Budgets", description: "Budgets and available balances", permission: "view_budgets", companyOnly: true, group: "administration" },
  { href: "/wallet", label: "Company Wallet", description: "Actual funds, top-ups and immutable wallet evidence", permission: "view_wallet", group: "administration" },
  { href: "/users", label: "Users", description: "People, roles and access", permission: "manage_users", group: "administration" },
  { href: "/email-operations", label: "Email Status", description: "Service status, usage and failed email retries", ownerOnly: true, group: "administration" },
];

export function visiblePortalNavigation(
  items: readonly NavigationDefinition[],
  user: AccessSubject,
  messages: PortalMessages,
): PortalNavigationItem[] {
  return items.filter((item) => {
    if (item.ownerOnly && !(
      user.isOwner && user.role === "PLATFORM_OWNER"
      && user.accountKind === "PLATFORM" && user.scopeType === "PLATFORM"
    )) return false;
    if (item.companyOnly && user.accountKind !== "COMPANY") return false;
    return !item.permission || canAccess(user, item.permission);
  }).map((item) => ({
    href: item.href,
    label: messages.navigation[
      item.href === "/users" && user.accountKind === "COMPANY" ? "/company-users" : item.href
    ]?.label ?? item.label,
    description: messages.navigation[
      item.href === "/users" && user.accountKind === "COMPANY" ? "/company-users" : item.href
    ]?.description ?? item.description,
    group: item.group,
  }));
}

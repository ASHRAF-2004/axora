import {
  Boxes,
  Building2,
  ChartNoAxesCombined,
  CircleHelp,
  ClipboardCheck,
  ClipboardList,
  FileClock,
  Files,
  GitBranch,
  LayoutDashboard,
  PackageSearch,
  ReceiptText,
  Scale,
  Settings2,
  Store,
  Truck,
  UserRoundCog,
} from "lucide-react";
import Link from "next/link";
import { Brand } from "./Brand";
import { canAccess, type Permission } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";

interface NavigationItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  ownerOnly?: boolean;
  companyOnly?: boolean;
  companyRoles?: SessionUser["role"][];
}

const navigation: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "view_dashboard" },
  { href: "/products", label: "Shop", icon: Store, permission: "view_catalog" },
  { href: "/requests", label: "Purchase requests", icon: ClipboardList, permission: "view_requests" },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck, permission: "view_approvals" },
  { href: "/sourcing", label: "Sourcing", icon: Scale, ownerOnly: true },
  { href: "/deliveries", label: "Deliveries", icon: Truck, permission: "view_deliveries" },
  { href: "/finance", label: "Invoices", icon: ReceiptText, permission: "view_invoices" },
  { href: "/documents", label: "Documents", icon: Files, permission: "view_documents" },
  { href: "/companies", label: "Companies", icon: Building2, ownerOnly: true },
  { href: "/branches", label: "Branches & budgets", icon: GitBranch, permission: "view_branches" },
  { href: "/suppliers", label: "Suppliers", icon: PackageSearch, ownerOnly: true },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined, permission: "view_reports" },
  { href: "/audit", label: "Audit", icon: FileClock, permission: "view_audit" },
  { href: "/users", label: "People & access", icon: UserRoundCog, permission: "manage_users" },
  { href: "/settings", label: "Settings", icon: Settings2, permission: "manage_settings" },
  { href: "/help", label: "Help", icon: CircleHelp },
];

export function Sidebar({ user }: { user: SessionUser }) {
  const visible = navigation.filter((item) => {
    if (item.ownerOnly && !user.isOwner) return false;
    if (item.companyOnly && user.isOwner) return false;
    if (item.permission && !canAccess(user, item.permission)) return false;
    if (!user.isOwner && item.companyRoles && !item.companyRoles.includes(user.role)) return false;
    return true;
  });

  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand /></div>
      <nav aria-label="Main navigation">
        {visible.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <Boxes size={18} />
        <span>{user.isOwner ? "Axora operations" : "Company procurement"}<br /><small>Secure production workspace</small></span>
      </div>
    </aside>
  );
}

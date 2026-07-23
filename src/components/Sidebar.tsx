import { Boxes, Building2, ChartNoAxesCombined, CircleHelp, ClipboardCheck, ClipboardList, FileClock, Files, GitBranch, LayoutDashboard, PackageSearch, ReceiptText, Scale, Settings2, Truck, UserRoundCog } from "lucide-react";
import Link from "next/link";
import { Brand } from "./Brand";
import type { UserRole } from "@/lib/types";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/requests", label: "Requests", icon: ClipboardList },
  { href: "/sourcing", label: "Sourcing", icon: Scale },
  { href: "/approvals", label: "Approvals", icon: ClipboardCheck },
  { href: "/deliveries", label: "Deliveries", icon: Truck },
  { href: "/finance", label: "Finance", icon: ReceiptText },
  { href: "/documents", label: "Documents", icon: Files },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/branches", label: "Branches", icon: GitBranch },
  { href: "/products", label: "Products", icon: PackageSearch },
  { href: "/suppliers", label: "Suppliers", icon: PackageSearch },
  { href: "/reports", label: "Reports", icon: ChartNoAxesCombined },
  { href: "/audit", label: "Audit", icon: FileClock, roles: ["ADMIN", "VIEWER"] as UserRole[] },
  { href: "/users", label: "Users", icon: UserRoundCog, roles: ["ADMIN"] as UserRole[] },
  { href: "/settings", label: "Settings", icon: Settings2, roles: ["ADMIN", "IT_SUPPORT"] as UserRole[] },
  { href: "/help", label: "Help", icon: CircleHelp },
];

export function Sidebar({ role }: { role: UserRole }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><Brand /></div>
      <nav aria-label="Main navigation">
        {navigation.filter((item) => !item.roles || item.roles.includes(role)).map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>
        ))}
      </nav>
      <div className="sidebar-foot">
        <Boxes size={18} />
        <span>Production workspace<br /><small>Secure company access</small></span>
      </div>
    </aside>
  );
}

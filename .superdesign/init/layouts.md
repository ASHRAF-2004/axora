# Shared layouts

Axora has a global Next.js document shell and an authenticated portal shell. The portal uses one persistent sidebar/topbar frame; individual portal pages add the shared `PageHeader`. The source below is complete and copied directly from the repository. Components already cataloged in `components.md` are referenced by import rather than duplicated here.

## RootLayout

- File: `src/app/layout.tsx`
- Description: Next.js root document shell. Defines Axora metadata, imports global styling, and wraps every route in the shared feedback provider.

```tsx
import type { Metadata } from "next";
import { UxFeedbackProvider } from "@/components/UxFeedbackProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Axora operations", template: "%s | Axora operations" },
  description: "Secure multi-company procurement and operations management with Axora.",
  icons: {
    icon: [
      { url: "/brand/axora-mark.svg", type: "image/svg+xml" },
      { url: "/brand/axora-icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/brand/axora-icon-32.png",
    apple: [
      { url: "/brand/axora-apple-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <UxFeedbackProvider>{children}</UxFeedbackProvider>
      </body>
    </html>
  );
}
```

## PortalLayout

- File: `src/app/(portal)/layout.tsx`
- Description: Authenticated application shell with navigation notice handling, role-aware sidebar, environment/status top bar, user identity, sign-out control, and the main content region.

```tsx
import { logoutAction } from "@/app/actions";
import { NavigationNotice } from "@/components/NavigationNotice";
import { Sidebar } from "@/components/Sidebar";
import { requireSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { LogOut } from "lucide-react";

const roleLabels = {
  ADMIN: "Company administrator",
  BRANCH_ADMIN: "Branch administrator",
  APPROVER: "Branch approver",
  REQUESTER: "Purchase requester",
  OPERATIONS: "Legacy operations",
  FINANCE: "Finance viewer",
  VIEWER: "Read-only viewer",
  IT_SUPPORT: "Technical support",
} as const;

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSession();
  return (
    <div className="portal-shell">
      <NavigationNotice />
      <Sidebar user={user} />
      <div className="portal-main">
        <header className="topbar">
          <div><span className={`environment-dot ${isDemoMode() ? "environment-demo" : "environment-live"}`} />{isDemoMode() ? "Safe sample data" : "Axora production"}</div>
          <div className="topbar-actions">
            <div className="user-summary"><span>{user.name}</span><small>{user.isOwner ? "Platform owner" : roleLabels[user.role]}</small></div>
            <form action={logoutAction}><button className="icon-button" type="submit" aria-label="Sign out"><LogOut size={19} /></button></form>
          </div>
        </header>
        <main className="content-shell">{children}</main>
      </div>
    </div>
  );
}
```

## Sidebar

- File: `src/components/Sidebar.tsx`
- Description: Persistent permission-aware portal navigation with Axora branding and a workspace footer.

```tsx
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
```

## NavigationNotice

- File: `src/components/NavigationNotice.tsx`
- Description: Nonvisual portal-shell helper that converts redirect notice parameters into shared success feedback and clears submitted request carts.

```tsx
"use client";

import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { clearRequestCart } from "@/lib/request-cart";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const messages: Record<string, string> = {
  "company-created": "Company created successfully.",
  "branch-created": "Branch created successfully.",
  "supplier-created": "Supplier created successfully.",
  "product-created":
    "Product created successfully. You can now review its details and images.",
  "product-updated": "Product changes saved successfully.",
  "user-created": "User account created successfully.",
  "budget-updated": "Branch budget updated successfully.",
  "pricing-updated":
    "Request pricing settings saved successfully.",
  "request-submitted":
    "Purchase request submitted successfully.",
};

export function NavigationNotice() {
  const { notify } = useUxFeedback();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const notice = searchParams.get("notice");
    if (!notice) return;

    const message = messages[notice];

    if (notice === "request-submitted") {
      clearRequestCart();
    }

    if (message) notify(message, "success");

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("notice");

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [notify, pathname, router, searchParams]);

  return null;
}
```

## PageHeader

- File: `src/components/PageHeader.tsx`
- Description: Shared page-level heading layout with optional eyebrow copy and primary action link.

```tsx
import Link from "next/link";

export function PageHeader({ eyebrow, title, description, actionHref, actionLabel }: { eyebrow?: string; title: string; description: string; actionHref?: string; actionLabel?: string }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actionHref && actionLabel ? <Link className="button button-primary" href={actionHref}>{actionLabel}</Link> : null}
    </header>
  );
}
```

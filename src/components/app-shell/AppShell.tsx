"use client";

import {
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Languages,
  LogOut,
  Menu,
  Settings2,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { logoutAction } from "@/app/actions";
import { LOCALE_NAMES, SUPPORTED_LOCALES, persistBrowserLocale, type SupportedLocale } from "@/lib/i18n";
import { GuidedTutorial } from "@/components/onboarding/GuidedTutorial";
import type { TutorialStepDefinition, TutorialStepStatus } from "@/lib/onboarding";
import { setPreferredLocaleAction } from "@/app/(portal)/profile/language-action";
import { portalMessages } from "@/lib/portal-i18n";

export interface AppNavigationItem {
  href: string;
  label: string;
  description?: string;
  group?: "workspace" | "administration" | "insight" | "support";
}

interface AppShellProps {
  children: ReactNode;
  homeHref?: string;
  user: { name: string; email: string; roleLabel: string; initials: string; avatarUrl?: string };
  primaryItems: AppNavigationItem[];
  drawerItems: AppNavigationItem[];
  quickAction?: AppNavigationItem;
  locale: SupportedLocale;
  brand: {
    name: string;
    logoUrl: string;
    tenant: boolean;
    themeVersion?: number;
    style?: CSSProperties;
  };
  environmentLabel: string;
  unreadNotifications?: number;
  profileRequired?: boolean;
  tutorial?: {
    roleKey: string;
    steps: Array<TutorialStepDefinition & { status: TutorialStepStatus }>;
  };
}

function tourName(href: string) {
  const names: Record<string, string> = {
    "/dashboard": "dashboard",
    "/companies": "companies",
    "/products": "shop",
    "/requests": "requests",
    "/approvals": "approvals",
    "/sourcing": "sourcing",
    "/deliveries": "deliveries",
    "/finance": "finance",
    "/branches": "branches",
    "/users": "people",
    "/audit": "audit",
    "/help": "help",
    "/supplier": "supplier-queue",
    "/driver": "driver-today",
    "/receiving": "receiving",
  };
  return names[href];
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
}

export function AppShell({
  children,
  homeHref = "/dashboard",
  user,
  primaryItems,
  drawerItems,
  quickAction,
  locale,
  brand,
  environmentLabel,
  unreadNotifications = 0,
  profileRequired = false,
  tutorial,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const profileControlRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [languagePending, startLanguageTransition] = useTransition();
  const messages = portalMessages(locale);

  useEffect(() => {
    persistBrowserLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (!profileOpen) return;
    function dismissOutside(event: PointerEvent) {
      if (!profileControlRef.current?.contains(event.target as Node)) setProfileOpen(false);
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setProfileOpen(false);
      profileButtonRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [profileOpen]);

  function openDrawer() {
    if (!drawerRef.current?.open) drawerRef.current?.showModal();
  }

  function changeLanguage(nextLocale: SupportedLocale) {
    startLanguageTransition(async () => {
      await setPreferredLocaleAction(nextLocale);
      router.refresh();
    });
  }

  const grouped = drawerItems.reduce<Record<string, AppNavigationItem[]>>((result, item) => {
    const group = item.group ?? "workspace";
    (result[group] ??= []).push(item);
    return result;
  }, {});

  return (
    <div
      className="app-shell"
      lang={locale}
      dir={LOCALE_NAMES[locale].dir}
      style={brand.style}
      data-tenant-theme={brand.tenant ? "company" : "axora"}
      data-theme-version={brand.themeVersion}
    >
      <header className="app-topbar">
        <button className="app-menu-button" type="button" onClick={openDrawer} aria-label={messages.shell.openMenu}>
          <Menu size={22} aria-hidden="true" />
        </button>
        <Link href={homeHref} className={`app-active-brand${brand.tenant ? " app-tenant-brand" : ""}`} aria-label={messages.shell.home(brand.name)}>
          <Image src={brand.logoUrl} width={brand.tenant ? 152 : 158} height={brand.tenant ? 44 : 29} alt={brand.name} priority unoptimized={brand.tenant} />
        </Link>
        <nav className="app-primary-nav" aria-label={messages.shell.primaryNavigation}>
          {primaryItems.map((item) => (
            <Link key={item.href} href={item.href} data-tour={tourName(item.href)} data-mobile-tour={tourName(item.href)} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="app-topbar-actions">
          {quickAction ? <Link className="button app-quick-action" href={quickAction.href}>{quickAction.label}</Link> : null}
          {!profileRequired ? (
            <Link className="app-notification-button" href="/notifications" aria-label={messages.shell.notifications(unreadNotifications)}>
              <Bell size={19} aria-hidden="true" /><span className="app-notification-count">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
            </Link>
          ) : null}
          <div className="app-profile-control" ref={profileControlRef}>
            <button
              ref={profileButtonRef}
              type="button"
              className="app-profile-button"
              aria-label={`${messages.shell.myProfile}: ${user.name}`}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              aria-controls="app-profile-menu"
              onClick={() => setProfileOpen((open) => !open)}
            >
              <span className={`app-avatar${user.avatarUrl ? " app-avatar-image" : ""}`} aria-hidden="true">{user.avatarUrl ? <Image src={user.avatarUrl} width={38} height={38} alt="" unoptimized /> : user.initials}</span>
              <span className="app-profile-copy"><strong>{user.name}</strong><small>{user.roleLabel}</small></span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {profileOpen ? (
              <div className="app-profile-menu" id="app-profile-menu" role="menu">
                <div><strong>{user.name}</strong><span>{user.email}</span></div>
                <Link role="menuitem" href="/profile"><UserRound size={17} aria-hidden="true" />{messages.shell.myProfile}</Link>
                <Link role="menuitem" href="/account"><Settings2 size={17} aria-hidden="true" />{messages.shell.accountSecurity}</Link>
                <Link role="menuitem" href="/help"><CircleHelp size={17} aria-hidden="true" />{messages.shell.helpTutorial}</Link>
                <form action={logoutAction}><button type="submit" role="menuitem"><LogOut size={17} aria-hidden="true" />{messages.shell.signOut}</button></form>
              </div>
            ) : null}
          </div>
          <label className="app-language-control">
            <Languages className="app-language-icon" size={17} aria-hidden="true" />
            <span className="app-language-code" aria-hidden="true">{locale.toUpperCase()}</span>
            <span className="sr-only">{messages.shell.language}</span>
            <select value={locale} disabled={languagePending} onChange={(event) => changeLanguage(event.target.value as SupportedLocale)} aria-label={messages.shell.language}>
              {SUPPORTED_LOCALES.map((item) => <option value={item} key={item}>{LOCALE_NAMES[item].native}</option>)}
            </select>
          </label>
        </div>
      </header>

      <div className="app-context-bar">
        <span className="environment-dot environment-live" />
        <span>{environmentLabel}</span>
        <span className="app-context-divider" aria-hidden="true" />
        <strong>{brand.name}</strong>
        {!profileRequired && tutorial ? <div className="tutorial-launcher-slot"><GuidedTutorial roleKey={tutorial.roleKey} steps={tutorial.steps} locale={locale} /></div> : null}
      </div>

      <main className="content-shell app-content">{children}</main>

      <dialog ref={drawerRef} className="app-drawer" aria-labelledby="app-drawer-title">
        <div className="app-drawer-head">
          <div>
            <span>{messages.shell.workspace}</span>
            <strong id="app-drawer-title">{messages.shell.menu}</strong>
          </div>
          <button type="button" onClick={() => drawerRef.current?.close()} aria-label={messages.shell.closeMenu}><X size={20} aria-hidden="true" /></button>
        </div>
        <nav aria-label={messages.shell.completeNavigation}>
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group}>
              <h2>{messages.shell.groups[group] ?? group}</h2>
              {items.map((item) => (
                <Link key={item.href} href={item.href} data-tour={tourName(item.href)} data-mobile-tour={tourName(item.href)} onClick={() => drawerRef.current?.close()} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
                  <span><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              ))}
            </section>
          ))}
        </nav>
        <div className="app-drawer-foot"><span>{user.name}</span><small>{user.email}</small></div>
      </dialog>
    </div>
  );
}

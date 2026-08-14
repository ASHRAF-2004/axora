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
import { setPreferredLocaleAction } from "@/app/(portal)/profile/language-action";
import { portalMessages } from "@/lib/portal-i18n";
import {
  clearBrowserSessionWorkspace,
  SessionContinuity,
} from "@/components/SessionContinuity";
import { AtmosphereSelector } from "@/components/public/AtmosphereSelector";
import { AxoraBrandEmblem } from "@/components/public/AxoraBrandEmblem";
import type { PublicAtmosphere } from "@/lib/immersive-public-experience";

export interface AppNavigationItem {
  href: string;
  label: string;
  description?: string;
  group?: "workspace" | "administration" | "insight" | "support";
}

interface AppShellProps {
  children: ReactNode;
  homeHref?: string;
  user: {
    id: string;
    name: string;
    email: string;
    roleLabel: string;
    initials: string;
    companyId?: string;
    avatarUrl?: string;
  };
  primaryItems: AppNavigationItem[];
  drawerItems: AppNavigationItem[];
  quickAction?: AppNavigationItem;
  locale: SupportedLocale;
  brand: {
    name: string;
    logoUrl: string;
    tenant: boolean;
    themeVersion?: number;
    logoVariant?: "ORIGINAL" | "MONOCHROME" | "INVERTED";
    logoPlacement?: "HEADER_START" | "HEADER_CENTER";
    style?: CSSProperties;
  };
  unreadNotifications?: number;
  profileRequired?: boolean;
  allowAtmosphere?: boolean;
  staffAtmosphere?: PublicAtmosphere;
}

function tourName(href: string) {
  const names: Record<string, string> = {
    "/dashboard": "dashboard",
    "/companies": "companies",
    "/products": "shop",
    "/requests": "requests",
    "/approvals": "approvals",
    "/budgets": "budgets",
    "/deliveries": "deliveries",
    "/finance": "finance",
    "/branches": "branches",
    "/users": "people",
    "/audit": "audit",
    "/help": "help",
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
  unreadNotifications = 0,
  profileRequired = false,
  allowAtmosphere = false,
  staffAtmosphere,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const profileControlRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [polledNotifications, setPolledNotifications] = useState<{
    userId: string;
    serverCount: number;
    unreadCount: number;
  } | null>(null);
  const notificationEtag = useRef<string | undefined>(undefined);
  const notificationSequence = useRef(0);
  const [languagePending, startLanguageTransition] = useTransition();
  const messages = portalMessages(locale);
  const browserScope = {
    userId: user.id,
    ...(user.companyId ? { companyId: user.companyId } : {}),
  };

  useEffect(() => {
    persistBrowserLocale(locale);
  }, [locale]);

  const notificationUnreadCount = polledNotifications?.userId === user.id
    && polledNotifications.serverCount === unreadNotifications
    ? polledNotifications.unreadCount
    : unreadNotifications;

  useEffect(() => {
    if (profileRequired) return;
    notificationSequence.current = 0;
    let stopped = false;
    let source: EventSource | null = null;
    let fallbackInterval: number | undefined;
    const controller = new AbortController();

    function applyNotificationSummary(result: {
      unreadCount?: unknown;
      versionToken?: unknown;
    }) {
      if (!Number.isInteger(result.unreadCount)
        || Number(result.unreadCount) < 0
        || typeof result.versionToken !== "string") return;
      setPolledNotifications({
        userId: user.id,
        serverCount: unreadNotifications,
        unreadCount: Number(result.unreadCount),
      });
      window.dispatchEvent(new CustomEvent("axora:notification-summary", {
        detail: {
          unreadCount: Number(result.unreadCount),
          versionToken: result.versionToken,
        },
      }));
    }

    async function pollNotifications() {
      if (stopped || document.visibilityState === "hidden" || !navigator.onLine) return;
      try {
        const response = await fetch("/api/notifications/summary", {
          cache: "no-store",
          credentials: "same-origin",
          headers: notificationEtag.current
            ? { "If-None-Match": notificationEtag.current }
            : undefined,
          signal: controller.signal,
        });
        if (response.status === 304 || !response.ok) return;
        const result = await response.json() as {
          unreadCount?: unknown;
          versionToken?: unknown;
        };
        const etag = response.headers.get("etag");
        if (etag) notificationEtag.current = etag;
        applyNotificationSummary(result);
      } catch {
        // Polling is opportunistic. The server-rendered count remains valid
        // and the next visible interval retries without surfacing private data.
      }
    }

    function startFallback() {
      if (fallbackInterval !== undefined) return;
      void pollNotifications();
      fallbackInterval = window.setInterval(pollNotifications, 30_000);
    }

    function connect() {
      if (stopped || source || document.visibilityState === "hidden" || !navigator.onLine) return;
      if (!("EventSource" in window)) {
        startFallback();
        return;
      }
      source = new EventSource("/api/notifications/summary/stream", { withCredentials: true });
      source.addEventListener("snapshot", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as {
            sequence?: unknown;
            snapshot?: { unreadCount?: unknown; versionToken?: unknown };
          };
          if (!Number.isSafeInteger(message.sequence)
            || Number(message.sequence) <= notificationSequence.current
            || !message.snapshot) return;
          notificationSequence.current = Number(message.sequence);
          if (fallbackInterval !== undefined) {
            window.clearInterval(fallbackInterval);
            fallbackInterval = undefined;
          }
          applyNotificationSummary(message.snapshot);
        } catch {
          // A malformed frame is ignored; the next server snapshot is authoritative.
        }
      });
      source.onerror = () => {
        // Native EventSource reconnects while bounded polling preserves live
        // updates until the next authoritative stream snapshot arrives.
        startFallback();
      };
    }

    function updateTransport() {
      if (document.visibilityState === "hidden" || !navigator.onLine) {
        source?.close();
        source = null;
        return;
      }
      connect();
      if (fallbackInterval !== undefined) void pollNotifications();
    }

    window.addEventListener("online", updateTransport);
    window.addEventListener("focus", updateTransport);
    document.addEventListener("visibilitychange", updateTransport);
    connect();
    return () => {
      stopped = true;
      controller.abort();
      source?.close();
      if (fallbackInterval !== undefined) window.clearInterval(fallbackInterval);
      window.removeEventListener("online", updateTransport);
      window.removeEventListener("focus", updateTransport);
      document.removeEventListener("visibilitychange", updateTransport);
    };
  }, [profileRequired, unreadNotifications, user.id]);

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
      data-session-user-id={user.id}
      data-session-company-id={user.companyId}
    >
      <SessionContinuity locale={locale} />
      <header className="app-topbar">
        <button className="app-menu-button" type="button" onClick={openDrawer} aria-label={messages.shell.openMenu}>
          <Menu size={22} aria-hidden="true" />
        </button>
        {brand.tenant ? <Link
          href={homeHref}
          className="app-active-brand app-tenant-brand"
          aria-label={messages.shell.home(brand.name)}
          data-logo-variant={brand.logoVariant}
          data-logo-placement={brand.logoPlacement}
          style={brand.logoPlacement === "HEADER_CENTER" ? {
            position: "absolute",
            insetInlineStart: "50%",
            transform: "translateX(-50%)",
          } : undefined}
        >
          <Image
            src={brand.logoUrl}
            width={152}
            height={44}
            alt={brand.name}
            priority
            unoptimized
            style={brand.logoVariant === "MONOCHROME"
              ? { filter: "grayscale(1) contrast(1.2)" }
              : brand.logoVariant === "INVERTED"
                ? { filter: "brightness(0) invert(1)" }
                : undefined}
          />
        </Link> : <AxoraBrandEmblem
          href={homeHref}
          label={messages.shell.home(brand.name)}
          className="app-active-brand"
        />}
        <nav className="app-primary-nav" aria-label={messages.shell.primaryNavigation}>
          {primaryItems.map((item) => (
            <Link key={item.href} href={item.href} data-tour={tourName(item.href)} data-mobile-tour={tourName(item.href)} aria-current={isActive(pathname, item.href) ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="app-topbar-actions">
          {allowAtmosphere ? <div className="app-desktop-atmosphere"><AtmosphereSelector compact locale={locale} staffUserId={user.id} initialAtmosphere={staffAtmosphere} /></div> : null}
          {quickAction ? <Link className="button app-quick-action" href={quickAction.href}>{quickAction.label}</Link> : null}
          {!profileRequired ? (
            <Link className="app-notification-button" href="/notifications" aria-label={messages.shell.notifications(notificationUnreadCount)}>
              <Bell size={19} aria-hidden="true" /><span className="app-notification-count" aria-hidden="true">{notificationUnreadCount > 99 ? "99+" : notificationUnreadCount}</span>
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
                <div><strong>{user.name}</strong><span><bdi className="bidi-ltr" dir="ltr">{user.email}</bdi></span></div>
                <Link role="menuitem" href="/profile"><UserRound size={17} aria-hidden="true" />{messages.shell.myProfile}</Link>
                <Link role="menuitem" href="/account"><Settings2 size={17} aria-hidden="true" />{messages.shell.accountSecurity}</Link>
                <Link role="menuitem" href="/help"><CircleHelp size={17} aria-hidden="true" />{messages.shell.helpTutorial}</Link>
                <form
                  action={logoutAction}
                  onSubmit={() => clearBrowserSessionWorkspace(browserScope)}
                >
                  <button type="submit" role="menuitem"><LogOut size={17} aria-hidden="true" />{messages.shell.signOut}</button>
                </form>
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

      <main className="content-shell app-content">{children}</main>

      <dialog ref={drawerRef} className="app-drawer" aria-labelledby="app-drawer-title">
        <div className="app-drawer-head">
          <div>
            <span>{messages.shell.workspace}</span>
            <strong id="app-drawer-title">{messages.shell.menu}</strong>
          </div>
          <button type="button" onClick={() => drawerRef.current?.close()} aria-label={messages.shell.closeMenu}><X size={20} aria-hidden="true" /></button>
        </div>
        {allowAtmosphere ? <div className="app-drawer-atmosphere"><AtmosphereSelector compact locale={locale} staffUserId={user.id} initialAtmosphere={staffAtmosphere} /></div> : null}
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
        <div className="app-drawer-foot"><span>{user.name}</span><small><bdi className="bidi-ltr" dir="ltr">{user.email}</bdi></small></div>
      </dialog>
    </div>
  );
}

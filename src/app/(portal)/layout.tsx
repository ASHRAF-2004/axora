import { NavigationNotice } from "@/components/NavigationNotice";
import { PortalDraftManager } from "@/components/PortalDraftManager";
import { AppShell } from "@/components/app-shell/AppShell";
import { getAccountLifecycleSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { requestLocaleDecision } from "@/lib/locale-server";
import { getActiveCompanyBrand } from "@/lib/tenant-branding";
import { isDemoMode } from "@/lib/db";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";
import { unreadNotificationCount } from "@/lib/notification-repository";
import { landingPathForSession } from "@/lib/session-landing";
import {
  safeInternalReturnPath,
  SESSION_RETURN_HEADER,
} from "@/lib/session-return";
import { getUserAppearance } from "@/lib/user-appearance";
import type { AppearanceMode } from "@/lib/appearance";
import type { CSSProperties } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { portalMessages } from "@/lib/portal-i18n";
import {
  DRAWER_NAVIGATION,
  PRIMARY_NAVIGATION,
  visiblePortalNavigation,
} from "@/lib/portal-navigation";

export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true } };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AX";
}

function lifecycleRoute(path: string) {
  try {
    const pathname = new URL(path, "https://axora.management").pathname;
    return ["/profile", "/account", "/help"].some((prefix) => (
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    ));
  } catch {
    return false;
  }
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [requestHeaders, cookieStore] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const returnTo = safeInternalReturnPath(
    requestHeaders.get(SESSION_RETURN_HEADER),
    "/dashboard",
  );
  const hadSessionCookie = Boolean(cookieStore.get("axora_session")?.value);
  const user = await getAccountLifecycleSession();
  if (!user) {
    const params = new URLSearchParams({
      reason: hadSessionCookie ? "expired" : "required",
      returnTo,
    });
    redirect(`/login?${params.toString()}`);
  }

  const companyBrandPromise = user.companyId
    ? getActiveCompanyBrand(user.companyId, user)
    : Promise.resolve(null);
  const [localeDecision, profile] = await Promise.all([
    requestLocaleDecision(),
    getMyProfile(user),
  ]);
  const locale = profile.preferredLocale ?? localeDecision.locale;
  const onboardingComplete = myProfileMeetsRequiredOnboarding(profile);
  if (!onboardingComplete && !lifecycleRoute(returnTo)) {
    const params = new URLSearchParams({
      onboarding: "1",
      returnTo,
    });
    redirect(`/profile?${params.toString()}`);
  }

  const [companyBrand, unreadNotifications] = await Promise.all([
    companyBrandPromise,
    onboardingComplete ? unreadNotificationCount(user) : Promise.resolve(0),
  ]);
  const companyDefaultAppearance: AppearanceMode = companyBrand?.themePreference === "DARK" ? "dark" : "light";
  const appearance = await getUserAppearance(user, companyDefaultAppearance);
  const theme = companyBrand?.tokens;
  const messages = portalMessages(locale);
  const themeStyle = theme ? ({
    "--tenant-primary": theme.primary,
    "--tenant-primary-hover": theme.primaryHover,
    "--tenant-primary-active": theme.primaryActive,
    "--tenant-primary-foreground": theme.primaryForeground,
    "--tenant-secondary": theme.secondary,
    "--tenant-secondary-foreground": theme.secondaryForeground,
    "--tenant-accent": theme.accent,
    "--tenant-page-light": theme.pageBackground,
    "--tenant-page-dark": theme.darkPageBackground,
    "--tenant-surface-light": theme.surface,
    "--tenant-surface-dark": theme.darkSurface,
    "--tenant-muted-surface": theme.mutedSurface,
    "--tenant-border-light": theme.border,
    "--tenant-border-dark": theme.darkBorder,
    "--tenant-text-light": theme.text,
    "--tenant-text-dark": theme.textInverse,
    "--tenant-icon-light": theme.icon,
    "--tenant-icon-dark": theme.iconInverse,
    "--tenant-success": theme.success,
    "--tenant-warning": theme.warning,
    "--tenant-danger": theme.danger,
    "--tenant-focus": theme.focusRing,
    "--tenant-link": theme.link,
    "--tenant-chart-1": theme.chart[0] ?? theme.primary,
    "--tenant-chart-2": theme.chart[1] ?? theme.accent,
    "--tenant-chart-3": theme.chart[2] ?? theme.secondary,
    "--tenant-chart-4": theme.chart[3] ?? theme.link,
  } as CSSProperties) : undefined;
  const roleLabel = user.isOwner
    ? messages.roles.PLATFORM_OWNER
    : messages.roles[user.role] ?? messages.roles.SCOPED_USER;
  const isPlatformWorkspace = user.isOwner || user.accountKind === "PLATFORM";
  const primary = (onboardingComplete
    ? visiblePortalNavigation(PRIMARY_NAVIGATION, user, messages)
    : []).map((item) => (
    item.href === "/products" && isPlatformWorkspace ? { ...item, label: messages.quickActions.catalog } : item
  ));
  const quickAction = !onboardingComplete
    ? undefined
    : canAccess(user, "create_requests")
    ? { href: "/requests/new", label: messages.quickActions.newRequest }
    : user.isOwner
      ? { href: "/companies", label: messages.quickActions.addCompany }
      : undefined;
  return (
    <>
      <PortalDraftManager
        userId={user.id}
        scopeKey={[
          user.roleAssignmentId ?? "none", user.accountKind, user.scopeType,
          user.companyId ?? "none", user.branchId ?? "none",
          user.departmentId ?? "none", user.supplierId ?? "none",
        ].join(":")}
        locale={locale}
      />
      <NavigationNotice locale={locale} />
      <AppShell
        homeHref={onboardingComplete ? landingPathForSession(user) : "/profile?onboarding=1"}
        user={{
          id: user.id,
          name: user.name,
          email: user.email,
          roleLabel,
          initials: initials(user.name),
          companyId: user.companyId,
          avatarUrl: profile.avatarAvailable
            ? `/api/profile/avatar?v=${encodeURIComponent(profile.avatarVersion ?? "legacy")}`
            : undefined,
        }}
        primaryItems={primary}
        drawerItems={visiblePortalNavigation(DRAWER_NAVIGATION, user, messages)
          .filter((item) => onboardingComplete || item.href === "/help")
          .map((item) => (
          item.href === "/products" && isPlatformWorkspace
            ? { ...item, label: messages.quickActions.catalog }
            : item
        ))}
        quickAction={quickAction}
        locale={locale}
        appearance={appearance}
        brand={{
          name: companyBrand?.companyName ?? "Axora",
          logoUrl: companyBrand
            ? isDemoMode()
              ? "/brand/demo-company-logo.svg"
              : `/api/company-brand/${companyBrand.companyId}/logo?v=${companyBrand.themeVersion}`
            : "/brand/axora-logo-light.svg",
          tenant: Boolean(companyBrand),
          themeVersion: companyBrand?.themeVersion,
          logoVariant: companyBrand?.logoVariant,
          logoPlacement: companyBrand?.logoPlacement,
          style: themeStyle,
        }}
        unreadNotifications={unreadNotifications}
        profileRequired={!onboardingComplete}
      >
        {children}
      </AppShell>
    </>
  );
}

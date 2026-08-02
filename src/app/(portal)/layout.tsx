import { NavigationNotice } from "@/components/NavigationNotice";
import { AppShell } from "@/components/app-shell/AppShell";
import { requireAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { canAccess } from "@/lib/permissions";
import { requestLocaleDecision } from "@/lib/locale-server";
import { getActiveCompanyBrand } from "@/lib/tenant-branding";
import { getMyProfile, myProfileMeetsRequiredOnboarding } from "@/lib/profile";
import { listTutorialProgress } from "@/lib/onboarding";
import { unreadNotificationCount } from "@/lib/notification-repository";
import { landingPathForSession } from "@/lib/session-landing";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
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

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAccountLifecycleSession();
  const companyBrandPromise = user.companyId ? getActiveCompanyBrand(user.companyId) : Promise.resolve(null);
  const [localeDecision, profile] = await Promise.all([
    requestLocaleDecision(),
    getMyProfile(user),
  ]);
  const locale = profile.preferredLocale ?? localeDecision.locale;
  const onboardingComplete = myProfileMeetsRequiredOnboarding(profile);
  const [companyBrand, tutorialSteps, unreadNotifications] = await Promise.all([
    companyBrandPromise,
    onboardingComplete ? listTutorialProgress(user, user.role, locale) : Promise.resolve([]),
    onboardingComplete ? unreadNotificationCount(user) : Promise.resolve(0),
  ]);
  const theme = companyBrand?.tokens;
  const messages = portalMessages(locale);
  const themeStyle = theme ? ({
    "--tenant-primary": theme.primary,
    "--tenant-primary-foreground": theme.primaryForeground,
    "--tenant-secondary": theme.secondary,
    "--tenant-secondary-foreground": theme.secondaryForeground,
    "--tenant-accent": theme.accent,
    "--tenant-page": theme.pageBackground,
    "--tenant-surface": theme.surface,
    "--tenant-muted": theme.mutedSurface,
    "--tenant-border": theme.border,
    "--tenant-focus": theme.focusRing,
    "--tenant-link": theme.link,
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
      : canAccess(user, "manage_sourcing")
        ? { href: "/sourcing", label: messages.quickActions.openSourcing }
      : undefined;
  return (
    <>
      <NavigationNotice locale={locale} />
      <AppShell
        homeHref={onboardingComplete ? landingPathForSession(user) : "/profile?onboarding=1"}
        user={{ name: user.name, email: user.email, roleLabel, initials: initials(user.name), avatarUrl: profile.avatarAvailable ? "/api/profile/avatar" : undefined }}
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
        brand={{
          name: companyBrand?.companyName ?? "Axora",
          logoUrl: companyBrand ? `/api/company-brand/${companyBrand.companyId}/logo?v=${companyBrand.themeVersion}` : "/brand/axora-logo.png",
          tenant: Boolean(companyBrand),
          themeVersion: companyBrand?.themeVersion,
          style: themeStyle,
        }}
        environmentLabel={isDemoMode() ? messages.environment.sample : messages.environment.production}
        unreadNotifications={unreadNotifications}
        profileRequired={!onboardingComplete}
        tutorial={{ roleKey: user.role, steps: tutorialSteps }}
      >
        {children}
      </AppShell>
    </>
  );
}

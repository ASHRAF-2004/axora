import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { portalMessages } from "@/lib/portal-i18n";
import {
  DRAWER_NAVIGATION,
  PRIMARY_NAVIGATION,
  visiblePortalNavigation,
} from "@/lib/portal-navigation";
import { canAccess, type AccessSubject } from "@/lib/permissions";

const messages = portalMessages("en");
const companyId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";

function hrefs(
  items: Parameters<typeof visiblePortalNavigation>[0],
  subject: AccessSubject,
) {
  return visiblePortalNavigation(items, subject, messages).map((item) => item.href);
}

describe("role-specific portal navigation boundaries", () => {
  it("gives company administrators customer tools but no Axora catalog, supplier, or brand controls", () => {
    const companyAdmin: AccessSubject = {
      role: "COMPANY_ADMIN",
      isOwner: false,
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId,
    };

    expect(hrefs(PRIMARY_NAVIGATION, companyAdmin)).toEqual([
      "/dashboard", "/receiving", "/products", "/requests", "/approvals", "/budgets", "/wallet", "/deliveries", "/finance",
    ]);
    expect(hrefs(DRAWER_NAVIGATION, companyAdmin)).toEqual([
      "/receiving", "/branches", "/budgets", "/wallet",
      `/companies/${companyId}/users`, "/settings/procurement",
      "/reports", "/audit", "/settings", "/help",
    ]);
    expect(canAccess(companyAdmin, "manage_catalog")).toBe(false);
    expect(canAccess(companyAdmin, "manage_commercial_pricing")).toBe(false);
  });

  it("removes supplier navigation while keeping delivery accounts scoped", () => {
    const driver: AccessSubject = {
      role: "DELIVERY_DRIVER", isOwner: false, accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    };

    expect(PRIMARY_NAVIGATION.some((item) => item.href === "/supplier")).toBe(false);
    expect(DRAWER_NAVIGATION.some((item) => item.href === "/supplier")).toBe(false);
    expect(hrefs(PRIMARY_NAVIGATION, driver)).toEqual(["/driver"]);
    expect(hrefs(DRAWER_NAVIGATION, driver)).toEqual(["/driver", "/settings", "/help"]);
  });

  it("keeps support and auditors read-only while receivers see only receiving work", () => {
    const support: AccessSubject = {
      role: "TECHNICAL_SUPPORT", isOwner: false, accountKind: "PLATFORM", scopeType: "PLATFORM",
    };
    const auditor: AccessSubject = {
      role: "AUDITOR", isOwner: false, accountKind: "COMPANY",
      scopeType: "COMPANY", companyId,
    };
    const receiver: AccessSubject = {
      role: "RECEIVING_USER", isOwner: false, accountKind: "COMPANY",
      scopeType: "BRANCH", companyId, branchId,
    };

    expect(hrefs(PRIMARY_NAVIGATION, support)).toEqual([]);
    expect(hrefs(DRAWER_NAVIGATION, support)).toEqual(["/support", "/settings", "/help"]);
    expect(hrefs(PRIMARY_NAVIGATION, auditor)).toEqual([
      "/dashboard", "/products", "/requests", "/budgets", "/deliveries", "/finance",
    ]);
    expect(hrefs(DRAWER_NAVIGATION, auditor)).toEqual([
      "/branches", "/budgets", "/reports", "/audit", "/settings", "/help",
    ]);
    expect(hrefs(PRIMARY_NAVIGATION, receiver)).toEqual(["/receiving"]);
    expect(hrefs(DRAWER_NAVIGATION, receiver)).toEqual(["/receiving", "/settings", "/help"]);

    for (const subject of [support, auditor]) {
      expect(canAccess(subject, "manage_catalog")).toBe(false);
      expect(canAccess(subject, "manage_users")).toBe(false);
      expect(canAccess(subject, "manage_finance")).toBe(false);
    }
    expect(canAccess(support, "view_audit")).toBe(false);
    expect(canAccess(support, "view_system_diagnostics")).toBe(true);
  });

  it("keeps profile and account controls available to every authenticated actor", async () => {
    const [shell, profilePage, accountPage, profileActions] = await Promise.all([
      readFile(new URL("../src/components/app-shell/AppShell.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/profile/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/account/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/profile/actions.ts", import.meta.url), "utf8"),
    ]);
    expect(shell).toContain('href="/profile"');
    expect(shell).toContain('href="/account"');
    expect(profilePage).toContain("await requireAccountLifecycleSession()");
    expect(accountPage).toContain("await requireAccountLifecycleSession()");
    expect(profileActions).toContain("landingPathForSession(actor)");
  });

  it("exposes email operations only to the authorized platform operations boundary", () => {
    const owner: AccessSubject = {
      role: "PLATFORM_OWNER", isOwner: true, accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    };
    const operations: AccessSubject = {
      role: "PLATFORM_OPERATIONS", isOwner: false, accountKind: "PLATFORM",
      scopeType: "PLATFORM",
    };
    const manager: AccessSubject = {
      role: "CLIENT_ACCOUNT_MANAGER", isOwner: false, accountKind: "PLATFORM",
      scopeType: "COMPANY", companyId,
    };
    const companyAdmin: AccessSubject = {
      role: "COMPANY_ADMIN", isOwner: false, accountKind: "COMPANY",
      scopeType: "COMPANY", companyId,
    };

    for (const subject of [owner, operations]) {
      expect(hrefs(DRAWER_NAVIGATION, subject)).toContain("/email-operations");
      expect(canAccess(subject, "view_email_operations")).toBe(true);
    }
    expect(canAccess(owner, "manage_email_operations")).toBe(true);
    expect(canAccess(operations, "manage_email_operations")).toBe(true);
    expect(canAccess(manager, "view_email_operations")).toBe(false);
    expect(canAccess(manager, "manage_email_operations")).toBe(false);
    expect(hrefs(DRAWER_NAVIGATION, companyAdmin)).not.toContain("/email-operations");
    expect(canAccess(companyAdmin, "view_email_operations")).toBe(false);
  });

  it("fails navigation closed for a forged owner flag", () => {
    const forged: AccessSubject = {
      role: "COMPANY_ADMIN",
      isOwner: true,
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId,
    };
    expect(hrefs(PRIMARY_NAVIGATION, forged)).toEqual([]);
    expect(hrefs(DRAWER_NAVIGATION, forged)).toEqual(["/settings", "/help"]);
    expect(canAccess(forged, "manage_companies")).toBe(false);
  });
});

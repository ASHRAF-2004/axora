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
const supplierId = "30000000-0000-4000-8000-000000000001";

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
      "/dashboard", "/products", "/requests", "/approvals", "/deliveries", "/finance",
    ]);
    expect(hrefs(DRAWER_NAVIGATION, companyAdmin)).toEqual([
      "/branches", "/users", "/documents", "/reports", "/audit", "/settings", "/help",
    ]);
    expect(canAccess(companyAdmin, "manage_catalog")).toBe(false);
    expect(canAccess(companyAdmin, "manage_suppliers")).toBe(false);
    expect(canAccess(companyAdmin, "manage_commercial_pricing")).toBe(false);
  });

  it("keeps supplier and delivery accounts inside their minimal workspaces", () => {
    const supplier: AccessSubject = {
      role: "SUPPLIER_USER", isOwner: false, accountKind: "SUPPLIER",
      scopeType: "SUPPLIER", supplierId,
    };
    const driver: AccessSubject = {
      role: "DELIVERY_DRIVER", isOwner: false, accountKind: "DELIVERY",
      scopeType: "DELIVERY",
    };

    expect(hrefs(PRIMARY_NAVIGATION, supplier)).toEqual(["/supplier"]);
    expect(hrefs(DRAWER_NAVIGATION, supplier)).toEqual(["/supplier", "/settings", "/help"]);
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
      "/dashboard", "/products", "/requests", "/deliveries", "/finance",
    ]);
    expect(hrefs(DRAWER_NAVIGATION, auditor)).toEqual([
      "/branches", "/documents", "/reports", "/audit", "/settings", "/help",
    ]);
    expect(hrefs(PRIMARY_NAVIGATION, receiver)).toEqual(["/receiving"]);
    expect(hrefs(DRAWER_NAVIGATION, receiver)).toEqual(["/receiving", "/settings", "/help"]);

    for (const subject of [support, auditor]) {
      expect(canAccess(subject, "manage_catalog")).toBe(false);
      expect(canAccess(subject, "manage_suppliers")).toBe(false);
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

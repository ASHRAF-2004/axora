import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getOverview: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireAccountLifecycleSession: mocks.requireSession,
}));
vi.mock("@/lib/account-security", () => ({
  getAccountSecurityOverview: mocks.getOverview,
}));

import AccountPage from "@/app/(portal)/account/page";

const actor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "person@example.test",
  name: "Person",
  role: "AUDITOR",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
  authVersion: 4,
};

describe("account security responsive markup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(actor);
    mocks.getOverview.mockResolvedValue({
      email: actor.email,
      preferredLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
      emailNotifications: true,
      inAppNotifications: true,
      unreadNotifications: 2,
      activeSessions: [{
        id: "00000000-0000-4000-8000-000000000002",
        issuedAt: "2026-08-02T01:00:00.000Z",
        lastSeenAt: "2026-08-02T02:00:00.000Z",
        expiresAt: "2026-08-02T09:00:00.000Z",
        isCurrent: true,
      }, {
        id: "00000000-0000-4000-8000-000000000003",
        issuedAt: "2026-08-02T01:00:00.000Z",
        lastSeenAt: "2026-08-02T02:00:00.000Z",
        expiresAt: "2026-08-02T09:00:00.000Z",
        userAgentSummary: "Mobile browser",
        isCurrent: false,
      }],
    });
  });

  it("renders labelled password and session controls without secret columns", async () => {
    const html = renderToStaticMarkup(await AccountPage({
      searchParams: Promise.resolve({}),
    }));
    expect(html).toContain("Account &amp; security");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-controls="account-current-password"');
    expect(html).toContain("End session");
    expect(html).toContain("End all other sessions");
    expect(html).not.toContain("token_hash");
    expect(html).not.toContain("network_hash");
    expect(html).not.toContain("current-private-cookie");
  });

  it("has bounded grids and a single-column mobile layout", async () => {
    const css = await readFile(new URL(
      "../src/app/(portal)/account/AccountSecurity.module.css",
      import.meta.url,
    ), "utf8");
    expect(css).toContain("minmax(0, 1fr)");
    expect(css).toMatch(/@media \(max-width: 620px\)/);
    expect(css).toMatch(/\.sessionRow\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("uses the saved Arabic locale, RTL direction, and profile timezone", async () => {
    mocks.getOverview.mockResolvedValueOnce({
      email: actor.email,
      preferredLocale: "ar",
      timezone: "Asia/Riyadh",
      emailVerifiedAt: "2026-08-02T01:00:00.000Z",
      emailNotifications: true,
      inAppNotifications: true,
      unreadNotifications: 0,
      activeSessions: [],
    });
    const html = renderToStaticMarkup(await AccountPage({
      searchParams: Promise.resolve({ security: "password-changed" }),
    }));
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("الحساب والأمان");
    expect(html).toContain("تم تغيير كلمة المرور");
  });
});

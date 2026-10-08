import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
const state = vi.hoisted(() => ({ session: null as unknown, budget: { accounts: [{ available: "private-value" }] } as unknown, notification: { unreadCount: 2, versionToken: "a".repeat(32), capturedAt: "first" } }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/notification-repository", () => ({ notificationSummary: vi.fn(async () => state.notification) }));
vi.mock("@/lib/driver-operations", () => ({ getAvailableDeliveryJobs: vi.fn(async () => ({ jobs: [], capturedAt: "now" })), getDriverManagementWorkspace: vi.fn(async () => ({ drivers: [{ id: "private-id", email: "private@example.invalid", lastLatitude: 3.14 }], sequence: Date.now(), capturedAt: "now" })), getDriverDetailWorkspace: vi.fn(async () => null) }));
vi.mock("@/lib/delivery-tracking", () => ({ getCompanyDeliveryTracking: vi.fn(async () => ({ sessions: [] })) }));
vi.mock("@/lib/budget-ledger", () => ({ getBudgetWorkspace: vi.fn(async () => state.budget) }));
vi.mock("@/lib/company-wallet", () => ({ getCompanyWalletWorkspace: vi.fn(async () => null) }));
vi.mock("@/lib/repository", () => ({ customerCatalogLiveVersion: vi.fn(async () => ({ count: "5" })) }));
vi.mock("@/lib/request-reader", () => ({ requestLiveVersion: vi.fn(async () => ({ count: "7" })) }));
vi.mock("@/lib/procurement-cart", () => ({ getCatalogPurchasingScope: vi.fn(async () => ({ companyId: "safe", allowedCategories: [] })) }));
import { getSession } from "@/lib/auth";
import { createLiveReader } from "@/lib/live-update-reader";
import { getCompanyWalletWorkspace } from "@/lib/company-wallet";
import { GET } from "@/app/api/live/route";

const actor: AuthenticatedSessionUser = {
  id: "00000000-0000-4000-8000-000000000001", email: "public-fixture@example.invalid", name: "Fixture", role: "COMPANY_ADMIN",
  isOwner: false, roleAssignmentId: "00000000-0000-4000-8000-000000000002", companyId: "00000000-0000-4000-8000-000000000003",
  accountKind: "COMPANY", scopeType: "COMPANY", authVersion: 1, effectivePermissions: ["view_catalog", "view_wallet", "view_requests", "view_budgets"],
};
describe("authorized shared live snapshots", () => {
  beforeEach(() => { vi.clearAllMocks(); state.session = actor; state.budget = { accounts: [{ available: "private-value" }] }; state.notification = { unreadCount: 2, versionToken: "a".repeat(32), capturedAt: "first" }; });
  afterEach(() => vi.unstubAllEnvs());
  it("does not version notification state by changing capture timestamps", async () => {
    const reader = createLiveReader(actor, ["notifications"], {});
    const first = await reader.load();
    state.notification.capturedAt = "second";
    expect(await reader.load()).toEqual(first);
    state.notification.versionToken = "b".repeat(32);
    expect((await reader.load()).topics.notifications?.version).not.toBe(first.topics.notifications?.version);
  });
  it("ignores only demo synthetic period dates and keeps real budget dates versioned", async () => {
    const budget = (date: string, available = "1") => ({ accounts: [{ period: { id: "demo-period-fixture", name: "2026-10", startsAt: date, endsAt: date, nextRefreshAt: date, available } }] });
    vi.stubEnv("DEMO_MODE", "true");
    const reader = createLiveReader(actor, ["budgets"], {});
    state.budget = budget("first"); const first = await reader.load();
    state.budget = budget("second"); expect(await reader.load()).toEqual(first);
    state.budget = budget("second", "2"); expect(await reader.load()).not.toEqual(first);
    vi.stubEnv("DEMO_MODE", "false");
    state.budget = budget("first"); const real = await reader.load();
    state.budget = budget("second"); expect(await reader.load()).not.toEqual(real);
  });
  it.each(["logout", "expiry", "suspension", "assignment", "deny"])("fails closed after %s changes", async (change) => {
    const reader = createLiveReader(actor, ["catalog"], { branchId: "safe-fixture" });
    await reader.authorize();
    state.session = ["logout", "expiry", "suspension"].includes(change) ? null : change === "assignment" ? { ...actor, roleAssignmentId: "foreign" } : { ...actor, effectivePermissions: [] };
    await expect(reader.authorize()).rejects.toThrow();
    await expect(reader.load()).rejects.toThrow();
  });
  it("does not put operational identities, GPS or financial values on the wire", async () => {
    const manager = { ...actor, role: "PLATFORM_OPERATIONS", companyId: undefined, accountKind: "PLATFORM", scopeType: "PLATFORM", effectivePermissions: ["manage_deliveries", "view_budgets"] } as AuthenticatedSessionUser;
    state.session = manager;
    const snapshot = await createLiveReader(manager, ["drivers", "budgets"], {}).load();
    expect(JSON.stringify(snapshot)).not.toMatch(/private|latitude|email|available/i);
    expect(snapshot.topics.drivers?.version).toMatch(/^[a-f0-9]{64}$/);
    expect(getSession).toHaveBeenCalledTimes(2);
  });
  it("rejects unauthorized roles and malformed topic/context subscriptions", async () => {
    expect((await GET(new Request("https://axora.invalid/api/live?topics=drivers&transport=poll"))).status).toBe(403);
    expect((await GET(new Request("https://axora.invalid/api/live?topics=catalog&driverId=bad"))).status).toBe(400);
    state.session = null;
    expect((await GET(new Request("https://axora.invalid/api/live?transport=poll"))).status).toBe(401);
  });
  it("passes a company selector only to the existing capability and fails closed", async () => {
    const companyId = "00000000-0000-4000-8000-000000000009";
    const response = await GET(new Request(`https://axora.invalid/api/live?topics=wallet&companyId=${companyId}&transport=poll`));
    expect(getCompanyWalletWorkspace).toHaveBeenCalledWith(actor, companyId);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(companyId);
  });
  it("checks fresh session again before polling output and returns only hint/count", async () => {
    const response = await GET(new Request("https://axora.invalid/api/live?topics=notifications,requests&transport=poll"));
    expect(response.status).toBe(200);
    const snapshot = await response.json();
    expect(snapshot.topics.notifications.unreadCount).toBe(2);
    expect(snapshot.topics.requests).toEqual({ version: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(snapshot)).not.toContain('"count"');
    expect(getSession).toHaveBeenCalledTimes(5);
  });
});

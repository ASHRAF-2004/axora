import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { CompanyLifecycleWorkspace } from "@/lib/company-lifecycle";

const state = vi.hoisted(() => ({ session: null as unknown }));
vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/company-lifecycle", () => ({ loadCompanyLifecycleWorkspace: vi.fn() }));
import { loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { GET } from "@/app/api/companies/register/route";

const actor: AuthenticatedSessionUser = {
  id: "00000000-0000-4000-8000-000000000001", email: "register-fixture@axora.invalid", name: "Register fixture",
  role: "CLIENT_ACCOUNT_MANAGER", isOwner: false, accountKind: "PLATFORM", scopeType: "PLATFORM",
  roleAssignmentId: "00000000-0000-4000-8000-000000000002", authVersion: 1,
  effectivePermissions: ["manage_companies"], preferredLocale: "en",
};
const company = {
  id: "visible-company", name: "Visible company", code: "C-123", industry: "Education", status: "ACTIVE",
  mainContactName: "Visible contact", mainContactEmail: "private@axora.invalid", notes: "Private notes",
  primaryManager: { email: "private-manager@axora.invalid" },
};
const workspace = (companies = [company]) => ({ companies }) as unknown as CompanyLifecycleWorkspace;

describe("company register authorized JSON read", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.session = actor;
    vi.mocked(loadCompanyLifecycleWorkspace).mockResolvedValue(workspace());
  });
  it("denies anonymous and company users before loading the workspace", async () => {
    state.session = null;
    expect((await GET(new Request("https://axora.invalid/api/companies/register"))).status).toBe(401);
    state.session = { ...actor, role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", effectivePermissions: ["view_requests"] };
    const denied = await GET(new Request("https://axora.invalid/api/companies/register"));
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("visible-company");
    expect(loadCompanyLifecycleWorkspace).not.toHaveBeenCalled();
  });
  it("projects only register columns from the actor's existing authorized workspace", async () => {
    const response = await GET(new Request("https://axora.invalid/api/companies/register?companyId=foreign-company"));
    expect(response.status).toBe(200);
    expect(loadCompanyLifecycleWorkspace).toHaveBeenCalledExactlyOnceWith(actor);
    expect(await response.json()).toEqual({ companies: [{ id: company.id, name: company.name, industry: company.industry, status: company.status, mainContactName: company.mainContactName }] });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
  });
  it("preserves search, status filtering and the default archive exclusion", async () => {
    vi.mocked(loadCompanyLifecycleWorkspace).mockResolvedValue(workspace([
      company, { ...company, id: "archived-company", status: "ARCHIVED" },
      { ...company, id: "setup-company", code: "C-456", name: "Another company", status: "ONBOARDING" },
    ]));
    const read = async (suffix: string) => (await (await GET(new Request(`https://axora.invalid/api/companies/register${suffix}`))).json()).companies;
    expect((await read("")).map((row: { id: string }) => row.id)).toEqual(["visible-company", "setup-company"]);
    expect((await read("?q=%EF%BC%A3-456&status=SETUP")).map((row: { id: string }) => row.id)).toEqual(["setup-company"]);
    expect(await read("?q=C-456&status=ACTIVE")).toEqual([]);
  });
  it("checks the new session on each read and hides capability failures", async () => {
    expect((await GET(new Request("https://axora.invalid/api/companies/register"))).status).toBe(200);
    state.session = { ...actor, effectivePermissions: [] };
    expect((await GET(new Request("https://axora.invalid/api/companies/register"))).status).toBe(403);
    state.session = actor;
    vi.mocked(loadCompanyLifecycleWorkspace).mockRejectedValue(new Error("private company failure"));
    const unavailable = await GET(new Request("https://axora.invalid/api/companies/register"));
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).not.toMatch(/private|visible-company/);
  });
});

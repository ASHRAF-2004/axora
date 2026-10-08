import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach,describe,expect,it,vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";

const mocks = vi.hoisted(() => ({ actor: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePagePermission: mocks.actor }));
vi.mock("@/app/(portal)/branches/actions", () => ({
  addBranchBudgetAction: vi.fn(),setBranchActiveAction: vi.fn(),deleteBranchAction: vi.fn(),
}));
vi.mock("@/lib/organization-access", () => ({ loadOrganizationDirectory: async () => ({ branches: [{
  id: "bc000000-0000-4000-8000-000000000004",companyId: "bc000000-0000-4000-8000-000000000002",
  companyName: "Isolated tenant",name: "Isolated branch",branchCode: "BC-TEST",city: "Cyberjaya",
  status: "Active",deliveryAddress: "Isolated destination",canViewBudget: false,
}] }) }));
vi.mock("@/lib/branch-delivery-location", () => ({ loadBranchDeliveryLocationWorkspace: async () => null }));
vi.mock("@/lib/user-isolation", () => ({ listAuthorizedUsers: async () => [] }));
vi.mock("@/components/UxFeedbackProvider", () => ({ useUxFeedback: () => ({ confirm: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }),notFound: () => { throw new Error("Fixture branch not found"); } }));
import BranchDetailPage from "@/app/(portal)/branches/[branchId]/page";

const actor = { id: "bc000000-0000-4000-8000-000000000001",email: "branch-controls@example.test",
  name: "Isolated control actor",role: "COMPANY_ADMIN",isOwner: false,accountKind: "COMPANY",scopeType: "COMPANY",
  authVersion: 1,companyId: "bc000000-0000-4000-8000-000000000002",
  roleAssignmentId: "bc000000-0000-4000-8000-000000000003",effectivePermissions: ["view_branches","manage_branches"],
} satisfies AuthenticatedSessionUser;
const branch = "bc000000-0000-4000-8000-000000000004";

describe("branch lifecycle control rendering", () => {
  beforeEach(() => { mocks.actor.mockReset(); });
  it("does not render destructive lifecycle for Branch Administrator with custom route GRANT; operational edit stays", async () => {
    mocks.actor.mockResolvedValue({ ...actor,role: "BRANCH_ADMIN",scopeType: "BRANCH",branchId: branch });
    const html = renderToStaticMarkup(await BranchDetailPage({ params: Promise.resolve({ branchId: branch }) }));
    expect(html).toContain(`/branches/${branch}/edit`);
    expect(html).not.toContain("Delete branch"); expect(html).not.toContain("Deactivate");
    expect(html).toContain("Isolated destination");
  });
  it("retains authorized Company Administrator lifecycle", async () => {
    mocks.actor.mockResolvedValue(actor);
    const html = renderToStaticMarkup(await BranchDetailPage({ params: Promise.resolve({ branchId: branch }) }));
    expect(html).toContain("Delete branch"); expect(html).toContain("Deactivate");
  });
});

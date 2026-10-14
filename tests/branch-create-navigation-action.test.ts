import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }) }));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/branch-creation", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/branch-creation")>(), createBranchWithLocation: vi.fn(),
}));
import { requirePermission, type AuthenticatedSessionUser } from "@/lib/auth";
import { BranchCreationError, createBranchWithLocation } from "@/lib/branch-creation";
import { createBranchWithLocationNavigationAction } from "@/app/(portal)/branches/new/actions";
import { redirect } from "next/navigation";

const actor = {
  name: "Branch fixture", email: "branch-fixture@axora.invalid", isOwner: false, authVersion: 1,
  id: "00000000-0000-4000-8000-000000000001", role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY",
  companyId: "00000000-0000-4000-8000-000000000003", effectivePermissions: ["manage_branches"],
} satisfies AuthenticatedSessionUser;
const initial = { status: "idle", message: "", submissionId: "" } as const;
function form() {
  const data = new FormData();
  const values = { companyId: actor.companyId!, commandId: "00000000-0000-4000-8000-000000000004",
    name: "Receiving branch", branchCode: "RECEIVING", city: "Cyberjaya", addressLabel: "Confirmed receiving location",
    latitude: "2.91", longitude: "101.64", providerId: "controlled-fixture", contactName: "Receiving contact",
    contactPhone: "+12025550123", contactEmail: "" };
  for (const [name, value] of Object.entries(values)) data.set(name, value);
  return data;
}

describe("branch form navigation completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(actor);
    vi.mocked(createBranchWithLocation).mockResolvedValue("branch-created-once");
  });
  it("commits once with the existing command and redirects only after success", async () => {
    await expect(createBranchWithLocationNavigationAction(initial, form())).rejects.toThrow("REDIRECT:/branches/branch-created-once?notice=branch-created");
    expect(requirePermission).toHaveBeenCalledExactlyOnceWith("manage_branches");
    expect(createBranchWithLocation).toHaveBeenCalledExactlyOnceWith(actor, expect.objectContaining({ commandId: "00000000-0000-4000-8000-000000000004", companyId: actor.companyId, latitude: 2.91, longitude: 101.64 }));
    expect(redirect).toHaveBeenCalledOnce();
  });
  it("rejects a foreign company without committing or redirecting", async () => {
    const data = form(); data.set("companyId", "00000000-0000-4000-8000-000000000009");
    expect((await createBranchWithLocationNavigationAction(initial, data)).status).toBe("error");
    expect(createBranchWithLocation).not.toHaveBeenCalled(); expect(redirect).not.toHaveBeenCalled();
  });
  it("keeps validation and duplicate errors as form states without redirecting", async () => {
    const invalid = form(); invalid.set("contactPhone", "bad phone");
    expect((await createBranchWithLocationNavigationAction(initial, invalid)).status).toBe("error");
    expect(createBranchWithLocation).not.toHaveBeenCalled();
    vi.mocked(createBranchWithLocation).mockRejectedValue(new BranchCreationError("DUPLICATE"));
    const duplicate = await createBranchWithLocationNavigationAction(initial, form());
    expect(duplicate.status).toBe("error"); expect(duplicate.message).toContain("already exists");
    expect(createBranchWithLocation).toHaveBeenCalledOnce(); expect(redirect).not.toHaveBeenCalled();
  });
});

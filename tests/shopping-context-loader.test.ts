import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSessionUser } from "@/lib/auth";

const loadOrganizationDirectory = vi.fn();
const loadBranchDeliveryLocationWorkspace = vi.fn();
const getCatalogPurchasingScope = vi.fn();

vi.mock("@/lib/organization-access", () => ({ loadOrganizationDirectory }));
vi.mock("@/lib/branch-delivery-location", () => ({ loadBranchDeliveryLocationWorkspace }));
vi.mock("@/lib/procurement-cart", () => ({ getCatalogPurchasingScope }));

const companyId = "10000000-0000-4000-8000-000000000001";
const readyId = "20000000-0000-4000-8000-000000000001";
const missingId = "20000000-0000-4000-8000-000000000002";
const inactiveId = "20000000-0000-4000-8000-000000000003";
const foreignId = "20000000-0000-4000-8000-000000000004";
const actor: AuthenticatedSessionUser = {
  id: "30000000-0000-4000-8000-000000000001", email: "admin@example.test", name: "Admin",
  role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", companyId,
  roleAssignmentId: "40000000-0000-4000-8000-000000000001", isOwner: false, authVersion: 1,
};
const branch = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, companyId, name: id, code: id, branchCode: id, city: "Cyberjaya",
  deliveryAddress: "Delivery address", status: "Active", ...overrides,
});

describe("server-authorized shopping branch contexts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOrganizationDirectory.mockResolvedValue({ companies: [], branches: [
      branch(readyId), branch(missingId, { deliveryAddress: "" }),
      branch(inactiveId, { status: "Inactive" }),
      branch(foreignId, { companyId: "90000000-0000-4000-8000-000000000001" }),
    ] });
    getCatalogPurchasingScope.mockImplementation(async (_actor: unknown, branchId: string) => ({ companyId, branchId, allowedCategories: [] }));
    loadBranchDeliveryLocationWorkspace.mockImplementation(async (_actor: unknown, branchId: string) => ({
      canManage: true,
      location: branchId === readyId ? { addressLabel: "Canonical delivery address" } : null,
    }));
  });

  it("includes only active own-company branches and marks missing location as unready", async () => {
    const { loadShoppingBranchContexts } = await import("@/lib/shopping-context");
    await expect(loadShoppingBranchContexts(actor)).resolves.toEqual([
      expect.objectContaining({ id: readyId, ready: true, address: "Canonical delivery address" }),
      expect.objectContaining({ id: missingId, ready: false }),
    ]);
  });

  it("returns a useful empty input set without manufacturing a first branch", async () => {
    loadOrganizationDirectory.mockResolvedValue({ companies: [], branches: [] });
    const { loadShoppingBranchContexts } = await import("@/lib/shopping-context");
    await expect(loadShoppingBranchContexts(actor)).resolves.toEqual([]);
  });

  it("narrows a branch-scoped actor before any browser branch value is considered", async () => {
    const { loadShoppingBranchContexts } = await import("@/lib/shopping-context");
    const scoped = { ...actor, role: "BRANCH_ADMIN" as const, scopeType: "BRANCH" as const, branchId: readyId };
    await expect(loadShoppingBranchContexts(scoped)).resolves.toEqual([
      expect.objectContaining({ id: readyId, ready: true }),
    ]);
  });
});

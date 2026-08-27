import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withAuditTransaction: vi.fn(async (
      _context: unknown,
      work: (transactionClient: typeof client) => Promise<unknown>,
    ) => work(client)),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("@/lib/permissions", () => ({
  canAccess: () => true,
  canManageCommercialCatalog: () => true,
}));

import type { SessionUser } from "@/lib/auth";
import { updateProduct } from "@/lib/product-admin";

const actor = {
  id: "71146c95-fe57-4532-92f8-cc13132edd70",
  roleAssignmentId: "81146c95-fe57-4532-92f8-cc13132edd70",
} as SessionUser;

describe("product administration query contract", () => {
  beforeEach(() => {
    mocks.client.query.mockReset();
    mocks.withAuditTransaction.mockClear();
    mocks.client.query.mockImplementation(async (sql: unknown) => ({
      rowCount: typeof sql === "string" && sql.includes("id<>$1") ? 0 : 1,
      rows: [],
    }));
  });

  it("updates only columns that exist in the current products schema", async () => {
    await updateProduct("91146c95-fe57-4532-92f8-cc13132edd70", {
      name: "Schema-safe paper",
      category: "Office supplies",
      subcategory: "Paper",
      brand: "Axora",
      size: "A4",
      unit: "ream",
      packaging: "Box",
      description: "Product update regression fixture",
      defaultBuyPrice: 12.5,
      defaultSellPrice: 13.75,
      deliverySlaDays: 2,
    }, actor);

    const update = mocks.client.query.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("UPDATE products SET"));
    expect(update).toBeDefined();
    const sql = String(update?.[0]);
    expect(sql).toContain("minimum_order_quantity=1");
    expect(sql).not.toMatch(/maximum_order_quantity|order_increment|pack_size|pack_unit/);
    expect(update?.[1]).toHaveLength(12);
  });
});

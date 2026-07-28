import type { SessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";

export async function deleteProduct(productId: string, actor: SessionUser) {
  if (!actor.isOwner) {
    throw new Error("Only an Axora platform owner can permanently delete products.");
  }

  if (isDemoMode()) {
    const store = getDemoStore();
    const productIndex = store.products.findIndex((product) => product.id === productId);
    if (productIndex < 0) throw new Error("Product not found.");

    const usedInRequests = store.requests.some((request) =>
      request.lines.some((line) => line.productId === productId),
    );
    if (usedInRequests) {
      throw new Error("This product is used in purchase history and cannot be permanently deleted. Deactivate it instead.");
    }

    store.products.splice(productIndex, 1);
    return;
  }

  await withAuditTransaction(
    { userId: actor.id, reason: "Product permanently deleted" },
    async (client) => {
      const productResult = await client.query<{ name: string }>(
        "SELECT name FROM products WHERE id=$1 FOR UPDATE",
        [productId],
      );
      const product = productResult.rows[0];
      if (!product) throw new Error("Product not found.");

      const usageResult = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM request_lines WHERE product_id=$1",
        [productId],
      );
      const usageCount = Number(usageResult.rows[0]?.count ?? 0);
      if (usageCount > 0) {
        throw new Error(
          `“${product.name}” is used in ${usageCount} purchase request line${usageCount === 1 ? "" : "s"} and cannot be permanently deleted. Deactivate it instead.`,
        );
      }

      await client.query("DELETE FROM product_suppliers WHERE product_id=$1", [productId]);
      await client.query("DELETE FROM product_images WHERE product_id=$1", [productId]);
      const deletion = await client.query("DELETE FROM products WHERE id=$1", [productId]);
      if (!deletion.rowCount) throw new Error("Product not found.");
    },
  );
}

import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";
import { canAccess } from "./permissions";
import { calculateCommercialSellingPrice, withDemoCommercialDefaults } from "./procurement-rules";
import type { ProductInput } from "./validation";

export interface ProductCommercialHistoryEntry {
  id: string; baseCost: number; rawSellingPrice: number; sellingPrice: number;
  markupPercentage: number; currency: string; pricingRuleVersion: number;
  source: string; reason: string; effectiveFrom: string; recordedAt: string;
}

export async function listProductCommercialHistory(productId: string, actor: SessionUser) {
  if (!canAccess(actor, "manage_commercial_pricing") || !actor.roleAssignmentId) {
    return [];
  }
  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === productId);
    if (!product) return [];
    const priced = withDemoCommercialDefaults(product);
    return [{
      id: `demo-price-${product.id}`,
      baseCost: product.defaultBuyPrice,
      rawSellingPrice: product.defaultBuyPrice * 1.1,
      sellingPrice: priced.defaultSellPrice,
      markupPercentage: 10,
      currency: "MYR",
      pricingRuleVersion: 1,
      source: "SYSTEM_DEFAULT",
      reason: "Demo commercial pricing baseline",
      effectiveFrom: product.priceEffectiveFrom ?? new Date(0).toISOString(),
      recordedAt: product.priceChangedAt ?? new Date(0).toISOString(),
    }] satisfies ProductCommercialHistoryEntry[];
  }
  const result = await withAuditTransaction(
    { actor, reason: "Viewed confidential product commercial price history" },
    (client) => client.query<{ payload: ProductCommercialHistoryEntry[] | null }>(
      "SELECT public.axora_product_commercial_history($1,$2,$3,now()) AS payload",
      [actor.id, actor.roleAssignmentId, productId],
    ),
  );
  return result.rows[0]?.payload ?? [];
}

export async function updateProduct(productId: string, input: ProductInput, actor: SessionUser) {
  if (!canAccess(actor, "manage_catalog")) throw new Error("Your account cannot manage the product catalog.");

  if (isDemoMode()) {
    const store = getDemoStore();
    const product = store.products.find((item) => item.id === productId);
    if (!product) throw new Error("Product not found.");
    if (store.products.some((item) =>
      item.id !== productId && item.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )) {
      throw new Error("A product with this name already exists. Use the existing catalog record.");
    }
    Object.assign(product, input, {
      defaultSellPrice: calculateCommercialSellingPrice(input.defaultBuyPrice),
      priceRuleVersion: (product.priceRuleVersion ?? 0) + 1,
    });
    return;
  }

  await withAuditTransaction({ actor, reason: "Product details updated" }, async (client) => {
    const existing = await client.query("SELECT 1 FROM products WHERE id=$1 FOR UPDATE", [productId]);
    if (!existing.rowCount) throw new Error("Product not found.");

    await client.query("SELECT pg_advisory_xact_lock(hashtext(lower(btrim($1))))", [input.name]);
    const duplicate = await client.query(
      "SELECT 1 FROM products WHERE id<>$1 AND lower(btrim(name))=lower(btrim($2)) LIMIT 1",
      [productId, input.name],
    );
    if (duplicate.rowCount) {
      throw new Error("A product with this name already exists. Use the existing catalog record.");
    }

    await client.query(
      `UPDATE products SET
         name=$2, category=$3, subcategory=$4, brand=$5, product_size=$6,
         unit_of_measure=$7, packaging=$8, description=$9,
         default_buy_price=$10, default_sell_price=$11,
         minimum_order_quantity=1, maximum_order_quantity=NULL,
         order_increment=1, pack_size=1, pack_unit=$7,
         delivery_sla_days=$12, updated_at=now()
       WHERE id=$1`,
      [productId, input.name, input.category, input.subcategory, input.brand ?? null, input.size ?? null,
        input.unit, input.packaging ?? null, input.description ?? null, input.defaultBuyPrice,
        calculateCommercialSellingPrice(input.defaultBuyPrice), input.deliverySlaDays],
    );

  });
}

import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";
import { canAccess } from "./permissions";
import { calculateCommercialSellingPrice, withDemoCommercialDefaults } from "./procurement-rules";

export interface ProductInput {
  name: string; category: string; subcategory: string; brand?: string; size?: string;
  unit: string; packaging?: string; description?: string; defaultBuyPrice: number;
  defaultSellPrice: number; minimumOrderQuantity: number; maximumOrderQuantity?: number;
  orderIncrement?: number; packSize?: number; packUnit?: string;
  quantityRuleEffectiveFrom?: string; quantityRuleReason?: string;
  deliverySlaDays: number; preferredSupplierId?: string;
}

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
    const supplier = input.preferredSupplierId
      ? store.suppliers.find((item) => item.id === input.preferredSupplierId && item.status === "Active")
      : undefined;
    if (input.preferredSupplierId && !supplier) throw new Error("The preferred supplier must be active.");
    Object.assign(product, input, {
      defaultSellPrice: calculateCommercialSellingPrice(input.defaultBuyPrice),
      preferredSupplierName: supplier?.name,
      priceRuleVersion: (product.priceRuleVersion ?? 0) + 1,
      quantityRuleVersion: (product.quantityRuleVersion ?? 0) + 1,
    });
    return;
  }

  await withAuditTransaction({ actor, reason: "Product details updated" }, async (client) => {
    const existing = await client.query("SELECT 1 FROM products WHERE id=$1 FOR UPDATE", [productId]);
    if (!existing.rowCount) throw new Error("Product not found.");

    if (input.preferredSupplierId) {
      const supplier = await client.query(
        "SELECT 1 FROM suppliers WHERE id=$1 AND active=true AND company_id IS NULL",
        [input.preferredSupplierId],
      );
      if (!supplier.rowCount) throw new Error("The preferred supplier must be active.");
    }

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
         minimum_order_quantity=$12, delivery_sla_days=$13, updated_at=now()
       WHERE id=$1`,
      [productId, input.name, input.category, input.subcategory, input.brand ?? null, input.size ?? null,
        input.unit, input.packaging ?? null, input.description ?? null, input.defaultBuyPrice,
        calculateCommercialSellingPrice(input.defaultBuyPrice), input.minimumOrderQuantity, input.deliverySlaDays],
    );

    await client.query(
      "UPDATE product_suppliers SET preferred=false WHERE product_id=$1 AND preferred=true",
      [productId],
    );
    if (input.preferredSupplierId) {
      await client.query(
        `INSERT INTO product_suppliers
           (product_id,supplier_id,preferred,indicative_buy_price,supplier_moq,
            maximum_order_quantity,order_increment,pack_size,pack_unit,
            quantity_rule_effective_from,quantity_rule_reason,quantity_rule_updated_by,
            lead_time_days,active)
         VALUES ($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true)
         ON CONFLICT(product_id,supplier_id) DO UPDATE SET
           preferred=true,
           indicative_buy_price=EXCLUDED.indicative_buy_price,
           supplier_moq=EXCLUDED.supplier_moq,
           maximum_order_quantity=EXCLUDED.maximum_order_quantity,
           order_increment=EXCLUDED.order_increment,
           pack_size=EXCLUDED.pack_size,
           pack_unit=EXCLUDED.pack_unit,
           quantity_rule_effective_from=EXCLUDED.quantity_rule_effective_from,
           quantity_rule_effective_to=NULL,
           quantity_rule_reason=EXCLUDED.quantity_rule_reason,
           quantity_rule_updated_by=EXCLUDED.quantity_rule_updated_by,
           lead_time_days=EXCLUDED.lead_time_days,
           active=true`,
        [productId, input.preferredSupplierId, input.defaultBuyPrice,
          input.minimumOrderQuantity, input.maximumOrderQuantity ?? null,
          input.orderIncrement ?? 1, input.packSize ?? 1, input.packUnit ?? input.unit,
          input.quantityRuleEffectiveFrom ?? new Date().toISOString(),
          input.quantityRuleReason ?? "Product commercial setup", actor.id, input.deliverySlaDays],
      );
    }
  });
}

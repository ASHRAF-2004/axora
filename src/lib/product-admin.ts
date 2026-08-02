import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";
import type { Product } from "./types";
import { canAccess } from "./permissions";

export type ProductInput = Omit<
  Product,
  | "id"
  | "code"
  | "status"
  | "duplicateWarning"
  | "preferredSupplierName"
  | "companyId"
  | "companyName"
  | "hasImage"
  | "imageAltText"
  | "images"
>;

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
    Object.assign(product, input, { preferredSupplierName: supplier?.name });
    return;
  }

  await withAuditTransaction({ userId: actor.id, reason: "Product details updated" }, async (client) => {
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
        input.defaultSellPrice, input.minimumOrderQuantity, input.deliverySlaDays],
    );

    await client.query(
      "UPDATE product_suppliers SET preferred=false WHERE product_id=$1 AND preferred=true",
      [productId],
    );
    if (input.preferredSupplierId) {
      await client.query(
        `INSERT INTO product_suppliers
           (product_id,supplier_id,preferred,indicative_buy_price,supplier_moq,lead_time_days,active)
         VALUES ($1,$2,true,$3,$4,$5,true)
         ON CONFLICT(product_id,supplier_id) DO UPDATE SET
           preferred=true,
           indicative_buy_price=EXCLUDED.indicative_buy_price,
           supplier_moq=EXCLUDED.supplier_moq,
           lead_time_days=EXCLUDED.lead_time_days,
           active=true`,
        [productId, input.preferredSupplierId, input.defaultBuyPrice,
          input.minimumOrderQuantity, input.deliverySlaDays],
      );
    }
  });
}

import type { AuthenticatedSessionUser } from "./auth";
import { authorize } from "./authorization-policy";
import { getDemoStore } from "./demo-data";
import { isDemoMode, withAuditTransaction } from "./db";
import { loadEffectiveAccess } from "./effective-access";

export type ProductDeletionErrorCode = "FORBIDDEN" | "PURCHASE_HISTORY" | "CART" | "DRAFT" | "PROTECTED";

export class ProductDeletionError extends Error {
  constructor(public readonly code: ProductDeletionErrorCode) {
    super(code);
    this.name = "ProductDeletionError";
  }
}

function protectedReferenceError(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)
    || !["23503", "23001"].includes(String(error.code))) return undefined;
  const constraint = "constraint" in error ? String(error.constraint) : "";
  if (constraint === "procurement_cart_items_product_id_fkey") return new ProductDeletionError("CART");
  if (constraint === "integration_request_draft_items_product_id_fkey") return new ProductDeletionError("DRAFT");
  if (constraint === "request_lines_product_id_fkey" || /^request_actual_lines_(estimated|actual)_product_id_fkey$/.test(constraint)) {
    return new ProductDeletionError("PURCHASE_HISTORY");
  }
  return new ProductDeletionError("PROTECTED");
}

export function canPermanentlyDeleteProduct(usageCount: number) {
  return usageCount === 0;
}

export async function deleteProduct(productId: string, actor: AuthenticatedSessionUser) {
  if (!actor.isOwner || actor.accountKind !== "PLATFORM" || actor.scopeType !== "PLATFORM"
    || !["PLATFORM_OWNER", "ADMIN"].includes(actor.role)) {
    throw new ProductDeletionError("FORBIDDEN");
  }
  if (isDemoMode()) {
    const { subject } = await loadEffectiveAccess(actor);
    if (!(["product.manage", "product.archive"] as const).every((permission) => authorize({
      subject, permission, resource: { scope: { type: "PLATFORM" } },
    }).allowed)) throw new ProductDeletionError("FORBIDDEN");
    const store = getDemoStore();
    const productIndex = store.products.findIndex((product) => product.id === productId);
    if (productIndex < 0) return;

    const usageCount = store.requests.reduce(
      (count, request) => count + request.lines.filter((line) => line.productId === productId).length,
      0,
    );
    if (!canPermanentlyDeleteProduct(usageCount)) {
      throw new ProductDeletionError("PURCHASE_HISTORY");
    }

    store.products.splice(productIndex, 1);
    return;
  }

  if (!actor.roleAssignmentId) throw new ProductDeletionError("FORBIDDEN");
  try {
    await withAuditTransaction(
      { actor, reason: "Product permanently deleted" },
      async (client) => {
        const result = await client.query<{ result: string }>(
          "SELECT public.axora_delete_product($1,$2,$3,$4) AS result",
          [actor.id, actor.roleAssignmentId, actor.authVersion, productId],
        );
        const code = result.rows[0]?.result;
        if (code === "DELETED" || code === "ALREADY_DELETED") return;
        if (code && ["FORBIDDEN", "PURCHASE_HISTORY", "CART", "DRAFT", "PROTECTED"].includes(code)) {
          throw new ProductDeletionError(code as ProductDeletionErrorCode);
        }
        throw new Error("Product deletion is unavailable.");
      },
    );
  } catch (error) {
    // Cart, integration-draft and actual-purchase references are deliberately
    // private to their capabilities. Their existing foreign keys arbitrate
    // concurrent writes and roll back supplier/image removal atomically. Only
    // translate the safe reason after withAuditTransaction has rolled back.
    throw protectedReferenceError(error) ?? error;
  }
}

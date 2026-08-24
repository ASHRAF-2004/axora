import { CartReview } from "@/components/CartReview";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { cartMessages } from "@/lib/cart-i18n";
import { commandProcurementCart } from "@/lib/procurement-cart";
import { SHOPPING_BRANCH_COOKIE, loadShoppingBranchContexts, resolveShoppingBranch } from "@/lib/shopping-context";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CartPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const actor = await requirePagePermission("create_requests");
  const locale = actor.preferredLocale ?? "en";
  const copy = cartMessages(locale);
  const [params, contexts, cookieStore] = await Promise.all([
    searchParams, loadShoppingBranchContexts(actor), cookies(),
  ]);
  if (actor.branchId && params.branch !== actor.branchId) {
    redirect(`/cart?branch=${encodeURIComponent(actor.branchId)}`);
  }
  const branch = resolveShoppingBranch(actor, contexts, params.branch ?? cookieStore.get(SHOPPING_BRANCH_COOKIE)?.value);
  if (!branch?.ready) redirect("/products?notice=shopping-branch-required");
  const cart = await commandProcurementCart(actor, { branchId: branch.id, operation: "READ" });
  return <><PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} /><CartReview initialCart={cart} branch={branch} locale={locale} /></>;
}

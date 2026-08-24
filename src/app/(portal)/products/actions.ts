"use server";

import { requirePermission } from "@/lib/auth";
import {
  SHOPPING_BRANCH_COOKIE,
  loadShoppingBranchContexts,
  shoppingContextInternals,
} from "@/lib/shopping-context";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function selectShoppingBranchAction(formData: FormData) {
  const actor = await requirePermission("view_catalog");
  const parsed = shoppingContextInternals.branchIdentifier.safeParse(
    String(formData.get("branchId") ?? ""),
  );
  const contexts = await loadShoppingBranchContexts(actor);
  const selected = parsed.success
    ? contexts.find((branch) => branch.id === parsed.data && branch.ready)
    : undefined;
  if (!selected) redirect("/products?notice=shopping-branch-invalid");

  (await cookies()).set(SHOPPING_BRANCH_COOKIE, selected.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  redirect(`/products?branch=${encodeURIComponent(selected.id)}`);
}

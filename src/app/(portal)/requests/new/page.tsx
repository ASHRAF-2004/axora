import { PageHeader } from "@/components/PageHeader";
import { RequestDraftBoundary } from "@/components/RequestDraftBoundary";
import { RequestForm } from "@/components/RequestForm";
import { getRequestBudgetChoices } from "@/lib/budget-ledger";
import { requirePagePermission } from "@/lib/auth";
import { getCustomerCatalogProductByPublicRef } from "@/lib/catalog";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { STANDARD_BILLING_TERMS, type Branch, type Company } from "@/lib/types";
import { commandProcurementCart } from "@/lib/procurement-cart";
import { redirect } from "next/navigation";
import { requestSubmitMessage } from "@/lib/request-submit-i18n";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; branch?: string; notice?: string }>;
}) {
  const actor = await requirePagePermission("create_requests");
  const budgetChoices = await getRequestBudgetChoices(actor);
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).requests;
  const params = await searchParams;
  const notice = requestSubmitMessage(locale, params.notice);

  const [organization, initialProduct] = await Promise.all([
    loadOrganizationDirectory(actor),
    params.product
      ? getCustomerCatalogProductByPublicRef(params.product, actor)
      : Promise.resolve(undefined),
  ]);
  const companies: Company[] = organization.companies.map((company) => ({
    ...company,
    paymentTerms: STANDARD_BILLING_TERMS,
  }));
  const branches: Branch[] = organization.branches.map((branch) => ({
    ...branch,
    committedAmount: branch.committedAmount ?? 0,
  }));
  const companyId = actor.companyId ?? companies[0]?.id;
  const branchId = actor.branchId ?? params.branch
    ?? branches.find((branch) => branch.status === "Active")?.id;
  if (!branchId) redirect("/products?notice=purchasing-scope-required");
  let initialCart;
  try {
    initialCart = await commandProcurementCart(actor, {
      branchId, operation: "READ",
    });
    if (initialProduct
      && !initialCart.items.some((item) => item.publicRef === initialProduct.publicRef)) {
      initialCart = await commandProcurementCart(actor, {
        branchId, operation: "ADD", productRef: initialProduct.publicRef,
        quantity: 1, expectedVersion: initialCart.version,
      });
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code) : "";
    redirect(code === "P8204"
      ? "/cart?notice=cart-product-unavailable"
      : "/products?notice=purchasing-scope-required");
  }
  const draftScope = {
    userId: actor.id,
    ...(companyId ? { companyId } : {}),
  };

  return (
    <>
      <PageHeader
        eyebrow={copy.newEyebrow}
        title={copy.newTitle}
        description={copy.newDescription}
      />
      {notice ? <div className="request-section-error" role="alert" aria-live="assertive">{notice}</div> : null}

      <RequestDraftBoundary scope={draftScope}>
      <RequestForm
        actor={actor}
        budgetAccounts={budgetChoices?.accounts ?? []}
          companies={companies}
          branches={branches}
          initialProduct={initialProduct}
          initialCart={initialCart}
          locale={locale}
        />
      </RequestDraftBoundary>
    </>
  );
}

import { PageHeader } from "@/components/PageHeader";
import { RequestDraftBoundary } from "@/components/RequestDraftBoundary";
import { RequestForm } from "@/components/RequestForm";
import { getRequestBudgetChoices } from "@/lib/budget-ledger";
import { requirePagePermission } from "@/lib/auth";
import { getCatalogProductById } from "@/lib/catalog";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { COD_PAYMENT_METHOD, type Branch, type Company } from "@/lib/types";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const actor = await requirePagePermission("create_requests");
  const budgetChoices = await getRequestBudgetChoices(actor);
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).requests;
  const params = await searchParams;

  const [organization, initialProduct] = await Promise.all([
    loadOrganizationDirectory(actor),
    params.product
      ? getCatalogProductById(params.product, actor)
      : Promise.resolve(undefined),
  ]);
  const companies: Company[] = organization.companies.map((company) => ({
    ...company,
    paymentTerms: COD_PAYMENT_METHOD,
  }));
  const branches: Branch[] = organization.branches.map((branch) => ({
    ...branch,
    committedAmount: branch.committedAmount ?? 0,
  }));
  const companyId = actor.companyId ?? companies[0]?.id;
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

      <RequestDraftBoundary scope={draftScope}>
      <RequestForm
        actor={actor}
        budgetAccounts={budgetChoices?.accounts ?? []}
          companies={companies}
          branches={branches}
          initialProduct={initialProduct}
          locale={locale}
        />
      </RequestDraftBoundary>
    </>
  );
}

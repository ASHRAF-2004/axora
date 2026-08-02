import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { requirePagePermission } from "@/lib/auth";
import { getCatalogProductById } from "@/lib/catalog";
import { listBranches, listCompanies } from "@/lib/repository";
import { corePortalMessages } from "@/lib/core-portal-i18n";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const actor = await requirePagePermission("create_requests");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).requests;
  const params = await searchParams;

  const [companies, branches, initialProduct] =
    await Promise.all([
      listCompanies(actor),
      listBranches(actor),
      params.product
        ? getCatalogProductById(params.product, actor)
        : Promise.resolve(undefined),
    ]);

  return (
    <>
      <PageHeader
        eyebrow={copy.newEyebrow}
        title={copy.newTitle}
        description={copy.newDescription}
      />

      <RequestForm
        actor={actor}
        companies={companies}
        branches={branches}
        initialProduct={initialProduct}
        locale={locale}
      />
    </>
  );
}

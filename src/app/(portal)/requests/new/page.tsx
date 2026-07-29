import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { requirePagePermission } from "@/lib/auth";
import { getCatalogProductById } from "@/lib/catalog";
import { listBranches, listCompanies } from "@/lib/repository";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const actor = await requirePagePermission("create_requests");
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
        eyebrow="Company procurement"
        title="Create purchase request"
        description="Review the products in your Shop cart, confirm quantities, and submit the request for company approval."
      />

      <RequestForm
        actor={actor}
        companies={companies}
        branches={branches}
        initialProduct={initialProduct}
      />
    </>
  );
}

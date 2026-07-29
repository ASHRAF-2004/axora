import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { requirePagePermission } from "@/lib/auth";
import {
  getCatalogProductById,
  searchCatalogProducts,
} from "@/lib/catalog";
import { listBranches, listCompanies } from "@/lib/repository";

export default async function NewRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const actor = await requirePagePermission("create_requests");
  const params = await searchParams;

  const [companies, branches, initialCatalog, initialProduct] =
    await Promise.all([
      listCompanies(actor),
      listBranches(actor),
      searchCatalogProducts({ page: 1, limit: 24 }, actor),
      params.product
        ? getCatalogProductById(params.product, actor)
        : Promise.resolve(undefined),
    ]);

  return (
    <>
      <PageHeader
        eyebrow="Company procurement"
        title="Create purchase request"
        description="Search the catalog, add products to your request cart, and submit them for company approval."
      />

      <RequestForm
        actor={actor}
        companies={companies}
        branches={branches}
        initialCatalog={initialCatalog}
        initialProduct={initialProduct}
      />
    </>
  );
}

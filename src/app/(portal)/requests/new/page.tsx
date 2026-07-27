import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { requirePagePermission } from "@/lib/auth";
import { listBranches, listCompanies, listProducts } from "@/lib/repository";

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const actor = await requirePagePermission("create_requests");
  const [companies, branches, products] = await Promise.all([listCompanies(), listBranches(), listProducts()]);
  return <><PageHeader eyebrow="Company procurement" title="Create purchase request" description="Choose catalog items and submit them to your branch approver. Your identity and company are recorded automatically." />
    <RequestForm actor={actor} companies={companies} branches={branches} products={products} initialProductId={(await searchParams).product} /></>;
}

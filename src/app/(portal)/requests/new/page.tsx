import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { requireRole } from "@/lib/auth";
import { listBranches, listCompanies, listProducts } from "@/lib/repository";

export default async function NewRequestPage() {
  await requireRole(["ADMIN", "OPERATIONS"]);
  const [companies, branches, products] = await Promise.all([listCompanies(), listBranches(), listProducts()]);
  return <><PageHeader eyebrow="Request intake" title="Create a multi-item request" description="Select approved master data. Financial totals are calculated automatically from quantity and unit prices." /><RequestForm companies={companies} branches={branches} products={products} /></>;
}

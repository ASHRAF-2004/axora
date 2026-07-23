import { PageHeader } from "@/components/PageHeader";
import { RequestForm } from "@/components/RequestForm";
import { listBranches, listCompanies, listProducts } from "@/lib/repository";

export default async function NewRequestPage() {
  const [companies, branches, products] = await Promise.all([listCompanies(), listBranches(), listProducts()]);
  return <><PageHeader eyebrow="Request intake" title="Create a multi-item request" description="Select approved master data. Each item receives a stable request-line ID and quantity-correct financial totals." /><RequestForm companies={companies} branches={branches} products={products} /></>;
}

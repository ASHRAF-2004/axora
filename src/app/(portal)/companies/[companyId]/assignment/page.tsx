import { permanentRedirect } from "next/navigation";

export default async function RetiredCompanyAssignmentPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  permanentRedirect(`/companies/${encodeURIComponent(companyId)}`);
}

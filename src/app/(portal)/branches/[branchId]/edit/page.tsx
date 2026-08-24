import { notFound } from "next/navigation";

import { BranchDetailsForm } from "@/components/BranchDetailsForm";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { branchDetailsMessages } from "@/lib/branch-details-i18n";
import { loadOrganizationDirectory } from "@/lib/organization-access";

export default async function EditBranchPage({ params }: {
  params: Promise<{ branchId: string }>;
}) {
  const actor = await requirePagePermission("manage_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = branchDetailsMessages(locale);
  const { branchId } = await params;
  const { branches } = await loadOrganizationDirectory(actor);
  const branch = branches.find((candidate) => candidate.id === branchId);
  if (!branch) notFound();

  return <>
    <PageHeader eyebrow={branch.name} title={copy.editTitle} description={copy.editBody} />
    <BranchDetailsForm branch={branch} locale={locale} />
  </>;
}

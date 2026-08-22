import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import Link from "next/link";
import { notFound } from "next/navigation";

const text = {
  en: { title: "Branches and delivery locations", body: "Manage the company’s branches and delivery addresses.", open: "Open branches" },
  ar: { title: "الفروع ومواقع التسليم", body: "أدر فروع الشركة وعناوين التسليم.", open: "فتح الفروع" },
  ms: { title: "Cawangan dan lokasi penghantaran", body: "Urus cawangan dan alamat penghantaran syarikat.", open: "Buka cawangan" },
} as const;

export default async function CompanyBranchesPage({ params }: { params: Promise<{ companyId: string }> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const { companyId } = await params;
  const company = findAuthorizedCompanyLifecycleRecord(await loadCompanyLifecycleWorkspace(actor), companyId);
  if (!company) notFound();
  const copy = text[locale];
  return <><PageHeader eyebrow={company.name} title={copy.title} description={copy.body} /><CompanyWorkspaceNav companyId={company.id} locale={locale} active="branches" /><section className="panel"><p>{copy.body}</p><Link className="button button-primary" href={`/branches?companyId=${encodeURIComponent(company.id)}`}>{copy.open}</Link></section></>;
}

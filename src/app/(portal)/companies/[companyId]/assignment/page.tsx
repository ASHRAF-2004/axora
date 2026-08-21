import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyManagerAssignmentWorkspace } from "@/components/CompanyManagerAssignmentWorkspace";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import {
  findAuthorizedCompanyLifecycleRecord,
  loadCompanyLifecycleWorkspace,
} from "@/lib/company-lifecycle";

const messages = {
  en: { eyebrow: "CAM assignment", title: "Client Account Manager handover", description: "Assign accountable company coverage without widening any other CAM's portfolio.", back: "Company overview", updated: "The company assignment and handover were updated." },
  ar: { eyebrow: "إسناد مدير الحساب", title: "تسليم مدير حساب العميل", description: "أسند تغطية الشركة المسؤولة دون توسيع نطاق أي مدير حساب آخر.", back: "نظرة عامة على الشركة", updated: "تم تحديث إسناد الشركة وتسليمها." },
  ms: { eyebrow: "Tugasan CAM", title: "Serahan Pengurus Akaun Pelanggan", description: "Tugaskan liputan syarikat yang bertanggungjawab tanpa meluaskan portfolio CAM lain.", back: "Gambaran keseluruhan syarikat", updated: "Tugasan dan serahan syarikat telah dikemas kini." },
} as const;

export default async function CompanyAssignmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_companies");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = messages[locale];
  const [{ companyId }, query, workspace] = await Promise.all([
    params,
    searchParams,
    loadCompanyLifecycleWorkspace(actor),
  ]);
  const company = findAuthorizedCompanyLifecycleRecord(workspace, companyId);
  if (!company || company.status === "ARCHIVED") notFound();
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={`${copy.title}: ${company.name}`} description={copy.description} />
    <div className="page-actions"><Link className="button button-secondary" href={`/companies/${company.id}`}>{copy.back}</Link></div>
    {query.notice === "company-assigned" ? <section className="panel" role="status"><strong>{copy.updated}</strong></section> : null}
    <CompanyManagerAssignmentWorkspace company={company} managers={workspace.managers} locale={locale} />
  </>;
}

import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { loadAuthorizedDocumentRegisters } from "@/lib/document-isolation";
import { canAccess } from "@/lib/permissions";
import Link from "next/link";
import { notFound } from "next/navigation";

const text = {
  en: { title: "Documents", body: "Business documents attached to this company’s authorized requests.", empty: "No company documents are available." },
  ar: { title: "المستندات", body: "مستندات الأعمال المرفقة بطلبات هذه الشركة المصرح بها.", empty: "لا توجد مستندات متاحة للشركة." },
  ms: { title: "Dokumen", body: "Dokumen perniagaan yang dilampirkan pada permintaan syarikat ini yang dibenarkan.", empty: "Tiada dokumen syarikat tersedia." },
} as const;

export default async function CompanyDocumentsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const { companyId } = await params;
  const workspace = await loadCompanyLifecycleWorkspace(actor);
  const company = findAuthorizedCompanyLifecycleRecord(workspace, companyId);
  if (!company) notFound();
  const registers = canAccess(actor, "view_documents")
    ? await loadAuthorizedDocumentRegisters(actor)
    : null;
  if (!registers) {
    const copy = text[locale];
    return <><PageHeader eyebrow={company.name} title={copy.title} description={copy.body} /><CompanyWorkspaceNav companyId={company.id} locale={locale} active="documents" /><section className="panel"><p>{copy.empty}</p></section></>;
  }
  const requestIds = new Set(registers.requests.filter((request) => request.companyId === company.id).map((request) => request.id));
  const invoiceIds = new Set(registers.invoices.filter((invoice) => requestIds.has(invoice.requestId)).map((invoice) => invoice.id));
  const requestLineIds = new Set(registers.requests.filter((request) => requestIds.has(request.id)).flatMap((request) => request.lines.map((line) => line.id)));
  const deliveryIds = new Set(registers.deliveries.filter((delivery) => requestLineIds.has(delivery.requestLineId)).map((delivery) => delivery.id));
  const documents = registers.attachments.filter((document) => (
    document.entityType === "request" ? requestIds.has(document.recordId)
      : document.entityType === "invoice" ? invoiceIds.has(document.recordId)
        : deliveryIds.has(document.recordId)
  )).slice(0, 50);
  const copy = text[locale];
  return <><PageHeader eyebrow={company.name} title={copy.title} description={copy.body} /><CompanyWorkspaceNav companyId={company.id} locale={locale} active="documents" /><section className="panel">{documents.length ? <ul>{documents.map((document) => <li key={document.id}><Link href={`/api/attachments/${document.id}`}><bdi dir="auto">{document.fileName}</bdi></Link></li>)}</ul> : <p>{copy.empty}</p>}</section></>;
}

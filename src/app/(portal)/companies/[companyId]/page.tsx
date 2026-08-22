import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { companyLifecycleMessages, companyLifecycleStatusLabel } from "@/lib/company-lifecycle-i18n";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { activateCompanyAction, inviteCompanyAdministratorAction, suspendCompanyAction } from "../../masters/actions";
import { deleteOrArchiveCompanyAction } from "../deletion-actions";

const text = {
  en: { created: "Company created. Continue setup to prepare the workspace.", details: "Company details", setup: "Continue setup", contact: "Main contact", industry: "Industry", website: "Website", actions: "Company actions", activate: "Activate company", suspend: "Suspend company", confirmSuspend: "Suspend this company?", remove: "Delete company", confirmRemove: "Delete this company?", admin: "Create Company Administrator", adminName: "Administrator name", adminEmail: "Administrator email", language: "Language", invite: "Send secure invitation", back: "Back to companies", unavailable: "Not provided" },
  ar: { created: "تم إنشاء الشركة. تابع الإعداد لتجهيز مساحة العمل.", details: "تفاصيل الشركة", setup: "متابعة الإعداد", contact: "جهة الاتصال الرئيسية", industry: "القطاع", website: "الموقع الإلكتروني", actions: "إجراءات الشركة", activate: "تفعيل الشركة", suspend: "تعليق الشركة", confirmSuspend: "تعليق هذه الشركة؟", remove: "حذف الشركة", confirmRemove: "حذف هذه الشركة؟", admin: "إنشاء مسؤول الشركة", adminName: "اسم المسؤول", adminEmail: "بريد المسؤول", language: "اللغة", invite: "إرسال دعوة آمنة", back: "العودة إلى الشركات", unavailable: "غير متوفر" },
  ms: { created: "Syarikat dicipta. Teruskan persediaan untuk menyediakan ruang kerja.", details: "Butiran syarikat", setup: "Teruskan persediaan", contact: "Hubungan utama", industry: "Industri", website: "Laman web", actions: "Tindakan syarikat", activate: "Aktifkan syarikat", suspend: "Gantung syarikat", confirmSuspend: "Gantung syarikat ini?", remove: "Padam syarikat", confirmRemove: "Padam syarikat ini?", admin: "Cipta Pentadbir Syarikat", adminName: "Nama pentadbir", adminEmail: "E-mel pentadbir", language: "Bahasa", invite: "Hantar jemputan selamat", back: "Kembali ke syarikat", unavailable: "Tidak diberikan" },
} as const;

export default async function CompanyOverviewPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const local = text[locale];
  const [{ companyId }, query, workspace] = await Promise.all([params, searchParams, loadCompanyLifecycleWorkspace(actor)]);
  const company = findAuthorizedCompanyLifecycleRecord(workspace, companyId);
  if (!company || company.status === "ARCHIVED") notFound();
  const actions = new Set(company.availableActions);
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={company.name} description={copy.description} />
    {query.notice === "company-created" ? <div className="form-success" role="status"><strong>{local.created}</strong></div> : null}
    <CompanyWorkspaceNav companyId={company.id} locale={locale} active="overview" />
    <section className="detail-grid">
      <article className="panel"><div className="panel-header"><div><h2>{local.details}</h2><p className="subtle">{company.code}</p></div><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></div><dl className="summary-list"><div><dt>{local.contact}</dt><dd>{company.mainContactName}</dd></div><div><dt>{local.industry}</dt><dd>{company.industry || local.unavailable}</dd></div><div><dt>{local.website}</dt><dd>{company.websiteUrl ?? local.unavailable}</dd></div></dl><Link className="button button-primary" href={`/companies/${company.id}/onboarding`}>{local.setup}</Link></article>
      <article className="panel form-panel"><h2>{local.admin}</h2>{actions.has("INVITE_ADMINISTRATOR") ? <form action={inviteCompanyAdministratorAction} className="form-grid"><input type="hidden" name="companyId" value={company.id} /><label>{local.adminName}<input name="displayName" defaultValue={company.mainContactName} required /></label><label>{local.adminEmail}<input name="email" type="email" required /></label><label>{local.language}<select name="preferredLocale" defaultValue={locale}><option value="en">English</option><option value="ar">العربية</option><option value="ms">Bahasa Melayu</option></select></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{local.invite}</button></div></form> : <p className="subtle">{companyLifecycleStatusLabel(locale, company.status)}</p>}</article>
    </section>
    {(actions.has("ACTIVATE") || actions.has("SUSPEND")) ? <section className="panel"><h2>{local.actions}</h2><div className="action-row">{actions.has("ACTIVATE") && !company.activationBlockedReasons.length ? <form action={activateCompanyAction}><input type="hidden" name="companyId" value={company.id} /><button className="button button-primary" type="submit">{local.activate}</button></form> : null}{actions.has("SUSPEND") ? <form action={suspendCompanyAction}><input type="hidden" name="companyId" value={company.id} /><button className="button button-secondary" type="submit" title={local.confirmSuspend}>{local.suspend}</button></form> : null}</div></section> : null}
    {actor.isOwner ? <details className="panel"><summary>{local.remove}</summary><form action={deleteOrArchiveCompanyAction.bind(null, company.id)} className="form-grid"><input type="hidden" name="commandId" value={randomUUID()} /><label className="field-full"><input name="confirmed" type="checkbox" value="confirmed" required /> {local.confirmRemove}</label><div className="form-actions field-full"><button className="button button-danger" type="submit">{local.remove}</button></div></form></details> : null}
    <div className="page-actions"><Link className="button button-secondary" href="/companies">{local.back}</Link></div>
  </>;
}

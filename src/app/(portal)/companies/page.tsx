import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { getCompanyDeletionCommandStatus } from "@/lib/company-deletion";
import {
  COMPANY_LIFECYCLE_STATUSES,
  loadCompanyLifecycleWorkspace,
  type CompanyLifecycleStatus,
} from "@/lib/company-lifecycle";
import {
  companyLifecycleMessages,
  companyLifecycleStatusLabel,
  companyLifecycleText,
} from "@/lib/company-lifecycle-i18n";

type SearchValue = string | string[] | undefined;
const first = (value: SearchValue) => Array.isArray(value) ? value[0] : value;
const LISTABLE_COMPANY_STATUSES = COMPANY_LIFECYCLE_STATUSES.filter(
  (item): item is Exclude<CompanyLifecycleStatus, "ARCHIVED"> => item !== "ARCHIVED",
);
const listCopy = {
  en: { search: "Search companies", company: "Company", open: "Open company", cleanupPending: "Company access is revoked and external file cleanup is still running.", cleanupFailed: "Company access is revoked, but external cleanup requires administrator attention.", cleanupComplete: "The company removal command completed.", pendingTasks: "Pending cleanup tasks", failedTasks: "Failed cleanup tasks" },
  ar: { search: "البحث في الشركات", company: "الشركة", open: "فتح الشركة", cleanupPending: "تم إلغاء وصول الشركة وما زالت إزالة الملفات الخارجية قيد التنفيذ.", cleanupFailed: "تم إلغاء وصول الشركة، لكن التنظيف الخارجي يحتاج إلى تدخل المسؤول.", cleanupComplete: "اكتمل أمر إزالة الشركة.", pendingTasks: "مهام التنظيف المعلقة", failedTasks: "مهام التنظيف الفاشلة" },
  ms: { search: "Cari syarikat", company: "Syarikat", open: "Buka syarikat", cleanupPending: "Akses syarikat telah dibatalkan dan pembersihan fail luaran masih berjalan.", cleanupFailed: "Akses syarikat telah dibatalkan, tetapi pembersihan luaran memerlukan perhatian pentadbir.", cleanupComplete: "Arahan penyingkiran syarikat telah selesai.", pendingTasks: "Tugas pembersihan belum selesai", failedTasks: "Tugas pembersihan gagal" },
} as const;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, SearchValue>> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const local = listCopy[locale];
  const [workspace, params] = await Promise.all([loadCompanyLifecycleWorkspace(actor), searchParams]);
  const rawStatus = first(params.status);
  const status = LISTABLE_COMPANY_STATUSES.includes(rawStatus as Exclude<CompanyLifecycleStatus, "ARCHIVED">)
    ? rawStatus as Exclude<CompanyLifecycleStatus, "ARCHIVED">
    : undefined;
  const query = (first(params.q) ?? "").trim().normalize("NFKC").slice(0, 100).toLocaleLowerCase(locale);
  const companies = workspace.companies.filter((company) => (
    (status ? company.status === status : company.status !== "ARCHIVED")
    && (!query || [company.name, company.code, company.industry, company.mainContactName].some((value) => value.toLocaleLowerCase(locale).includes(query)))
  ));
  const deletionCommandId = first(params.deletionCommand);
  const deletionCommand = actor.isOwner && deletionCommandId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deletionCommandId)
    ? await getCompanyDeletionCommandStatus(actor, deletionCommandId).catch(() => null)
    : null;
  const pendingTasks = deletionCommand?.tasks.filter((task) => ["PENDING", "LEASED", "RETRY_WAIT"].includes(task.status)).length ?? 0;
  const failedTasks = deletionCommand?.tasks.filter((task) => task.status === "TERMINAL_FAILED").length ?? 0;

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    {deletionCommand ? <section className="panel" role={deletionCommand.status === "FAILED" ? "alert" : "status"}>
      <strong>{deletionCommand.status === "FAILED" ? local.cleanupFailed : deletionCommand.status === "CLEANUP_PENDING" ? local.cleanupPending : local.cleanupComplete}</strong>
      <p className="subtle">{deletionCommand.companyCode}</p>
      {pendingTasks || failedTasks ? <dl className="summary-list"><div><dt>{local.pendingTasks}</dt><dd>{pendingTasks}</dd></div><div><dt>{local.failedTasks}</dt><dd>{failedTasks}</dd></div></dl> : null}
    </section> : null}
    <div className="page-actions">
      {workspace.canCreate ? <Link className="button button-primary" href="/companies/new">{copy.createTitle}</Link> : null}
    </div>
    <section className="panel">
      <div className="panel-header"><div><h2>{copy.register}</h2><p>{companyLifecycleText(locale, "count", { count: companies.length })}</p></div></div>
      <form method="get" className="form-grid" role="search">
        <label className="field-full">{local.search}<input name="q" defaultValue={first(params.q) ?? ""} maxLength={100} /></label>
        <label>{copy.status}<select name="status" defaultValue={status ?? ""}><option value="">{copy.allStatuses}</option>{LISTABLE_COMPANY_STATUSES.map((item) => <option key={item} value={item}>{companyLifecycleStatusLabel(locale, item)}</option>)}</select></label>
        <div className="form-actions field-full"><button className="button button-secondary" type="submit">{copy.filter}</button></div>
      </form>
      {companies.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{local.company}</th><th>{copy.status}</th><th>{copy.mainContact}</th><th /></tr></thead><tbody>
        {companies.map((company) => <tr key={company.id}><td><strong>{company.name}</strong>{company.industry ? <><br /><span className="subtle">{company.industry}</span></> : null}</td><td><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></td><td>{company.mainContactName}</td><td><Link className="button button-secondary" href={`/companies/${company.id}`}>{company.status === "ACTIVE" ? local.open : "Continue setup"}</Link></td></tr>)}
      </tbody></table></div> : <p>{copy.noCompanies}</p>}
    </section>
  </>;
}

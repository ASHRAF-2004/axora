import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { companyLeadMessages } from "@/lib/company-leads-i18n";
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
  en: { search: "Search companies", company: "Company", open: "Open company" },
  ar: { search: "البحث في الشركات", company: "الشركة", open: "فتح الشركة" },
  ms: { search: "Cari syarikat", company: "Syarikat", open: "Buka syarikat" },
} as const;

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, SearchValue>> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const local = listCopy[locale];
  const leadCopy = companyLeadMessages(locale);
  const [workspace, params] = await Promise.all([loadCompanyLifecycleWorkspace(actor), searchParams]);
  const rawStatus = first(params.status);
  const status = LISTABLE_COMPANY_STATUSES.includes(rawStatus as Exclude<CompanyLifecycleStatus, "ARCHIVED">)
    ? rawStatus as Exclude<CompanyLifecycleStatus, "ARCHIVED">
    : undefined;
  const view = first(params.view) === "mine" ? "mine" : "all";
  const query = (first(params.q) ?? "").trim().normalize("NFKC").slice(0, 100).toLocaleLowerCase(locale);
  const companies = workspace.companies.filter((company) => (
    (status ? company.status === status : company.status !== "ARCHIVED")
    && (view !== "mine" || company.isAssignedToActor)
    && (!query || [company.name, company.code, company.industry, company.mainContactName].some((value) => value.toLocaleLowerCase(locale).includes(query)))
  ));

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <div className="page-actions">
      <Link className="button button-secondary" href="/companies/leads">{leadCopy.queueTitle}</Link>
      {workspace.canCreate ? <Link className="button button-primary" href="/companies/new">{copy.createTitle}</Link> : null}
    </div>
    <section className="panel">
      <div className="panel-header"><div><h2>{copy.register}</h2><p>{companyLifecycleText(locale, "count", { count: companies.length })}</p></div></div>
      <form method="get" className="form-grid" role="search">
        <label className="field-full">{local.search}<input name="q" defaultValue={first(params.q) ?? ""} maxLength={100} /></label>
        {workspace.canViewAll ? <label>{copy.allCompanies}<select name="view" defaultValue={view}><option value="all">{copy.allCompanies}</option><option value="mine">{copy.myCompanies}</option></select></label> : <input type="hidden" name="view" value="mine" />}
        <label>{copy.status}<select name="status" defaultValue={status ?? ""}><option value="">{copy.allStatuses}</option>{LISTABLE_COMPANY_STATUSES.map((item) => <option key={item} value={item}>{companyLifecycleStatusLabel(locale, item)}</option>)}</select></label>
        <div className="form-actions field-full"><button className="button button-secondary" type="submit">{copy.filter}</button></div>
      </form>
      {companies.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{local.company}</th><th>{copy.status}</th><th>{copy.mainContact}</th><th>{copy.assignment}</th><th /></tr></thead><tbody>
        {companies.map((company) => <tr key={company.id}><td><strong>{company.name}</strong><br /><span className="subtle">{company.industry}</span></td><td><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></td><td>{company.mainContactName}<br /><span className="subtle">{company.mainContactEmail}</span></td><td>{company.primaryManager?.name ?? copy.unassigned}</td><td><Link className="button button-secondary" href={`/companies/${company.id}`}>{local.open}</Link></td></tr>)}
      </tbody></table></div> : <p>{copy.noCompanies}</p>}
    </section>
  </>;
}

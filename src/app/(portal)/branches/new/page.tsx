import Link from "next/link";

import { BranchCreateForm } from "@/components/BranchCreateForm";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { loadOrganizationDirectory } from "@/lib/organization-access";

export default async function NewBranchPage({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const actor = await requirePagePermission("manage_branches");
  const locale = actor.preferredLocale ?? "en";
  const portalCopy = corePortalMessages(locale);
  const copy = portalCopy.branches;
  const directory = await loadOrganizationDirectory(actor);
  const requestedCompanyId = (await searchParams).companyId;
  const companyId = actor.accountKind === "COMPANY" ? actor.companyId : requestedCompanyId;
  const company = directory.companies.find((candidate) => candidate.id === companyId && candidate.status === "Active");

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.createTitle} description={copy.createBody} />
    {actor.accountKind === "PLATFORM" && !company ? <section className="panel form-panel">
      <form method="get">
        <label>{copy.selectCompany}<select name="companyId" required defaultValue="">
          <option value="" disabled>{copy.selectCompany}</option>
          {directory.companies.filter((candidate) => candidate.status === "Active").map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select></label>
        <div className="form-actions"><Link className="button button-secondary" href="/branches">{portalCopy.common.back}</Link><button className="button button-primary" type="submit">{portalCopy.common.continue}</button></div>
      </form>
    </section> : company ? <BranchCreateForm companyId={company.id} companyName={company.name} locale={locale} showCompany={actor.accountKind === "PLATFORM"} />
      : <section className="panel"><p className="callout">{portalCopy.common.companyUnavailable}</p></section>}
  </>;
}

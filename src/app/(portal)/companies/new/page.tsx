import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { companyLifecycleMessages } from "@/lib/company-lifecycle-i18n";
import { createCompanyAction } from "../../masters/actions";

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("create_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const query = await searchParams;
  const commandId = randomUUID();
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.createTitle} description={copy.createIntro} />
    {query.notice === "company-command-conflict" ? <section className="panel" role="alert"><strong>{copy.creationCommandConflict}</strong></section> : null}
    <form action={createCompanyAction} className="panel form-panel">
      <input type="hidden" name="commandId" value={commandId} />
      <div className="form-grid">
        <label>{copy.displayName}<input name="name" required maxLength={300} /></label>
        <label>{copy.mainContact}<input name="mainContactName" required maxLength={300} /></label>
        <label>{copy.legalName}<input name="legalName" maxLength={300} /></label>
        <label>{copy.industry}<input name="industry" maxLength={300} /></label>
        <label>{copy.website}<input name="websiteUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" /></label>
        <label className="field-full">{copy.logo}<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" /><small>{copy.logoHelp}</small></label>
      </div>
      <div className="form-actions"><Link className="button button-secondary" href="/companies">{copy.back}</Link><button className="button button-primary" type="submit">{copy.submit}</button></div>
    </form>
  </>;
}

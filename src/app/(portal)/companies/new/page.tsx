import { randomUUID } from "node:crypto";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { companyLifecycleMessages } from "@/lib/company-lifecycle-i18n";
import { notFound } from "next/navigation";
import { createCompanyAction } from "../../masters/actions";

export default async function NewCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_companies");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
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
        <label>{copy.legalName}<input name="legalName" required maxLength={300} /></label>
        <label>{copy.industry}<input name="industry" required maxLength={300} /></label>
        <label>{copy.website}<input name="websiteUrl" type="url" inputMode="url" maxLength={500} placeholder="https://" /></label>
        <label className="field-full">{copy.companyInformation}<textarea name="companyInformation" required maxLength={3000} /></label>
        <label className="field-full">{copy.logo}<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /><small>{copy.logoHelp}</small></label>
        <label>{copy.mainContact}<input name="mainContactName" required /></label>
        <label>{copy.billingCycle}<select name="billingCycle"><option value="Monthly">{copy.monthly}</option><option value="Per order">{copy.perOrder}</option><option value="Weekly">{copy.weekly}</option></select></label>
        <label className="field-full">{copy.notes}<textarea name="notes" maxLength={1000} /></label>
      </div>
      <div className="form-actions"><Link className="button button-secondary" href="/companies">Back</Link><button className="button button-primary" type="submit">{copy.submit}</button></div>
    </form>
  </>;
}

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { companyLifecycleMessages } from "@/lib/company-lifecycle-i18n";
import { createCompanyAction } from "../../masters/actions";

export default async function NewCompanyPage() {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.createTitle} description={copy.createIntro} />
    <form action={createCompanyAction} className="panel form-panel">
      <div className="form-grid">
        <label>{copy.displayName}<input name="name" required maxLength={300} /></label>
        <label>{copy.industry}<input name="industry" required maxLength={300} /></label>
        <label className="field-full">{copy.companyInformation}<textarea name="companyInformation" required maxLength={3000} /></label>
        <label className="field-full">{copy.logo}<input name="logo" type="file" accept="image/png,image/jpeg,image/webp" required /><small>{copy.logoHelp}</small></label>
        <label>{copy.mainContact}<input name="mainContactName" required /></label>
        <label>{copy.mainEmail}<input name="mainContactEmail" type="email" required /></label>
        <label>{copy.mainPhone}<input name="mainContactPhone" required /></label>
        <label>{copy.billingCycle}<select name="billingCycle"><option value="Monthly">{copy.monthly}</option><option value="Per order">{copy.perOrder}</option><option value="Weekly">{copy.weekly}</option></select></label>
      </div>
      <div className="form-actions"><Link className="button button-secondary" href="/companies">Back</Link><button className="button button-primary" type="submit">{copy.submit}</button></div>
    </form>
  </>;
}

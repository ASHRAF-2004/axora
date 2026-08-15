import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { createBranchAction } from "../../masters/actions";

export default async function NewBranchPage() {
  const actor = await requirePagePermission("manage_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const { companies } = await loadOrganizationDirectory(actor);
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.createTitle} description={copy.createBody} />
    <section className="panel form-panel">
      <form action={createBranchAction}><div className="form-grid">
        <label className="field-full">Company<select name="companyId" required defaultValue={actor.companyId ?? ""}>
          <option value="" disabled>{copy.selectCompany}</option>{companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select></label>
        <label className="field-full">{copy.branchName}<input name="name" required /></label>
        <label>{copy.shortCode}<input name="branchCode" placeholder="KL-HQ" required /></label>
        <label>{copy.city}<input name="city" required /></label>
        <label className="field-full">{copy.address}<textarea name="deliveryAddress" required /></label>
        <label>{copy.contactName}<input name="contactName" required /></label><label>{copy.contactPhone}<input name="contactPhone" required /></label>
        <label className="field-full">{copy.contactEmail}<input name="contactEmail" type="email" /></label>
        <label className="field-full">{copy.instructions}<textarea name="deliveryInstructions" /></label>
        <label className="field-full">{copy.notes}<textarea name="notes" /></label>
      </div><div className="form-actions"><Link className="button button-secondary" href="/branches">Back</Link><button className="button button-primary" type="submit">{copy.create}</button></div></form>
    </section>
  </>;
}

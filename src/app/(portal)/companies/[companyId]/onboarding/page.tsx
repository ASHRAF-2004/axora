import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import {
  COMPANY_ONBOARDING_STEPS,
  CompanyOnboardingUnavailableError,
  loadCompanyOnboardingWorkspace,
} from "@/lib/company-onboarding";
import {
  companyOnboardingBlockerLabel,
  companyOnboardingMessages,
  companyOnboardingStepLabel,
} from "@/lib/company-onboarding-i18n";
import { formatDateTime } from "@/lib/domain";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  saveCompanyOnboardingAction,
  updateCompanyOnboardingItemAction,
  verifyCompanyOnboardingAction,
} from "./actions";

const TIMEZONES = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Jakarta",
  "Asia/Manila",
  "UTC",
] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompanyOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyOnboardingMessages(locale);
  const [{ companyId }, query] = await Promise.all([params, searchParams]);
  let workspace: Awaited<ReturnType<typeof loadCompanyOnboardingWorkspace>>;
  try {
    workspace = await loadCompanyOnboardingWorkspace(actor, companyId);
  } catch (error) {
    if (error instanceof CompanyOnboardingUnavailableError) notFound();
    throw error;
  }
  const company = workspace.company;
  const notice = first(query.notice) === "saved" ? copy.saved
    : first(query.notice) === "item-saved" ? copy.itemSaved
      : first(query.notice) === "verified" ? copy.verified : undefined;
  const industryName = (industry: typeof workspace.industries[number]) => locale === "ar"
    ? industry.nameAr : locale === "ms" ? industry.nameMs : industry.nameEn;
  const statusLabel = (status: typeof workspace.items[number]["status"]) => status === "PASSED"
    ? copy.passed : status === "FAILED" ? copy.failed : status === "WAIVED" ? copy.waived : copy.pending;
  const verificationReady = company.activationBlockers.every(
    (blocker) => blocker === "ONBOARDING_VERIFICATION",
  );

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={`${copy.title}: ${company.name}`} description={copy.description} />
    <div className="action-row" style={{ marginBlockEnd: 16 }}>
      <Link className="button button-secondary" href="/companies">{copy.back}</Link>
      <StatusBadge>{company.verificationStatus.replaceAll("_", " ")}</StatusBadge>
    </div>
    {notice ? <section className="panel" role="status" aria-live="polite"><strong>{notice}</strong></section> : null}

    <section className="panel form-panel" style={{ marginBlockStart: 16 }}>
      <div className="panel-header"><div><h2>{copy.profile}</h2><p>{copy.profileHelp}</p></div><span className="subtle">{company.code} · v{company.version}</span></div>
      <form action={saveCompanyOnboardingAction}>
        <input type="hidden" name="companyId" value={company.id} />
        <input type="hidden" name="expectedVersion" value={company.version} />
        <div className="form-grid">
          <label>{copy.legalName}<input name="legalName" defaultValue={company.legalName} required maxLength={300} disabled={!workspace.canEdit} /></label>
          <label>{copy.registrationNumber}<input name="registrationNumber" defaultValue={company.registrationNumber} required maxLength={160} disabled={!workspace.canEdit} /></label>
          <label>{copy.registrationCountry}<input name="registrationCountryCode" defaultValue={company.registrationCountryCode} required pattern="[A-Za-z]{2}" maxLength={2} disabled={!workspace.canEdit} /></label>
          <label>{copy.taxNumber}<input name="taxRegistrationNumber" defaultValue={company.taxRegistrationNumber} maxLength={160} disabled={!workspace.canEdit} /></label>
          <label>{copy.industry}<select name="industryCode" defaultValue={company.industryCode} disabled={!workspace.canEdit}>{workspace.industries.map((industry) => <option key={industry.code} value={industry.code}>{industryName(industry)}</option>)}</select></label>
          <label>{copy.industryOther}<input name="industryOtherText" defaultValue={company.industryOtherText} maxLength={300} disabled={!workspace.canEdit} /></label>
          <label className="field-full">{copy.registeredAddress}<textarea name="registeredAddress" defaultValue={company.registeredAddress} required maxLength={5000} disabled={!workspace.canEdit} /></label>
          <label className="field-full">{copy.operatingAddress}<textarea name="operatingAddress" defaultValue={company.operatingAddress} required maxLength={5000} disabled={!workspace.canEdit} /></label>
          <label>{copy.mainContactName}<input name="mainContactName" defaultValue={company.mainContactName} required disabled={!workspace.canEdit} /></label>
          <label>{copy.mainContactEmail}<input name="mainContactEmail" type="email" defaultValue={company.mainContactEmail} required disabled={!workspace.canEdit} /></label>
          <label>{copy.mainContactPhone}<input name="mainContactPhone" defaultValue={company.mainContactPhone} required disabled={!workspace.canEdit} /></label>
          <label>{copy.billingContactName}<input name="billingContactName" defaultValue={company.billingContactName} disabled={!workspace.canEdit} /></label>
          <label>{copy.billingContactEmail}<input name="billingContactEmail" type="email" defaultValue={company.billingContactEmail} disabled={!workspace.canEdit} /></label>
          <label>{copy.billingContactPhone}<input name="billingContactPhone" defaultValue={company.billingContactPhone} disabled={!workspace.canEdit} /></label>
          <label className="field-full">{copy.billingAddress}<textarea name="billingAddress" defaultValue={company.billingAddress} required disabled={!workspace.canEdit} /></label>
          <label>{copy.billingCycle}<input name="billingCycle" defaultValue={company.billingCycle} required disabled={!workspace.canEdit} /></label>
          <label>{copy.locale}<select name="defaultLocale" defaultValue={company.defaultLocale} disabled={!workspace.canEdit}><option value="en">{copy.english}</option><option value="ar">{copy.arabic}</option><option value="ms">{copy.malay}</option></select></label>
          <label>{copy.timezone}<select name="timezone" defaultValue={company.timezone} disabled={!workspace.canEdit}>{!TIMEZONES.includes(company.timezone as typeof TIMEZONES[number]) ? <option value={company.timezone}>{company.timezone}</option> : null}{TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}</select></label>
          <label>{copy.currentStep}<select name="currentStep" defaultValue={company.currentStep} disabled={!workspace.canEdit}>{COMPANY_ONBOARDING_STEPS.map((step) => <option key={step} value={step}>{companyOnboardingStepLabel(locale, step)}</option>)}</select></label>
          <fieldset className="field-full"><legend>{copy.completedSteps}</legend><div className="action-row">{COMPANY_ONBOARDING_STEPS.map((step) => <label key={step}><input type="checkbox" name="completedSteps" value={step} defaultChecked={company.completedSteps.includes(step)} disabled={!workspace.canEdit} /> {companyOnboardingStepLabel(locale, step)}</label>)}</div></fieldset>
          <label className="field-full">{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} disabled={!workspace.canEdit} /></label>
        </div>
        {workspace.canEdit ? <div className="form-actions"><button className="button button-primary" type="submit">{copy.save}</button></div> : null}
      </form>
    </section>

    <section style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.checklist}</h2><p>{copy.checklistHelp}</p></div></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 16 }}>
        {workspace.items.map((item) => <article className="panel form-panel" key={item.id}>
          <div className="panel-header"><div><h3>{companyOnboardingBlockerLabel(locale, item.code)}</h3><p>{item.description}</p></div><StatusBadge>{statusLabel(item.status)}</StatusBadge></div>
          <p className="subtle">{item.required ? copy.required : copy.optional}{item.completedAt ? ` · ${copy.completedAt}: ${formatDateTime(item.completedAt.toISOString(), locale, company.timezone)}` : ""}</p>
          {workspace.canEdit ? <form action={updateCompanyOnboardingItemAction} className="form-grid">
            <input type="hidden" name="companyId" value={company.id} />
            <input type="hidden" name="expectedVersion" value={company.version} />
            <input type="hidden" name="itemCode" value={item.code} />
            <label>{copy.status}<select name="status" defaultValue={item.status}><option value="PENDING">{copy.pending}</option><option value="PASSED">{copy.passed}</option><option value="FAILED">{copy.failed}</option>{workspace.canApproveExceptions ? <option value="WAIVED">{copy.waived}</option> : null}</select></label>
            <label>{copy.responsible}<select name="responsibleUserId" defaultValue={item.responsibleUserId ?? ""}><option value="">{copy.unassigned}</option>{workspace.responsibleUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label className="field-full">{copy.notes}<textarea name="notes" defaultValue={item.notes} maxLength={3000} /></label>
            <label className="field-full">{copy.evidence}<input name="evidenceReference" defaultValue={item.evidenceReference} maxLength={1000} /><small>{copy.evidenceHelp}</small></label>
            <label>{copy.dueAt}<input name="dueAt" type="datetime-local" /></label>
            {workspace.canApproveExceptions ? <><label>{copy.exceptionReason}<input name="exceptionReason" defaultValue={item.exceptionReason} maxLength={1000} /></label><label>{copy.exceptionExpiry}<input name="exceptionExpiresAt" type="datetime-local" /></label></> : null}
            <label className="field-full">{copy.reason}<input name="reason" required minLength={3} maxLength={1000} /></label>
            <div className="form-actions field-full"><button className="button button-secondary" type="submit">{copy.updateItem}</button></div>
          </form> : null}
        </article>)}
      </div>
    </section>

    <section className="detail-grid" style={{ marginBlockStart: 17 }}>
      <article className="panel form-panel"><h2>{copy.verification}</h2><p>{copy.verificationHelp}</p>
        <h3>{copy.blockers}</h3>{company.activationBlockers.length ? <ul>{company.activationBlockers.map((blocker) => <li key={blocker}>{companyOnboardingBlockerLabel(locale, blocker)}</li>)}</ul> : <p>{copy.noBlockers}</p>}
        {workspace.canVerify && verificationReady && company.verificationStatus !== "VERIFIED" ? <form action={verifyCompanyOnboardingAction} className="table-action-stack"><input type="hidden" name="companyId" value={company.id} /><input type="hidden" name="expectedVersion" value={company.version} /><label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={1000} /></label><button className="button button-primary" type="submit">{copy.verify}</button></form> : null}
      </article>
      <article className="panel"><h2>{copy.history}</h2>{workspace.verificationHistory.length ? <ol>{workspace.verificationHistory.map((entry) => <li key={entry.id}><strong>{entry.toStatus.replaceAll("_", " ")}</strong><br /><span className="subtle">{entry.reason} · {formatDateTime(entry.changedAt.toISOString(), locale, company.timezone)} · {entry.changedByName ?? copy.system}</span></li>)}</ol> : <p className="subtle">{copy.notAvailable}</p>}</article>
    </section>
  </>;
}

import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { companyLeadMessages } from "@/lib/company-leads-i18n";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import { createCompanyLeadAction } from "../actions";

export default async function NewCompanyLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_companies");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLeadMessages(locale);
  const query = await searchParams;
  const employeeOptions = [
    ["1_10", "1-10"], ["11_50", "11-50"], ["51_200", "51-200"],
    ["201_500", "201-500"], ["501_1000", "501-1,000"], ["1001_PLUS", "1,001+"],
  ];
  const branchOptions = [["1", "1"], ["2_5", "2-5"], ["6_20", "6-20"], ["21_50", "21-50"], ["51_PLUS", "51+"]];
  const spendOptions = [
    ["UNDER_10K", "< MYR 10k"], ["10K_50K", "MYR 10k-50k"],
    ["50K_250K", "MYR 50k-250k"], ["250K_1M", "MYR 250k-1m"],
    ["OVER_1M", "> MYR 1m"],
    ["UNDISCLOSED", locale === "ar" ? "أفضل عدم الإفصاح" : locale === "ms" ? "Tidak didedahkan" : "Prefer not to disclose"],
  ];
  return <>
    <PageHeader eyebrow={copy.queueTitle} title={copy.createTitle} description={copy.createIntro} />
    {query.notice === "lead-command-conflict" ? <section className="panel" role="alert"><strong>{copy.leadCommandConflict}</strong></section> : null}
    <form action={createCompanyLeadAction} className="panel form-panel">
      <input type="hidden" name="commandId" value={randomUUID()} />
      <div className="form-grid">
        <label>{copy.displayName}<input name="companyName" minLength={2} maxLength={200} required /></label>
        <label>{copy.legalName}<input name="legalName" minLength={2} maxLength={300} required /></label>
        <label>{copy.contactName}<input name="contactName" minLength={2} maxLength={200} required /></label>
        <label>{copy.city}<input name="city" minLength={2} maxLength={160} required /></label>
        <label>{copy.industry}<input name="industry" minLength={2} maxLength={200} required /></label>
        <label>{copy.employees}<select name="employeeRange" required defaultValue=""><option value="" disabled>-</option>{employeeOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>{copy.branches}<select name="branchRange" required defaultValue=""><option value="" disabled>-</option>{branchOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>{copy.spend}<select name="spendRange" required defaultValue=""><option value="" disabled>-</option>{spendOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>{copy.timezone}<input name="timezone" dir="ltr" defaultValue={actor.timezone ?? "Asia/Kuala_Lumpur"} minLength={1} maxLength={80} required /></label>
        <label>{copy.subject}<input name="subject" minLength={3} maxLength={200} required /></label>
        <label>{copy.leadLanguage}<select name="locale" defaultValue={locale}>{SUPPORTED_LOCALES.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
        <label className="field-full">{copy.message}<textarea name="message" rows={7} minLength={10} maxLength={5000} required /></label>
      </div>
      <div className="form-actions">
        <Link className="button button-secondary" href="/companies/leads">{copy.backToLeads}</Link>
        <button className="button button-primary" type="submit">{copy.createAction}</button>
      </div>
    </form>
  </>;
}

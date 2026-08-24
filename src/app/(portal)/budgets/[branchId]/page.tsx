import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BranchBudgetForm } from "@/components/BranchBudgetForm";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { branchBudgetMessages } from "@/lib/branch-budget-i18n";
import { getBranchBudgetFundingState } from "@/lib/branch-budget";
import { getBudgetWorkspace } from "@/lib/budget-ledger";
import { isoDateInTimeZone } from "@/lib/budget-period-range";

function money(value: string, currency: string, locale: string) { return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(value)); }

export default async function BranchBudgetPage({ params }: { params: Promise<{ branchId: string }> }) {
  const actor = await requirePagePermission("view_budgets");
  if (actor.accountKind !== "COMPANY") redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const copy = branchBudgetMessages(locale);
  const { branchId } = await params;
  const workspace = await getBudgetWorkspace(actor);
  const account = workspace?.accounts.find((candidate) => candidate.levelType === "BRANCH" && candidate.branchId === branchId && candidate.companyId === actor.companyId);
  if (!account) notFound();
  const fundingState = await getBranchBudgetFundingState(actor, branchId);
  const period = account.period;
  const configured = Number(account.recurringAllocation) > 0 || Boolean(period && Number(period.allocated) > 0);
  const today = isoDateInTimeZone(new Date().toISOString(), account.timezone || "Asia/Kuala_Lumpur");
  return <>
    <PageHeader eyebrow={`${copy.title} · ${account.code}`} title={account.name.replace(/ budget$/i, "")} description={copy.description} />
    <div className="page-actions"><Link className="button button-secondary" href="/budgets">{copy.back}</Link><Link className="button button-secondary" href={`/branches/${branchId}`}>{copy.viewBranch}</Link></div>
    {fundingState?.state === "FUNDING_REQUIRED" ? <section className="panel"><p className="form-alert" role="alert">{copy.funding} <Link href="/wallet">{copy.openWallet}</Link></p></section> : null}
    {period ? <section className="panel"><dl className="summary-list">
      <div><dt>{copy.current}</dt><dd>{money(period.allocated, account.currency, locale)}</dd></div>
      <div><dt>{copy.remaining}</dt><dd>{money(period.available, account.currency, locale)}</dd></div>
      <div><dt>{copy.cycle}</dt><dd>{account.refreshInterval}</dd></div>
      <div><dt>{copy.period}</dt><dd>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: actor.timezone ?? account.timezone }).formatRange(new Date(period.startsAt), new Date(period.endsAt))}</dd></div>
      <div><dt>{copy.status}</dt><dd><span className="status status-active">{period.status}</span></dd></div>
    </dl></section> : null}
    {configured ? <section className="panel"><p className="callout">{copy.immutable}</p></section> : <BranchBudgetForm branchId={branchId} locale={locale} today={today} />}
  </>;
}

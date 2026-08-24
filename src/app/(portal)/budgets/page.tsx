import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { branchBudgetMessages } from "@/lib/branch-budget-i18n";
import { getBudgetWorkspace } from "@/lib/budget-ledger";

function money(value: string, currency: string, locale: string) { return new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(value)); }

export default async function BudgetsPage() {
  const actor = await requirePagePermission("view_budgets");
  if (actor.accountKind !== "COMPANY") redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const copy = branchBudgetMessages(locale);
  const workspace = await getBudgetWorkspace(actor);
  if (!workspace) redirect("/access-denied");
  const branches = workspace.accounts.filter((account) => account.levelType === "BRANCH" && account.branchId && account.companyId === actor.companyId);
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <section className="panel table-panel">
      <div className="table-wrap"><table><thead><tr><th>{copy.branch}</th><th>{copy.current}</th><th>{copy.remaining}</th><th>{copy.cycle}</th><th>{copy.status}</th><th>{copy.action}</th></tr></thead>
        <tbody>{branches.map((account) => {
          const period = account.period;
          const configured = Number(account.recurringAllocation) > 0 || Boolean(period && Number(period.allocated) > 0);
          return <tr key={account.id}><td><strong>{account.name.replace(/ budget$/i, "")}</strong><br /><small>{account.code}</small></td>
            <td>{configured && period ? money(period.allocated, account.currency, locale) : copy.noBudget}</td>
            <td>{configured && period ? money(period.available, account.currency, locale) : "—"}</td><td>{configured ? account.refreshInterval : "—"}</td>
            <td><span className={configured ? "status status-active" : "status"}>{configured ? copy.active : copy.noBudget}</span></td>
            <td><Link className="button button-secondary button-small" href={`/budgets/${account.branchId}`}>{copy.manage}</Link></td></tr>;
        })}</tbody></table></div>
      {!branches.length ? <p className="empty-state">{copy.noBudget}</p> : null}
    </section>
  </>;
}

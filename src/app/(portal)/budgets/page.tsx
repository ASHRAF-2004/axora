import { LiveWorkspaceSync } from "@/components/LiveWorkspaceSync";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { branchBudgetMessages } from "@/lib/branch-budget-i18n";
import { budgetFrequencyLabel } from "@/lib/budget-cycle-variance-i18n";
import { getBudgetWorkspace } from "@/lib/budget-ledger";
import styles from "./Budgets.module.css";

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
    <LiveWorkspaceSync topics={["budgets"]} locale={locale} />
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <section className={`panel table-panel ${styles.workspace}`}>
      <div className={styles.tableWrap} role="region" aria-label={copy.title} tabIndex={0}><table className={styles.table}><thead><tr><th scope="col">{copy.branch}</th><th scope="col" className={styles.money}>{copy.current}</th><th scope="col" className={styles.money}>{copy.remaining}</th><th scope="col">{copy.cycle}</th><th scope="col">{copy.status}</th><th scope="col">{copy.action}</th></tr></thead>
        <tbody>{branches.map((account) => {
          const period = account.period;
          const configured = Number(account.recurringAllocation) > 0 || Boolean(period && Number(period.allocated) > 0);
          return <tr key={account.id}><td className={styles.branch}><strong>{account.name.replace(/ budget$/i, "")}</strong><small><bdi>{account.code}</bdi></small></td>
            <td className={styles.money}><bdi>{configured && period ? money(period.allocated, account.currency, locale) : copy.noBudget}</bdi></td>
            <td className={styles.money}><bdi>{configured && period ? money(period.available, account.currency, locale) : "—"}</bdi></td><td>{configured ? budgetFrequencyLabel(account.refreshInterval, locale) : "—"}</td>
            <td><span className={configured ? "status status-active" : "status"}>{configured ? copy.active : copy.noBudget}</span></td>
            <td className={styles.actions}><Link className="button button-secondary button-small" href={`/budgets/${account.branchId}`}>{copy.manage}</Link></td></tr>;
        })}</tbody></table></div>
      {!branches.length ? <p className="empty-state">{copy.noBudget}</p> : null}
    </section>
  </>;
}

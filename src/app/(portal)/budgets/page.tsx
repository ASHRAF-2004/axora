import { notFound, redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth";
import { getBudgetWorkspace } from "@/lib/budget-ledger";
import { getBudgetCycleWorkspace } from "@/lib/budget-cycles";
import { BudgetCycleManagement } from "@/components/BudgetCycleManagement";
import { budgetApprovalMessages } from "@/lib/budget-approval-i18n";
import {
  adjustBudgetAction,
  refreshBudgetAction,
  setCompanyCeilingAction,
  transferBudgetAction,
} from "./actions";
import styles from "../budget-approval.module.css";

function money(value: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value));
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const actor = await requireSession();
  if (actor.accountKind !== "COMPANY") notFound();
  if (!actor.roleAssignmentId) redirect("/access-denied");
  const [workspace, cycleWorkspace, feedback] = await Promise.all([
    getBudgetWorkspace(actor),
    getBudgetCycleWorkspace(actor),
    searchParams,
  ]);
  if (!workspace) redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const messages = budgetApprovalMessages(locale);
  const transferable = workspace.accounts.filter((account) => account.canAssign && account.period);

  return (
    <main className={styles.page} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>{messages.budgetsTitle}</span>
        <h1>{messages.budgetsTitle}</h1>
        <p>{messages.budgetsIntro}</p>
      </header>
      {feedback.success ? <p className={styles.notice} role="status">{messages.success}</p> : null}
      {feedback.error ? <p className={styles.notice} role="alert">{messages.failure}</p> : null}
      {workspace.ceilings.length ? (
        <section className={styles.summaryGrid} aria-label={messages.ceiling}>
          {workspace.ceilings.map((ceiling) => (
            <article className={styles.card} key={ceiling.companyId}>
              <div className={styles.cardHeader}><h2>{ceiling.companyName}</h2><span className={styles.state}>{messages.ceiling}</span></div>
              <div className={styles.metrics}>
                <div className={styles.metric}><span>{messages.ceiling}</span><strong>{money(ceiling.amount, ceiling.currency, locale)}</strong></div>
                <div className={styles.metric}><span>{messages.utilized}</span><strong>{money(ceiling.utilized, ceiling.currency, locale)}</strong></div>
              </div>
              {ceiling.canOverride ? (
                <form action={setCompanyCeilingAction} className={styles.adminForm}>
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <input type="hidden" name="companyId" value={ceiling.companyId} />
                  <input type="hidden" name="currency" value={ceiling.currency} />
                  <label><span>{messages.amount}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
                  <label><span>{messages.explanation}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
                  <button className={styles.primaryAction} type="submit">{messages.setCeiling}</button>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {workspace.accounts.length === 0 ? (
        <section className={styles.card}><p>{messages.noBudgets}</p></section>
      ) : (
        <section className={styles.accountGrid} aria-label={messages.budgetsTitle}>
          {workspace.accounts.map((account) => (
            <article className={styles.card} key={account.id}>
              <div className={styles.cardHeader}>
                <div><span className={styles.state}>{account.levelType.replaceAll("_", " ")}</span><h2>{account.name}</h2></div>
                <span className={styles.muted}>{account.code}</span>
              </div>
              {account.period ? (
                <>
                  <p className={styles.muted}>{messages.period}: {account.period.name}</p>
                  <div className={styles.metrics}>
                    <div className={styles.metric}><span>{messages.available}</span><strong>{money(account.period.available, account.currency, locale)}</strong></div>
                    <div className={styles.metric}><span>{messages.allocated}</span><strong>{money(account.period.allocated, account.currency, locale)}</strong></div>
                    <div className={styles.metric}><span>{messages.reserved}</span><strong>{money(account.period.reserved, account.currency, locale)}</strong></div>
                    <div className={styles.metric}><span>{messages.spent}</span><strong>{money(account.period.spent, account.currency, locale)}</strong></div>
                    <div className={styles.metric}><span>{messages.pending}</span><strong>{money(account.period.pendingApproval, account.currency, locale)}</strong></div>
                    <div className={styles.metric}><span>{messages.refresh}</span><strong>{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(account.period.nextRefreshAt))}</strong></div>
                  </div>
                </>
              ) : null}
              {account.canIncrease || account.canReduce ? (
                <form action={adjustBudgetAction} className={styles.adminForm}>
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <input type="hidden" name="accountId" value={account.id} />
                  <div className={styles.fieldGrid}>
                    <label><span>{messages.adjust}</span><select name="direction">{account.canIncrease ? <option value="INCREASE">{messages.increase}</option> : null}{account.canReduce ? <option value="REDUCE">{messages.decrease}</option> : null}</select></label>
                    <label><span>{messages.amount}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
                  </div>
                  <label><span>{messages.explanation}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
                  <label><input name="recurring" type="checkbox" /> {messages.recurring}</label>
                  <button className={styles.secondaryAction} type="submit">{messages.adjust}</button>
                </form>
              ) : null}
              {account.canRefresh ? (
                <form action={refreshBudgetAction} className={styles.adminForm}>
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <input type="hidden" name="accountId" value={account.id} />
                  <label><span>{messages.explanation}</span><input name="explanation" minLength={3} maxLength={1000} required /></label>
                  <button className={styles.secondaryAction} type="submit">{messages.refreshPeriod}</button>
                </form>
              ) : null}
            </article>
          ))}
        </section>
      )}
      {transferable.length>1 ? (
        <section className={styles.card}>
          <h2>{messages.transferBudget}</h2>
          <form action={transferBudgetAction} className={styles.adminForm}>
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <div className={styles.fieldGrid}>
              <label><span>{messages.sourceAccount}</span><select name="sourceAccountId" required>{transferable.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label><span>{messages.targetAccount}</span><select name="targetAccountId" required>{transferable.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label><span>{messages.amount}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
            </div>
            <label><span>{messages.explanation}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
            <label><input name="recurring" type="checkbox" /> {messages.recurring}</label>
            <button className={styles.primaryAction} type="submit">{messages.transferBudget}</button>
          </form>
        </section>
      ) : null}
      <section className={styles.card}>
        <h2>{messages.history}</h2>
        <ul className={styles.ledgerList}>
          {workspace.entries.slice(0,50).map((entry) => (
            <li key={entry.id}><span><strong>{entry.entryType.replaceAll("_", " ")}</strong><br /><small className={styles.muted}>{entry.explanation}</small></span><span>{money(entry.amount, entry.currency, locale)}<br /><small className={styles.muted}>{new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.postedAt))}</small></span></li>
          ))}
        </ul>
      </section>
      {cycleWorkspace ? (
        <BudgetCycleManagement workspace={cycleWorkspace} locale={locale} />
      ) : null}
    </main>
  );
}

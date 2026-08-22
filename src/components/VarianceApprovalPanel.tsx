import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@/lib/i18n";
import type { ProcurementVarianceApprovalWorkspace } from "@/lib/budget-variance";
import { budgetCycleVarianceMessages } from "@/lib/budget-cycle-variance-i18n";
import { decideRequestActualAction } from "@/app/(portal)/approvals/actions";
import styles from "@/app/(portal)/budget-approval.module.css";

function money(value: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .format(Number(value));
}

export function VarianceApprovalPanel({
  workspace,
  locale,
}: {
  workspace: ProcurementVarianceApprovalWorkspace;
  locale: SupportedLocale;
}) {
  const messages = budgetCycleVarianceMessages(locale);
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div><span className={styles.state}>{messages.varianceApprovalTitle}</span><h2>{messages.varianceApprovalTitle}</h2></div>
      </div>
      <p className={styles.muted}>{messages.varianceApprovalIntro}</p>
      {!workspace.submissions.length ? <p>{messages.noVarianceApprovals}</p> : (
        <div className={styles.approvalGrid}>
          {workspace.submissions.map((submission) => (
            <article className={styles.card} key={submission.id}>
              <div className={styles.cardHeader}><div><span className={styles.state}>{submission.state}</span><h3>{submission.requestNumber}</h3></div><strong>{money(submission.submissionAmount, submission.currency, locale)}</strong></div>
              <p className={styles.muted}>{submission.companyName} / {submission.branchName} / {submission.submittedBy}</p>
              <div className={styles.metrics}>
                <div className={styles.metric}><span>{messages.estimate}</span><strong>{money(submission.estimateAmount, submission.currency, locale)}</strong></div>
                <div className={styles.metric}><span>{messages.previousActual}</span><strong>{money(submission.previousActualAmount, submission.currency, locale)}</strong></div>
                <div className={styles.metric}><span>{messages.cumulative}</span><strong>{money(submission.cumulativeActualAmount, submission.currency, locale)}</strong></div>
                <div className={styles.metric}><span>{messages.difference}</span><strong>{money(submission.differenceAmount, submission.currency, locale)}</strong></div>
              </div>
              <p>{messages.receiptProvided}: {submission.receiptProvided ? "YES" : "NO"} / {messages.withinTolerance}: {submission.withinTolerance ? "YES" : "NO"} / {messages.substitute}: {submission.substitutePresent ? "YES" : "NO"}</p>
              <ul className={styles.lineList}>
                {submission.lines.map((line) => (
                  <li key={line.id}>
                    <span>{line.estimatedProductName}{line.actualProductName!==line.estimatedProductName ? " -> " + line.actualProductName : ""}<br /><small className={styles.muted}>{line.substituteReason ?? ""}</small></span>
                    <strong>{line.quantity} {line.unitOfMeasure} / {money(line.lineTotal, submission.currency, locale)}</strong>
                  </li>
                ))}
              </ul>
              <form action={decideRequestActualAction} className={styles.decisionForm}>
                <input type="hidden" name="submissionId" value={submission.id} />
                <input type="hidden" name="approvalRevision" value={submission.approvalRevision} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <div className={styles.fieldGrid}>
                  <label><span>{messages.fundingOption}</span><select name="fundingOption" defaultValue="APPROVE_ADDITIONAL"><option value="APPROVE_ADDITIONAL">{messages.standardAdditional}</option><option value="TRANSFER_RESERVE">{messages.transferReserve}</option><option value="TEMPORARY_INCREASE">{messages.temporaryIncrease}</option></select></label>
                  <label><span>{messages.sourceAccount}</span><select name="sourceBudgetAccountId" defaultValue=""><option value="">-</option>{submission.sourceAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} / {money(account.available, submission.currency, locale)}</option>)}</select></label>
                </div>
                <div className={styles.actionRow}><button className={styles.primaryAction} name="decision" value="APPROVE">{messages.approve}</button><button className={styles.secondaryAction} name="decision" value="RETURN">{messages.return}</button><button className={styles.dangerAction} name="decision" value="REJECT">{messages.reject}</button></div>
              </form>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

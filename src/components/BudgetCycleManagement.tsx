import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@/lib/i18n";
import type { BudgetCycleWorkspace } from "@/lib/budget-cycles";
import { budgetCycleVarianceMessages } from "@/lib/budget-cycle-variance-i18n";
import {
  decideBudgetAdjustmentAction,
  decideBudgetCycleChangeAction,
  decideVariancePolicyChangeAction,
  requestBudgetAdjustmentAction,
  requestBudgetCycleChangeAction,
  requestVariancePolicyChangeAction,
  rerunBudgetRefreshJobAction,
} from "@/app/(portal)/budgets/actions";
import styles from "@/app/(portal)/budget-approval.module.css";

function money(value: string | number | undefined, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .format(Number(value ?? 0));
}

function dateTime(value: string, locale: string, timezone?: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function localInput(value: string) {
  return value.replace(" ", "T").slice(0, 16);
}

const frequencies = ["WEEKLY","MONTHLY","QUARTERLY","YEARLY","CUSTOM","MANUAL"] as const;
const rolloverModes = ["RESET_FIXED","FULL","NONE","PARTIAL_PERCENT","CUSTOM_AMOUNT"] as const;

export function BudgetCycleManagement({
  workspace,
  locale,
}: {
  workspace: BudgetCycleWorkspace;
  locale: SupportedLocale;
}) {
  const messages = budgetCycleVarianceMessages(locale);
  return (
    <>
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div><span className={styles.state}>P1-06</span><h2>{messages.cycleTitle}</h2></div>
        </div>
        <p className={styles.muted}>{messages.cycleIntro}</p>
      </section>
      <section className={styles.accountGrid} aria-label={messages.cycleTitle}>
        {workspace.accounts.map((account) => (
          <article className={styles.card} key={account.id}>
            <div className={styles.cardHeader}>
              <div><span className={styles.state}>{account.schedule.frequency}</span><h2>{account.name}</h2></div>
              <span className={styles.muted}>v{account.schedule.version}</span>
            </div>
            <div className={styles.metrics}>
              <div className={styles.metric}><span>{messages.nextRefresh}</span><strong>{dateTime(account.nextRefreshAt, locale, "UTC")}</strong></div>
              <div className={styles.metric}><span>{messages.timezone}</span><strong>{account.schedule.timezone}</strong></div>
              <div className={styles.metric}><span>{messages.fixedAllocation}</span><strong>{money(account.schedule.fixedAllocation, account.currency, locale)}</strong></div>
              <div className={styles.metric}><span>{messages.rolloverMode}</span><strong>{account.schedule.rolloverMode.replaceAll("_", " ")}</strong></div>
            </div>
            {account.canRequest ? (
              <details>
                <summary>{messages.requestChange}</summary>
                <form action={requestBudgetCycleChangeAction} className={styles.adminForm}>
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <input type="hidden" name="budgetAccountId" value={account.id} />
                  <div className={styles.fieldGrid}>
                    <label><span>{messages.frequency}</span><select name="frequency" defaultValue={account.schedule.frequency}>{frequencies.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                    <label><span>{messages.interval}</span><input name="intervalCount" type="number" min="1" max="52" defaultValue={account.schedule.intervalCount} required /></label>
                    <label><span>{messages.customDays}</span><input name="customIntervalDays" type="number" min="1" max="3660" defaultValue={account.schedule.customIntervalDays} /></label>
                    <label><span>{messages.timezone}</span><input name="timezone" defaultValue={account.schedule.timezone} minLength={3} maxLength={100} required /></label>
                    <label><span>{messages.anchor}</span><input name="anchorLocal" type="datetime-local" defaultValue={localInput(account.schedule.anchorLocal)} required /></label>
                    <label><span>{messages.effective}</span><input name="effectiveLocal" type="datetime-local" defaultValue={localInput(account.schedule.anchorLocal)} /></label>
                    <label><span>{messages.dst}</span><select name="dstResolution" defaultValue={account.schedule.dstResolution}><option value="EARLIER">{messages.earlier}</option><option value="LATER">{messages.later}</option></select></label>
                    <label><span>{messages.fixedAllocation}</span><input name="fixedAllocation" type="number" min="0" step="0.01" defaultValue={account.schedule.fixedAllocation} required /></label>
                    <label><span>{messages.rolloverMode}</span><select name="rolloverMode" defaultValue={account.schedule.rolloverMode}>{rolloverModes.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
                    <label><span>{messages.rolloverPercent}</span><input name="rolloverPercentage" type="number" min="0.01" max="99.99" step="0.01" defaultValue={account.schedule.rolloverPercentage} /></label>
                    <label><span>{messages.customRollover}</span><input name="customRolloverAmount" type="number" min="0" step="0.01" defaultValue={account.schedule.customRolloverAmount} /></label>
                    <label><span>{messages.lowThreshold}</span><input name="lowThresholdPercentage" type="number" min="1" max="99" step="0.01" defaultValue={account.schedule.lowThresholdPercentage} required /></label>
                    <label><span>{messages.criticalThreshold}</span><input name="criticalThresholdPercentage" type="number" min="0.01" max="98" step="0.01" defaultValue={account.schedule.criticalThresholdPercentage} required /></label>
                    <label><span>{messages.hysteresis}</span><input name="hysteresisPercentage" type="number" min="0.01" max="25" step="0.01" defaultValue={account.schedule.hysteresisPercentage} required /></label>
                  </div>
                  <label><span>{messages.reason}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
                  <button className={styles.primaryAction} type="submit">{messages.requestChange}</button>
                </form>
              </details>
            ) : null}
            <details>
              <summary>{messages.periodHistory}</summary>
              <ul className={styles.ledgerList}>
                {account.periods.map((period) => (
                  <li key={period.id}>
                    <span><strong>{period.name}</strong><br /><small className={styles.muted}>{period.status} / v{period.scheduleVersion}</small></span>
                    <span>{money(period.available, account.currency, locale)}<br /><small className={styles.muted}>{dateTime(period.endsAt, locale, account.schedule.timezone)}</small></span>
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary>{messages.requestAdjustment}</summary>
              <form action={requestBudgetAdjustmentAction} className={styles.adminForm}>
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <input type="hidden" name="budgetAccountId" value={account.id} />
                <div className={styles.fieldGrid}>
                  <label><span>{messages.adjustmentType}</span><select name="adjustmentType" defaultValue="ONE_TIME"><option value="ONE_TIME">ONE TIME</option><option value="TEMPORARY">TEMPORARY</option><option value="PERMANENT">PERMANENT</option><option value="TRANSFER">TRANSFER</option></select></label>
                  <label><span>{messages.amount}</span><input name="amount" type="number" min="0.01" step="0.01" required /></label>
                  <label><span>{messages.sourceAccount}</span><select name="sourceBudgetAccountId" defaultValue=""><option value="">-</option>{workspace.accounts.filter((item) => item.id!==account.id && item.companyId===account.companyId && item.currency===account.currency).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label><span>{messages.effectiveUntil}</span><input name="effectiveUntil" type="datetime-local" /></label>
                </div>
                <label><span>{messages.reason}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
                <button className={styles.secondaryAction} type="submit">{messages.requestAdjustment}</button>
              </form>
            </details>
          </article>
        ))}
      </section>
      {workspace.changeRequests.length ? (
        <section className={styles.card}>
          <h2>{messages.pendingChanges}</h2>
          <ul className={styles.ledgerList}>
            {workspace.changeRequests.map((change) => (
              <li key={change.id}>
                <span><strong>{change.accountName}</strong><br /><small className={styles.muted}>{change.state} / {messages.requestedBy}: {change.requestedBy}<br />{change.reason}</small></span>
                {change.canDecide ? <form action={decideBudgetCycleChangeAction} className={styles.adminForm}><input type="hidden" name="changeRequestId" value={change.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} /><input name="explanation" minLength={3} maxLength={1000} aria-label={messages.reason} required /><div className={styles.actionRow}><button className={styles.primaryAction} name="decision" value="APPROVE">{messages.approve}</button><button className={styles.dangerAction} name="decision" value="REJECT">{messages.reject}</button></div></form> : <span>{change.state}</span>}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className={styles.card}>
        <h2>{messages.variancePolicy}</h2>
        <p className={styles.muted}>{messages.varianceIntro}</p>
        {workspace.variancePolicies.map((policy) => (
          <form action={requestVariancePolicyChangeAction} className={styles.adminForm} key={policy.id}>
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <input type="hidden" name="companyId" value={policy.companyId} />
            <strong>{policy.companyName} / v{policy.version}</strong>
            <div className={styles.fieldGrid}>
              <label><span>{messages.toleranceMode}</span><select name="toleranceMode" defaultValue={policy.toleranceMode}><option value="NONE">NONE</option><option value="FIXED">FIXED</option><option value="PERCENTAGE">PERCENTAGE</option><option value="LOWER_ONLY">LOWER ONLY</option></select></label>
              <label><span>{messages.fixedTolerance}</span><input name="fixedTolerance" type="number" min="0" step="0.01" defaultValue={policy.fixedTolerance} /></label>
              <label><span>{messages.percentageTolerance}</span><input name="percentageTolerance" type="number" min="0" max="100" step="0.01" defaultValue={policy.percentageTolerance} /></label>
              <label><span>{messages.effective}</span><input name="effectiveAt" type="datetime-local" /></label>
            </div>
            <label><span>{messages.reason}</span><textarea name="explanation" minLength={3} maxLength={1000} required /></label>
            <button className={styles.secondaryAction} type="submit">{messages.requestPolicy}</button>
          </form>
        ))}
        {workspace.variancePolicyChanges.map((change) => (
          <form action={decideVariancePolicyChangeAction} className={styles.adminForm} key={change.id}>
            <input type="hidden" name="changeRequestId" value={change.id} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <strong>{change.companyName} / {change.requestedBy}</strong>
            <p className={styles.muted}>{change.reason}</p>
            {change.canDecide ? <><input name="explanation" minLength={3} maxLength={1000} aria-label={messages.reason} required /><div className={styles.actionRow}><button className={styles.primaryAction} name="decision" value="APPROVE">{messages.approve}</button><button className={styles.dangerAction} name="decision" value="REJECT">{messages.reject}</button></div></> : <span>{change.state}</span>}
          </form>
        ))}
      </section>
      {workspace.adjustmentRequests.length ? (
        <section className={styles.card}>
          <h2>{messages.pendingAdjustments}</h2>
          {workspace.adjustmentRequests.map((adjustment) => (
            <form action={decideBudgetAdjustmentAction} className={styles.adminForm} key={adjustment.id}>
              <input type="hidden" name="adjustmentRequestId" value={adjustment.id} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <strong>{adjustment.accountName}: {adjustment.adjustmentType} / {adjustment.amount}</strong>
              <p className={styles.muted}>{adjustment.requestedBy}: {adjustment.reason}</p>
              {adjustment.canDecide ? <><input name="explanation" minLength={3} maxLength={1000} aria-label={messages.reason} required /><div className={styles.actionRow}><button className={styles.primaryAction} name="decision" value="APPROVE">{messages.approve}</button><button className={styles.secondaryAction} name="decision" value="RETURN">{messages.return}</button><button className={styles.dangerAction} name="decision" value="REJECT">{messages.reject}</button></div></> : <span>{adjustment.state}</span>}
            </form>
          ))}
        </section>
      ) : null}
      <section className={styles.card}>
        <h2>{messages.refreshJobs}</h2>
        {workspace.jobs.length ? <ul className={styles.ledgerList}>{workspace.jobs.map((job) => <li key={job.id}><span><strong>{job.accountName}</strong><br /><small className={styles.muted}>{job.state} / {job.attemptCount}/{job.maxAttempts} / {dateTime(job.dueAt, locale, "UTC")}</small></span>{job.canRerun ? <form action={rerunBudgetRefreshJobAction}><input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} /><input name="explanation" minLength={3} maxLength={1000} aria-label={messages.reason} required /><button className={styles.secondaryAction}>{messages.rerun}</button></form> : <span>{job.lastErrorCode ?? job.state}</span>}</li>)}</ul> : <p>{messages.noJobs}</p>}
      </section>
      <section className={styles.card}>
        <h2>{messages.alerts}</h2>
        {workspace.alerts.length ? <ul className={styles.ledgerList}>{workspace.alerts.map((alert) => <li key={alert.id}><span><strong>{alert.accountName}</strong><br /><small className={styles.muted}>{alert.thresholdCode} / {alert.active ? "ACTIVE" : "REARMED"}</small></span><span>{alert.lastAvailable}</span></li>)}</ul> : <p>{messages.noAlerts}</p>}
      </section>
    </>
  );
}

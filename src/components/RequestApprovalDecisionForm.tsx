import { randomUUID } from "node:crypto";
import type { BudgetApprovalMessages } from "@/lib/budget-approval-i18n";
import type { ApprovalQueueItem } from "@/lib/request-approval";
import { moneyDecimalIsPositive } from "@/lib/money-decimal";
import { decideRequestApprovalAction } from "@/app/(portal)/approvals/actions";
import styles from "@/app/(portal)/budget-approval.module.css";

export function RequestApprovalDecisionForm({
  request,
  messages,
  sourceAccounts,
}: {
  request: ApprovalQueueItem;
  messages: BudgetApprovalMessages;
  sourceAccounts: Array<{ id: string; name: string }>;
}) {
  const overBudget = moneyDecimalIsPositive(request.exceededBy);
  return (
    <form action={decideRequestApprovalAction} className={styles.decisionForm}>
      <input type="hidden" name="requestId" value={request.id} />
      <input type="hidden" name="approvalRevision" value={request.approvalRevision} />
      {request.canApproveAndPay ? (
        <input type="hidden" name="commandId" value={randomUUID()} />
      ) : null}
      {overBudget && request.canResolveOverBudget ? (
        <div className={styles.fieldGrid}>
          <label>
            <span>{messages.companyAction}</span>
            <select name="optionCode" defaultValue="">
              <option value="">{messages.sendForApproval}</option>
              <option value="ONE_TIME_EXCEPTION">{messages.exception}</option>
              <option value="TEMPORARY_PERIOD_INCREASE">{messages.temporaryIncrease}</option>
              <option value="TRANSFER_RESERVE">{messages.transfer}</option>
            </select>
          </label>
          <label>
            <span>{messages.sourceAccount}</span>
            <select name="sourceBudgetAccountId" defaultValue="">
              <option value="">{messages.standard}</option>
              {sourceAccounts.filter((account) => account.id!==request.budgetAccountId).map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <label>
        <span>{messages.reason}</span>
        <textarea name="reason" minLength={3} maxLength={1000} required />
      </label>
      <p className={styles.formHelp}>{request.canApproveAndPay
        ? messages.approveAndPayHelp
        : messages.approveHelp}</p>
      <div className={styles.actionRow}>
        <button
          className={styles.primaryAction}
          name="decision"
          value={request.canApproveAndPay ? "APPROVE_AND_PAY" : "APPROVE"}
          type="submit"
        >
          {request.canApproveAndPay ? messages.approveAndPay : messages.approve}
        </button>
        <button className={styles.secondaryAction} name="decision" value="RETURN" type="submit">
          {messages.return}
        </button>
        <button className={styles.dangerAction} name="decision" value="REJECT" type="submit">
          {messages.reject}
        </button>
      </div>
    </form>
  );
}

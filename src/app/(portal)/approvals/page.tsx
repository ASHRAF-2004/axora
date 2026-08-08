import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import { getApprovalWorkspace } from "@/lib/request-approval";
import { getBudgetWorkspace } from "@/lib/budget-ledger";
import { approvalStateLabel, budgetApprovalMessages } from "@/lib/budget-approval-i18n";
import { RequestApprovalDecisionForm } from "@/components/RequestApprovalDecisionForm";
import { getProcurementVarianceApprovalWorkspace } from "@/lib/budget-variance";
import { VarianceApprovalPanel } from "@/components/VarianceApprovalPanel";
import styles from "../budget-approval.module.css";

function money(value: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(value));
}

function lineLabel(line: Record<string, unknown>) {
  return String(line.product_name_snapshot ?? line.product_name ?? line.productName ?? line.description ?? line.product_id ?? "Item");
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const actor = await requirePagePermission("view_approvals");
  if (!isDemoMode() && !actor.roleAssignmentId) redirect("/access-denied");
  const canReviewCustomerRequests = actor.accountKind === "COMPANY";
  const [workspace, budgets, varianceWorkspace, feedback] = await Promise.all([
    canReviewCustomerRequests ? getApprovalWorkspace(actor) : Promise.resolve(null),
    canReviewCustomerRequests ? getBudgetWorkspace(actor) : Promise.resolve(null),
    getProcurementVarianceApprovalWorkspace(actor),
    searchParams,
  ]);
  if (!workspace && !varianceWorkspace) redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const messages = budgetApprovalMessages(locale);
  const sourceAccounts = (budgets?.accounts ?? []).map((account) => ({
    id: account.id,
    name: account.name,
  }));

  return (
    <main className={styles.page} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className={styles.hero}>
        <span className={styles.eyebrow}>P0-08</span>
        <h1>{messages.approvalTitle}</h1>
        <p>{messages.approvalIntro}</p>
      </header>
      {feedback.success ? <p className={styles.notice} role="status">{messages.success}</p> : null}
      {feedback.error ? <p className={styles.notice} role="alert">{messages.failure}</p> : null}
      {workspace && workspace.requests.length === 0 ? (
        <section className={styles.card}><p>{messages.noApprovals}</p></section>
      ) : workspace ? (
        <section className={styles.approvalGrid} aria-label={messages.approvalTitle}>
          {workspace.requests.map((request) => (
            <article className={styles.card} key={request.id}>
              <div className={styles.cardHeader}>
                <div>
                  <span className={styles.state}>{approvalStateLabel(locale, request.state)}</span>
                  <h2>{request.requestNumber}</h2>
                </div>
                <strong>{money(request.amount, request.currency, locale)}</strong>
              </div>
              <p className={styles.muted}>{request.companyName} / {request.branchName}{request.departmentName ? ` / ${request.departmentName}` : ""}</p>
              <div className={styles.metrics}>
                <div className={styles.metric}><span>{messages.requester}</span><strong>{request.requesterName}</strong></div>
                <div className={styles.metric}><span>{messages.approvalLimit}</span><strong>{request.approvalLimit ? money(request.approvalLimit, request.currency, locale) : "-"}</strong></div>
                <div className={styles.metric}><span>{messages.available}</span><strong>{money(request.available, request.currency, locale)}</strong></div>
                {Number(request.exceededBy)>0 ? (
                  <div className={`${styles.metric} ${styles.dangerMetric}`}><span>{messages.exceededBy}</span><strong>{money(request.exceededBy, request.currency, locale)}</strong></div>
                ) : (
                  <div className={styles.metric}><span>{messages.delivery}</span><strong>{request.deliveryDate ?? "-"}</strong></div>
                )}
              </div>
              <h3>{messages.lines}</h3>
              <ul className={styles.lineList}>
                {request.lines.map((line, index) => (
                  <li key={String(line.id ?? index)}>
                    <span>{lineLabel(line)}</span>
                    <strong>{String(line.quantity ?? "")}</strong>
                  </li>
                ))}
              </ul>
              <RequestApprovalDecisionForm request={request} messages={messages} sourceAccounts={sourceAccounts} />
            </article>
          ))}
        </section>
      ) : null}
      {varianceWorkspace ? (
        <VarianceApprovalPanel workspace={varianceWorkspace} locale={locale} />
      ) : null}
    </main>
  );
}

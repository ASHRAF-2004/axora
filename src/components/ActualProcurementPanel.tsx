import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@/lib/i18n";
import type { ProcurementActualWorkspace } from "@/lib/budget-variance";
import { budgetCycleVarianceMessages } from "@/lib/budget-cycle-variance-i18n";
import {
  assignFulfilmentPurchaseAction,
  submitRequestActualAction,
} from "@/app/(portal)/operations/actions";

function money(value: string, currency: string, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency })
    .format(Number(value));
}

export function ActualProcurementPanel({
  workspace,
  locale,
}: {
  workspace: ProcurementActualWorkspace;
  locale: SupportedLocale;
}) {
  const messages = budgetCycleVarianceMessages(locale);
  return (
    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-header">
        <div><span className="eyebrow">P1-07</span><h2>{messages.actualTitle}</h2><p>{messages.actualIntro}</p></div>
      </div>
      <div className="panel-body">
        {!workspace.requests.length ? <p>{messages.noActualRequests}</p> : workspace.requests.map((request) => (
          <article className="panel form-panel" key={request.id} style={{ marginBottom: 17 }}>
            <div className="panel-header">
              <div><strong>{request.requestNumber}</strong><p>{request.companyName} / {request.branchName}</p></div>
              <div><span>{messages.estimate}</span><br /><strong>{money(request.estimateAmount, request.currency, locale)}</strong></div>
            </div>
            {workspace.canAssign ? (
              <form action={assignFulfilmentPurchaseAction} className="form-grid">
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label>{messages.assignee}<select name="assignee" required defaultValue={request.assignment ? request.assignment.assignedUserId + "|" + workspace.eligibleUsers.find((item) => item.userId===request.assignment?.assignedUserId)?.roleAssignmentId : ""}><option value="" disabled>{messages.assignee}</option>{workspace.eligibleUsers.map((user) => <option key={user.roleAssignmentId} value={user.userId + "|" + user.roleAssignmentId}>{user.name}</option>)}</select></label>
                <label>{messages.reason}<input name="reason" minLength={3} maxLength={1000} required /></label>
                <div className="form-actions"><button className="button button-secondary" type="submit">{messages.assign}</button></div>
              </form>
            ) : null}
            {request.assignment ? <p className="subtle">{messages.assignee}: {request.assignment.assignedUserName}</p> : null}
            {request.canSubmit ? (
              <form action={submitRequestActualAction} encType="multipart/form-data">
                <input type="hidden" name="requestId" value={request.id} />
                <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <div className="form-grid">
                  <label>{messages.purchaseMode}<select name="purchaseMode" defaultValue="FINAL"><option value="PARTIAL">{messages.partial}</option><option value="FINAL">{messages.final}</option><option value="REFUND">{messages.refund}</option></select></label>
                  <label>{messages.receipt}<input name="receipt" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required /></label>
                </div>
                {request.lines.map((line) => (
                  <fieldset key={line.id} className="form-grid">
                    <legend>{line.productName} / {line.quantity} {line.unitOfMeasure}</legend>
                    <input type="hidden" name="lineId" value={line.id} />
                    <label>{messages.actualProduct}<select name={"actualProductId:" + line.id} defaultValue={line.productId} required>{workspace.products.map((product) => <option key={product.id} value={product.id}>{product.code} / {product.name}</option>)}</select></label>
                    <label>{messages.supplier}<select name={"supplierId:" + line.id} defaultValue={line.selectedSupplierId ?? ""} required><option value="" disabled>{messages.supplier}</option>{workspace.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.code} / {supplier.name}</option>)}</select></label>
                    <label>{messages.quantity}<input name={"quantity:" + line.id} type="number" min="0.001" step="0.001" defaultValue={line.quantity} required /></label>
                    <label>{messages.buyPrice}<input name={"actualBuyUnitPrice:" + line.id} type="number" min="0" step="0.000001" required /></label>
                    <label>{messages.taxRate}<input name={"taxRate:" + line.id} type="number" min="0" max="100" step="0.0001" defaultValue="0" required /></label>
                    <label>{messages.deliveryCharge}<input name={"deliveryCharge:" + line.id} type="number" min="0" step="0.01" defaultValue="0" required /></label>
                    <label>{messages.otherCharge}<input name={"otherCharge:" + line.id} type="number" min="0" step="0.01" defaultValue="0" required /></label>
                    <label>{messages.substituteReason}<input name={"substituteReason:" + line.id} maxLength={1000} /></label>
                    <label>{messages.notes}<input name={"lineNotes:" + line.id} maxLength={1000} /></label>
                  </fieldset>
                ))}
                <label>{messages.notes}<textarea name="notes" minLength={3} maxLength={2000} required /></label>
                <div className="form-actions"><button className="button button-primary" type="submit">{messages.submitActual}</button></div>
              </form>
            ) : null}
            {request.actualHistory.length ? <details><summary>{messages.actualHistory}</summary><ul>{request.actualHistory.map((actual) => <li key={actual.id}>{actual.purchaseMode} / {actual.state} / {money(actual.submissionAmount, request.currency, locale)} / {messages.cumulative}: {money(actual.cumulativeActualAmount, request.currency, locale)}</li>)}</ul></details> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

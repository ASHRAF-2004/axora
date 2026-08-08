import { PageHeader } from "@/components/PageHeader";
import { ReceivingOtpPanel } from "@/components/role-portals/ReceivingOtpPanel";
import { StatusBadge } from "@/components/StatusBadge";
import styles from "@/components/role-portals/RolePortals.module.css";
import { requirePagePermission } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getReceivingWorkspace } from "@/lib/role-portals-repository";
import {
  formatRolePortalDateTime,
  formatRolePortalNumber,
  formatRolePortalStatus,
  rolePortalMessages,
} from "@/lib/role-portals-i18n";
import { confirmReceiptAction } from "./actions";

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("view_receiving");
  const [jobs, params] = await Promise.all([getReceivingWorkspace(actor), searchParams]);
  const locale = actor.preferredLocale ?? "en";
  const copy = rolePortalMessages(locale).receiving;
  const canConfirm = canAccess(actor, "confirm_receipts");
  const open = jobs.filter((job) => !job.receiptId);
  return (
    <>
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      {params.notice === "receipt-confirmed" ? <p className="form-success" role="status">{copy.receiptConfirmedNotice}</p> : null}
      <section className={styles.metrics} aria-label={copy.summaryLabel}>
        <div><span>{copy.deliveredJobs}</span><strong>{formatRolePortalNumber(jobs.length, locale)}</strong></div>
        <div><span>{copy.awaitingConfirmation}</span><strong>{formatRolePortalNumber(open.length, locale)}</strong></div>
        <div><span>{copy.confirmed}</span><strong>{formatRolePortalNumber(jobs.length - open.length, locale)}</strong></div>
      </section>
      {jobs.length === 0 ? <section className={`${styles.empty} panel`}><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p></section> : (
        <div className={styles.cardList}>
          {jobs.map((job) => (
            <article className={styles.workCard} key={job.id}>
              <header className={styles.cardHeader}>
                <div><span className={styles.reference}>{job.jobCode}</span><h2>{job.branchName}</h2></div>
                <StatusBadge>{formatRolePortalStatus(job.receiptId ? "CONFIRMED" : "AWAITING_CONFIRMATION", locale)}</StatusBadge>
              </header>
              <p className={styles.deliveryTime}>{copy.driverRecorded} <strong>{formatRolePortalStatus(job.driverEventType, locale)} · {formatRolePortalDateTime(job.deliveredAt, locale, copy.awaitingDriverEvent, actor.timezone)}</strong></p>
              {job.driverReportedReceiverName ? <div className={styles.driverEvidence}><strong>{copy.driverReportedReceiver}: {job.driverReportedReceiverName}</strong><span>{copy.driverEvidenceOnly}</span></div> : null}
              {job.receiptId ? (
                <div className={styles.confirmedReceipt}><strong>{copy.receiptComplete}</strong><span>{copy.receiptId} {job.receiptId}</span></div>
              ) : !canConfirm ? (
                <div className={styles.specification}><strong>{copy.readOnlyTitle}</strong><p>{copy.readOnlyBody}</p></div>
              ) : (
                <form action={confirmReceiptAction} className={styles.receiptForm}>
                  <input type="hidden" name="deliveryJobId" value={job.id} />
                  <div className={styles.receiptIntro}><strong>{copy.inspectLines(job.lines.length)}</strong><span>{copy.quantityRule}</span><span>{copy.confirmingAs(actor.name)}</span></div>
                  <div className={styles.receiptLines}>
                    {job.lines.map((line) => (
                      <fieldset key={line.id}>
                        <legend>{line.productName}</legend>
                        <input type="hidden" name="deliveryJobLineId" value={line.id} />
                        <input type="hidden" name="requestLineId" value={line.requestLineId} />
                        <p>{copy.planned}: <strong>{formatRolePortalNumber(line.plannedQuantity, locale)} {line.unit}</strong>{line.driverReportedDeliveredQuantity !== undefined ? <> · {copy.driverReportedQuantity}: <strong>{formatRolePortalNumber(line.driverReportedDeliveredQuantity, locale)} {line.unit}</strong>{line.driverReportedMissingQuantity ? <> · {formatRolePortalNumber(line.driverReportedMissingQuantity, locale)} {copy.missing}</> : null}</> : null}</p>
                        <div className={styles.lineQuantities}>
                          <label>{copy.delivered}<input name="deliveredQuantity" type="number" min="0" step="0.001" required defaultValue={line.driverReportedDeliveredQuantity ?? line.plannedQuantity} /></label>
                          <label>{copy.accepted}<input name="acceptedQuantity" type="number" min="0" step="0.001" required defaultValue={Math.max((line.driverReportedDeliveredQuantity ?? line.plannedQuantity) - (line.driverReportedDamagedQuantity ?? 0), 0)} /></label>
                          <label>{copy.damaged}<input name="damagedQuantity" type="number" min="0" step="0.001" required defaultValue={line.driverReportedDamagedQuantity ?? 0} /></label>
                        </div>
                        <div className={styles.lineClassification}>
                          <label>{copy.inspectionClassification}<select name="discrepancyCode" defaultValue="NONE"><option value="NONE">{copy.noManualException}</option><option value="WRONG_ITEM">{copy.wrongItem}</option><option value="QUALITY">{copy.qualityIssue}</option><option value="OTHER">{copy.otherException}</option></select></label>
                          <label>{copy.lineNote}<input name="discrepancyNote" maxLength={2000} placeholder={copy.discrepancyPlaceholder} /></label>
                        </div>
                      </fieldset>
                    ))}
                  </div>
                  <label>{copy.receiptNotes}<textarea name="notes" maxLength={2000} placeholder={copy.receiptNotesPlaceholder} /></label>
                  <div className={styles.receiptSubmit}><p>{copy.confirmationExplanation}</p><button className="button button-primary" type="submit">{copy.confirmReceipt}</button></div>
                </form>
              )}
            </article>
          ))}
        </div>
      )}
      <ReceivingOtpPanel locale={locale} />
    </>
  );
}

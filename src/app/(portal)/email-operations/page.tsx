import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { getEmailOperationsWorkspace } from "@/lib/email-operations";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { performEmailOperationAction } from "./actions";

const text = {
  en: { eyebrow: "Administration", title: "Email Status", description: "A concise view of email delivery health and safe retries.", service: "Email service status", active: "Active", problem: "Problem", yes: "Yes", no: "No", domain: "Domain verified", webhook: "Webhook verified", usage: "Current month usage", limit: "Monthly limit", used: "Used", remaining: "Remaining", queue: "Queue summary", pending: "Pending", retrying: "Retrying", failed: "Failed", recent: "Recent failed emails", date: "Date/time", type: "Email type", recipient: "Recipient", status: "Status", retry: "Retry", empty: "No failed or retrying emails.", success: "Retry requested.", denied: "The retry was unavailable." },
  ar: { eyebrow: "الإدارة", title: "حالة البريد الإلكتروني", description: "عرض موجز لصحة تسليم البريد وإعادات المحاولة الآمنة.", service: "حالة خدمة البريد", active: "نشطة", problem: "مشكلة", yes: "نعم", no: "لا", domain: "تم التحقق من النطاق", webhook: "تم التحقق من Webhook", usage: "استخدام الشهر الحالي", limit: "الحد الشهري", used: "المستخدم", remaining: "المتبقي", queue: "ملخص الطابور", pending: "معلق", retrying: "قيد الإعادة", failed: "فشل", recent: "رسائل فاشلة حديثة", date: "التاريخ والوقت", type: "نوع البريد", recipient: "المستلم", status: "الحالة", retry: "إعادة المحاولة", empty: "لا توجد رسائل فاشلة أو قيد الإعادة.", success: "تم طلب إعادة المحاولة.", denied: "إعادة المحاولة غير متاحة." },
  ms: { eyebrow: "Pentadbiran", title: "Status E-mel", description: "Paparan ringkas kesihatan penghantaran e-mel dan cubaan semula selamat.", service: "Status perkhidmatan e-mel", active: "Aktif", problem: "Masalah", yes: "Ya", no: "Tidak", domain: "Domain disahkan", webhook: "Webhook disahkan", usage: "Penggunaan bulan semasa", limit: "Had bulanan", used: "Digunakan", remaining: "Baki", queue: "Ringkasan giliran", pending: "Tertunda", retrying: "Mencuba semula", failed: "Gagal", recent: "E-mel gagal terkini", date: "Tarikh/masa", type: "Jenis e-mel", recipient: "Penerima", status: "Status", retry: "Cuba semula", empty: "Tiada e-mel gagal atau sedang dicuba semula.", success: "Cubaan semula diminta.", denied: "Cubaan semula tidak tersedia." },
} as const;

export default async function EmailStatusPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requirePagePermission("view_email_operations");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = text[locale];
  const [workspace, query] = await Promise.all([getEmailOperationsWorkspace(actor, {}), searchParams]);
  const number = new Intl.NumberFormat(locale);
  const monthlyLimit = Number(process.env.AXORA_EMAIL_PERIOD_RECIPIENT_QUOTA ?? "");
  const validLimit = Number.isSafeInteger(monthlyLimit) && monthlyLimit > 0;
  const used = workspace.metrics.monthlyRecipientUnits;
  const recent = workspace.records.filter((record) => record.status === "FAILED" || record.retryable).slice(0, 20);
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: actor.timezone ?? "Asia/Kuala_Lumpur" }).format(new Date(value));
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    {query.notice ? <div className={query.notice === "success" ? "form-success" : "form-alert"} role="status">{query.notice === "success" ? copy.success : copy.denied}</div> : null}
    <section className="detail-grid">
      <article className="panel"><h2>{copy.service}</h2><dl className="summary-list"><div><dt>Resend</dt><dd>{workspace.providerRuntime.state === "FULLY_ENABLED" ? copy.active : copy.problem}</dd></div><div><dt>{copy.domain}</dt><dd>{workspace.providerRuntime.domainVerified ? copy.yes : copy.no}</dd></div><div><dt>{copy.webhook}</dt><dd>{workspace.providerRuntime.webhookVerified ? copy.yes : copy.no}</dd></div></dl></article>
      <article className="panel"><h2>{copy.usage}</h2><dl className="summary-list"><div><dt>{copy.limit}</dt><dd>{validLimit ? number.format(monthlyLimit) : "—"}</dd></div><div><dt>{copy.used}</dt><dd>{number.format(used)}</dd></div><div><dt>{copy.remaining}</dt><dd>{validLimit ? number.format(Math.max(0, monthlyLimit - used)) : "—"}</dd></div></dl></article>
      <article className="panel"><h2>{copy.queue}</h2><dl className="summary-list"><div><dt>{copy.pending}</dt><dd>{number.format(workspace.metrics.queueDepth)}</dd></div><div><dt>{copy.retrying}</dt><dd>{number.format(workspace.metrics.retries)}</dd></div><div><dt>{copy.failed}</dt><dd>{number.format(workspace.metrics.permanentFailures)}</dd></div></dl></article>
    </section>
    <section className="panel"><div className="panel-header"><div><h2>{copy.recent}</h2><p>{recent.length}/20</p></div></div>{recent.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.date}</th><th>{copy.type}</th><th>{copy.recipient}</th><th>{copy.status}</th><th /></tr></thead><tbody>{recent.map((record) => <tr key={`${record.deliveryKind}:${record.deliveryId}`}><td>{formatTime(record.createdAt)}</td><td>{record.templateKey}</td><td><bdi dir="ltr">{record.maskedRecipient}</bdi></td><td>{record.status}</td><td>{record.retryable ? <form action={performEmailOperationAction}><input type="hidden" name="commandId" value={randomUUID()} /><input type="hidden" name="action" value="RETRY" /><input type="hidden" name="deliveryKind" value={record.deliveryKind} /><input type="hidden" name="deliveryId" value={record.deliveryId} /><button className="button button-secondary" type="submit">{copy.retry}</button></form> : null}</td></tr>)}</tbody></table></div> : <p>{copy.empty}</p>}</section>
  </>;
}

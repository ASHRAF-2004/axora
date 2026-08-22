import { requirePagePermission } from "@/lib/auth";
import { getEmailOperationsWorkspace, resendPlanConfiguration, type EmailOperationsRecord } from "@/lib/email-operations";
import { AlertTriangle, CheckCircle2, Clock3, Gauge, Inbox, Mail, RotateCcw, ShieldCheck, Webhook, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { performEmailOperationAction } from "./actions";
import styles from "./EmailOperations.module.css";
import { RetryButton } from "./RetryButton";

const text = {
  en: {
    eyebrow: "Administration", title: "Email Status", description: "Resend delivery health, Axora-tracked usage and safe retries.", operational: "All systems operational", attention: "Attention required", service: "Service health", active: "Active", problem: "Problem", delivery: "Delivery enabled", domain: "Domain verified", webhook: "Webhook verified", yes: "Verified", no: "Not verified", planQuota: "Axora-tracked email usage", free: "Free plan", paid: "Paid plan", monthly: "Monthly usage", daily: "Daily usage", used: "used", remaining: "Remaining", noDaily: "No daily limit", source: "Tracked from emails successfully sent through Axora.", limitation: "Emails sent directly from Resend or received outside Axora are not included.", currentMonth: "Current month", currentDay: "Current day", lastCounted: "Last counted email", openingRecorded: "Opening usage recorded", resetsMonthly: "Resets monthly", resetsDaily: "Resets daily", within: "Within limit", approaching: "Approaching limit", warning: "Warning", reached: "Limit reached", pending: "Pending", retrying: "Retrying", failed: "Failed", queue: "Queue summary", recent: "Recent failed emails", date: "Date/time", type: "Email type", recipient: "Recipient", status: "Status", retry: "Retry", retryPending: "Retry requested", empty: "No failed emails", success: "Retry requested.", denied: "The retry was unavailable.", showing: "Showing up to 20 retry-safe records",
    types: { invitation: "User invitation", password: "Password reset", request: "Request update", invoice: "Invoice ready", delivery: "Delivery update", other: "Operational email" }, statuses: { failed: "Failed", retrying: "Retrying", pending: "Pending", uncertain: "Needs review" },
  },
  ar: {
    eyebrow: "الإدارة", title: "حالة البريد الإلكتروني", description: "صحة تسليم Resend والاستخدام الذي تتعقبه Axora وإعادات المحاولة الآمنة.", operational: "جميع الأنظمة تعمل", attention: "تحتاج إلى الانتباه", service: "صحة الخدمة", active: "نشطة", problem: "توجد مشكلة", delivery: "التسليم مفعّل", domain: "تم التحقق من النطاق", webhook: "تم التحقق من Webhook", yes: "تم التحقق", no: "لم يتم التحقق", planQuota: "استخدام البريد الذي تتعقبه Axora", free: "الخطة المجانية", paid: "الخطة المدفوعة", monthly: "الاستخدام الشهري", daily: "الاستخدام اليومي", used: "مستخدم", remaining: "المتبقي", noDaily: "لا يوجد حد يومي", source: "يُحتسب من الرسائل المرسلة بنجاح عبر Axora.", limitation: "لا يشمل الرسائل المرسلة مباشرةً من Resend أو المستلمة خارج Axora.", currentMonth: "الشهر الحالي", currentDay: "اليوم الحالي", lastCounted: "آخر رسالة محتسبة", openingRecorded: "تم تسجيل الاستخدام الافتتاحي", resetsMonthly: "يُعاد شهرياً", resetsDaily: "يُعاد يومياً", within: "ضمن الحد", approaching: "يقترب من الحد", warning: "تحذير", reached: "تم بلوغ الحد", pending: "معلّق", retrying: "قيد إعادة المحاولة", failed: "فشل", queue: "ملخص قائمة الانتظار", recent: "رسائل فاشلة حديثة", date: "التاريخ والوقت", type: "نوع البريد", recipient: "المستلم", status: "الحالة", retry: "إعادة المحاولة", retryPending: "تم طلب إعادة المحاولة", empty: "لا توجد رسائل فاشلة", success: "تم طلب إعادة المحاولة.", denied: "إعادة المحاولة غير متاحة.", showing: "عرض ما يصل إلى 20 سجلاً آمناً لإعادة المحاولة",
    types: { invitation: "دعوة مستخدم", password: "إعادة تعيين كلمة المرور", request: "تحديث الطلب", invoice: "الفاتورة جاهزة", delivery: "تحديث التسليم", other: "بريد تشغيلي" }, statuses: { failed: "فشل", retrying: "قيد إعادة المحاولة", pending: "معلّق", uncertain: "يحتاج إلى مراجعة" },
  },
  ms: {
    eyebrow: "Pentadbiran", title: "Status E-mel", description: "Kesihatan penghantaran Resend, penggunaan yang dijejak Axora dan cubaan semula selamat.", operational: "Semua sistem beroperasi", attention: "Perhatian diperlukan", service: "Kesihatan perkhidmatan", active: "Aktif", problem: "Bermasalah", delivery: "Penghantaran diaktifkan", domain: "Domain disahkan", webhook: "Webhook disahkan", yes: "Disahkan", no: "Belum disahkan", planQuota: "Penggunaan e-mel dijejak Axora", free: "Pelan percuma", paid: "Pelan berbayar", monthly: "Penggunaan bulanan", daily: "Penggunaan harian", used: "digunakan", remaining: "Baki", noDaily: "Tiada had harian", source: "Dijejak daripada e-mel yang berjaya dihantar melalui Axora.", limitation: "E-mel yang dihantar terus dari Resend atau diterima di luar Axora tidak disertakan.", currentMonth: "Bulan semasa", currentDay: "Hari semasa", lastCounted: "E-mel terakhir dikira", openingRecorded: "Penggunaan pembukaan direkodkan", resetsMonthly: "Ditetapkan semula setiap bulan", resetsDaily: "Ditetapkan semula setiap hari", within: "Dalam had", approaching: "Menghampiri had", warning: "Amaran", reached: "Had dicapai", pending: "Tertunda", retrying: "Mencuba semula", failed: "Gagal", queue: "Ringkasan giliran", recent: "E-mel gagal terkini", date: "Tarikh/masa", type: "Jenis e-mel", recipient: "Penerima", status: "Status", retry: "Cuba semula", retryPending: "Cubaan semula diminta", empty: "Tiada e-mel gagal", success: "Cubaan semula diminta.", denied: "Cubaan semula tidak tersedia.", showing: "Memaparkan sehingga 20 rekod yang selamat dicuba semula",
    types: { invitation: "Jemputan pengguna", password: "Tetapan semula kata laluan", request: "Kemas kini permintaan", invoice: "Invois tersedia", delivery: "Kemas kini penghantaran", other: "E-mel operasi" }, statuses: { failed: "Gagal", retrying: "Mencuba semula", pending: "Tertunda", uncertain: "Perlu semakan" },
  },
} as const;

type Copy = (typeof text)[keyof typeof text];
type QuotaState = "within" | "approaching" | "warning" | "reached";

function quotaState(used: number, limit: number): QuotaState {
  const ratio = used / limit;
  if (ratio >= 1) return "reached";
  if (ratio >= 0.9) return "warning";
  if (ratio >= 0.7) return "approaching";
  return "within";
}

function friendlyType(record: EmailOperationsRecord, copy: Copy) {
  const key = `${record.eventKey} ${record.templateKey}`.toLowerCase();
  if (key.includes("invitation") || key.includes("account-setup")) return copy.types.invitation;
  if (key.includes("password")) return copy.types.password;
  if (key.includes("invoice")) return copy.types.invoice;
  if (key.includes("delivery")) return copy.types.delivery;
  if (key.includes("request") || key.includes("approval")) return copy.types.request;
  return copy.types.other;
}

function readableStatus(record: EmailOperationsRecord, copy: Copy) {
  if (record.status === "UNCERTAIN") return copy.statuses.uncertain;
  if (record.retryable) return copy.statuses.retrying;
  if (record.status === "FAILED") return copy.statuses.failed;
  return copy.statuses.pending;
}

function QuotaRow({ label, used, limit, copy, number }: { label: string; used: number; limit: number; copy: Copy; number: Intl.NumberFormat }) {
  const state = quotaState(used, limit);
  const percentage = used / limit * 100;
  const percentageLabel = percentage < 10 ? `${percentage.toFixed(1)}%` : `${Math.round(percentage)}%`;
  return <div className={styles.quotaRow} data-state={state}>
    <div className={styles.quotaHeading}><div><span className={styles.quotaLabel}>{label}</span><strong><bdi dir="ltr">{number.format(used)} / {number.format(limit)}</bdi></strong></div><span className={styles.quotaState}>{copy[state]}</span></div>
    <progress className={styles.progress} max={limit} value={Math.min(used, limit)} aria-label={`${label}: ${number.format(used)} ${copy.used}, ${number.format(limit)}`} />
    <div className={styles.quotaMeta}><span><bdi dir="ltr">{percentageLabel}</bdi></span><span>{copy.remaining}: <bdi dir="ltr">{number.format(Math.max(0, limit - used))}</bdi></span></div>
  </div>;
}

export default async function EmailStatusPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requirePagePermission("view_email_operations");
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const copy = text[locale];
  const [workspace, query] = await Promise.all([getEmailOperationsWorkspace(actor, {}), searchParams]);
  const configuredPlan = resendPlanConfiguration();
  const usage = workspace.trackedUsage;
  const monthlyLimit = configuredPlan.monthlyLimit;
  const dailyLimit = configuredPlan.dailyLimit;
  const plan = configuredPlan.plan;
  const serviceHealthy = workspace.providerRuntime.state === "FULLY_ENABLED";
  const quotaConcern = quotaState(usage.monthlyUsed, monthlyLimit) !== "within"
    || (dailyLimit !== undefined && quotaState(usage.dailyUsed, dailyLimit) !== "within");
  const needsAttention = !serviceHealthy || workspace.metrics.permanentFailures > 0 || quotaConcern;
  const number = new Intl.NumberFormat(locale);
  const formatTime = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: actor.timezone ?? "Asia/Kuala_Lumpur" }).format(new Date(value));
  const recent = workspace.records.filter((record) => record.status === "FAILED" || record.status === "UNCERTAIN" || record.retryable).slice(0, 20);
  const retrying = workspace.agents.reduce((sum, agent) => sum + agent.retrying, 0);
  const healthChecks: Array<{ label: string; healthy: boolean; icon: LucideIcon }> = [
    { label: copy.delivery, healthy: workspace.providerRuntime.deliveryEnabled, icon: Mail },
    { label: copy.domain, healthy: workspace.providerRuntime.domainVerified, icon: ShieldCheck },
    { label: copy.webhook, healthy: workspace.providerRuntime.webhookVerified, icon: Webhook },
  ];

  return <div className={styles.workspace}>
    <header className={styles.pageHeader}><div><p className={styles.eyebrow}>{copy.eyebrow}</p><h1>{copy.title}</h1><p className={styles.description}>{copy.description}</p></div><div className={styles.headerStatus} data-tone={needsAttention ? "warning" : "success"}>{needsAttention ? <AlertTriangle size={18} aria-hidden="true" /> : <CheckCircle2 size={18} aria-hidden="true" />}<span>{needsAttention ? copy.attention : copy.operational}</span></div></header>
    {query.notice ? <div className={query.notice === "success" ? styles.noticeSuccess : styles.noticeError} role="status">{query.notice === "success" ? copy.success : copy.denied}</div> : null}

    <section className={styles.summaryGrid} aria-label={copy.service}>
      <article className={styles.card}>
        <div className={styles.cardHeader}><div className={styles.titleGroup}><span className={styles.iconBox}><Mail size={20} aria-hidden="true" /></span><div><p>{copy.service}</p><h2><bdi dir="ltr">Resend</bdi></h2></div></div><span className={styles.badge} data-tone={serviceHealthy ? "success" : "danger"}>{serviceHealthy ? copy.active : copy.problem}</span></div>
        <div className={styles.healthRows}>{healthChecks.map(({ label, healthy, icon: Icon }) => <div className={styles.healthRow} key={label}><span><Icon size={17} aria-hidden="true" />{label}</span><span className={styles.healthValue} data-ok={String(healthy)}>{healthy ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}{healthy ? copy.yes : copy.no}</span></div>)}</div>
      </article>
      <article className={styles.card}>
        <div className={styles.cardHeader}><div className={styles.titleGroup}><span className={styles.iconBox}><Gauge size={20} aria-hidden="true" /></span><div><p>{copy.planQuota}</p><h2><bdi dir="ltr">Resend Transactional</bdi></h2></div></div><span className={styles.planBadge}><bdi dir="ltr">{plan}</bdi><span className="sr-only"> {plan === "FREE" ? copy.free : copy.paid}</span></span></div>
        <div className={styles.quotaList}><QuotaRow label={copy.monthly} used={usage.monthlyUsed} limit={monthlyLimit} copy={copy} number={number} />{dailyLimit !== undefined ? <QuotaRow label={copy.daily} used={usage.dailyUsed} limit={dailyLimit} copy={copy} number={number} /> : <div className={styles.noDaily}><span>{copy.daily}</span><strong>{copy.noDaily}</strong></div>}<div className={styles.usageContext}><span>{copy.currentMonth}: <bdi dir="ltr">{usage.monthStart}</bdi> · {copy.resetsMonthly}</span><span>{copy.currentDay}: <bdi dir="ltr">{usage.dayStart}</bdi> · {copy.resetsDaily}</span></div><div className={styles.syncTime}><Clock3 size={16} aria-hidden="true" /><span>{usage.lastCountedAt || !usage.openingApplies ? copy.lastCounted : copy.openingRecorded}: {usage.lastRecordedAt ? <time dateTime={usage.lastRecordedAt}>{formatTime(usage.lastRecordedAt)}</time> : "—"}</span></div><div className={styles.usageDisclosure}><strong>{copy.source}</strong><span>{copy.limitation}</span><small><bdi dir="ltr">UTC</bdi></small></div></div>
      </article>
    </section>

    <section aria-labelledby="queue-title"><div className={styles.sectionHeading}><h2 id="queue-title">{copy.queue}</h2></div><div className={styles.metricGrid}><article className={styles.metricCard}><span className={styles.metricIcon}><Inbox size={19} aria-hidden="true" /></span><div><p>{copy.pending}</p><strong><bdi dir="ltr">{number.format(workspace.metrics.queueDepth)}</bdi></strong></div></article><article className={styles.metricCard}><span className={styles.metricIcon}><RotateCcw size={19} aria-hidden="true" /></span><div><p>{copy.retrying}</p><strong><bdi dir="ltr">{number.format(retrying)}</bdi></strong></div></article><article className={styles.metricCard} data-tone={workspace.metrics.permanentFailures > 0 ? "danger" : "neutral"}><span className={styles.metricIcon}><XCircle size={19} aria-hidden="true" /></span><div><p>{copy.failed}</p><strong><bdi dir="ltr">{number.format(workspace.metrics.permanentFailures)}</bdi></strong></div></article></div></section>

    <section className={styles.tableCard} aria-labelledby="failures-title"><div className={styles.tableHeader}><div><h2 id="failures-title">{copy.recent}</h2><p>{copy.showing}</p></div><span><bdi dir="ltr">{recent.length} / 20</bdi></span></div>{recent.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>{copy.date}</th><th>{copy.type}</th><th>{copy.recipient}</th><th>{copy.status}</th><th><span className={`sr-only ${styles.tableRetryLabel}`}>{copy.retry}</span></th></tr></thead><tbody>{recent.map((record) => <tr key={`${record.deliveryKind}:${record.deliveryId}`}><td data-label={copy.date}><time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time></td><td data-label={copy.type}>{friendlyType(record, copy)}</td><td data-label={copy.recipient}><bdi dir="ltr" className={styles.recipient}>{record.maskedRecipient}</bdi></td><td data-label={copy.status}><span className={styles.badge} data-tone={record.retryable ? "warning" : "danger"}>{readableStatus(record, copy)}</span></td><td data-label={copy.retry}>{record.retryable ? <form action={performEmailOperationAction}><input type="hidden" name="commandId" value={randomUUID()} /><input type="hidden" name="action" value="RETRY" /><input type="hidden" name="deliveryKind" value={record.deliveryKind} /><input type="hidden" name="deliveryId" value={record.deliveryId} /><RetryButton label={copy.retry} pendingLabel={copy.retryPending} /></form> : null}</td></tr>)}</tbody></table></div> : <div className={styles.emptyState}><CheckCircle2 size={26} aria-hidden="true" /><strong>{copy.empty}</strong></div>}</section>
  </div>;
}

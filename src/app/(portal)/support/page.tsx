import { PageHeader } from "@/components/PageHeader";
import { SupportAccountDiagnostics } from "@/components/SupportAccountDiagnostics";
import { requirePagePermission } from "@/lib/auth";
import { getSupportSystemSummary } from "@/lib/support-diagnostics";
import { Activity, BellRing, Database, MailWarning, ShieldCheck, UsersRound } from "lucide-react";

const copy = {
  en: {
    eyebrow: "Audited support workspace",
    title: "System and account diagnostics",
    description: "Check platform readiness and investigate one exact account without entering commercial workflows or exposing private records.",
    boundary: "Support boundary",
    boundaryBody: "Technical support cannot approve requests, change pricing, manage suppliers, edit finance records, or browse tenant business data. Every account lookup and session action records an operator reason.",
    database: "Database",
    databaseBody: "Connected and responding",
    migration: "Latest migration",
    sessions: "Active sessions",
    invitations: "Pending invitations",
    email: "Email exceptions",
    workflow: "Workflow exceptions",
    checked: "Checked",
    revoked: "Active sessions were revoked and the account session version was rotated.",
    denied: "The session action was refused. Platform accounts and the current support account remain protected.",
  },
  ar: {
    eyebrow: "مساحة دعم مدققة",
    title: "تشخيص النظام والحسابات",
    description: "تحقق من جاهزية المنصة وحقق في حساب دقيق واحد دون الدخول في مسارات العمل التجارية أو كشف السجلات الخاصة.",
    boundary: "حدود الدعم",
    boundaryBody: "لا يمكن للدعم التقني اعتماد الطلبات أو تغيير الأسعار أو إدارة الموردين أو تعديل السجلات المالية أو تصفح بيانات أعمال الشركات. تسجّل كل عملية بحث وإجراء جلسة مع سبب المشغّل.",
    database: "قاعدة البيانات",
    databaseBody: "متصلة وتستجيب",
    migration: "آخر ترحيل",
    sessions: "الجلسات النشطة",
    invitations: "الدعوات المعلقة",
    email: "استثناءات البريد",
    workflow: "استثناءات سير العمل",
    checked: "وقت الفحص",
    revoked: "أُلغيت الجلسات النشطة ودُوّر إصدار جلسة الحساب.",
    denied: "رُفض إجراء الجلسة. تظل حسابات المنصة وحساب الدعم الحالي محمية.",
  },
  ms: {
    eyebrow: "Ruang sokongan diaudit",
    title: "Diagnostik sistem dan akaun",
    description: "Semak kesiapsiagaan platform dan siasat satu akaun tepat tanpa memasuki aliran kerja komersial atau mendedahkan rekod peribadi.",
    boundary: "Sempadan sokongan",
    boundaryBody: "Sokongan teknikal tidak boleh meluluskan permintaan, mengubah harga, mengurus pembekal, menyunting rekod kewangan atau melayari data perniagaan penyewa. Setiap carian akaun dan tindakan sesi merekodkan sebab pengendali.",
    database: "Pangkalan data",
    databaseBody: "Bersambung dan bertindak balas",
    migration: "Migrasi terkini",
    sessions: "Sesi aktif",
    invitations: "Jemputan belum selesai",
    email: "Pengecualian e-mel",
    workflow: "Pengecualian aliran kerja",
    checked: "Disemak",
    revoked: "Sesi aktif dibatalkan dan versi sesi akaun diputar.",
    denied: "Tindakan sesi ditolak. Akaun platform dan akaun sokongan semasa kekal dilindungi.",
  },
} as const;

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; count?: string }>;
}) {
  const actor = await requirePagePermission("view_system_diagnostics");
  const locale = actor.preferredLocale ?? "en";
  const messages = copy[locale];
  const summary = await getSupportSystemSummary(actor);
  const { notice } = await searchParams;
  const checkedAt = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: actor.timezone ?? "Asia/Kuala_Lumpur",
  }).format(new Date(summary.checkedAt));

  return <>
    <PageHeader eyebrow={messages.eyebrow} title={messages.title} description={messages.description} />
    {notice === "sessions-revoked" ? <div className="callout callout-success" role="status">{messages.revoked}</div> : null}
    {notice === "session-action-denied" ? <div className="callout callout-warning" role="alert">{messages.denied}</div> : null}

    <section className="metric-grid" data-tour="system-health">
      <article className="metric-card metric-teal">
        <span className="metric-icon"><Database aria-hidden="true" /></span>
        <p className="metric-label">{messages.database}</p>
        <strong className="metric-value">{messages.databaseBody}</strong>
        <small className="metric-note">{messages.checked}: {checkedAt}</small>
      </article>
      <article className="metric-card metric-blue">
        <span className="metric-icon"><ShieldCheck aria-hidden="true" /></span>
        <p className="metric-label">{messages.migration}</p>
        <strong className="metric-value">{summary.latestMigration}</strong>
      </article>
      <article className="metric-card metric-blue">
        <span className="metric-icon"><UsersRound aria-hidden="true" /></span>
        <p className="metric-label">{messages.sessions}</p>
        <strong className="metric-value">{new Intl.NumberFormat(locale).format(summary.activeSessions)}</strong>
      </article>
      <article className="metric-card metric-orange">
        <span className="metric-icon"><BellRing aria-hidden="true" /></span>
        <p className="metric-label">{messages.invitations}</p>
        <strong className="metric-value">{new Intl.NumberFormat(locale).format(summary.pendingInvitations)}</strong>
      </article>
      <article className="metric-card metric-orange">
        <span className="metric-icon"><MailWarning aria-hidden="true" /></span>
        <p className="metric-label">{messages.email}</p>
        <strong className="metric-value">{new Intl.NumberFormat(locale).format(summary.emailExceptions)}</strong>
      </article>
      <article className="metric-card metric-orange">
        <span className="metric-icon"><Activity aria-hidden="true" /></span>
        <p className="metric-label">{messages.workflow}</p>
        <strong className="metric-value">{new Intl.NumberFormat(locale).format(summary.workflowExceptions)}</strong>
      </article>
    </section>

    <div className="callout" data-tour="support-boundary"><ShieldCheck size={19} aria-hidden="true" /><div><strong>{messages.boundary}</strong><p>{messages.boundaryBody}</p></div></div>
    <SupportAccountDiagnostics locale={locale} timezone={actor.timezone ?? "Asia/Kuala_Lumpur"} />
  </>;
}

import { performEmailOperationAction } from "./actions";
import styles from "./EmailOperations.module.css";
import { EmailRecipientReveal } from "@/components/EmailRecipientReveal";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import {
  EMAIL_DELIVERY_STATUSES,
  EMAIL_PROVIDER_AGENTS,
  getEmailOperationsWorkspace,
  normalizeEmailOperationsFilters,
} from "@/lib/email-operations";
import { emailOperationsMessages } from "@/lib/email-operations-i18n";
import { AlertTriangle, ExternalLink, MailCheck, ShieldCheck } from "lucide-react";
import { randomUUID } from "node:crypto";
import Link from "next/link";

function formatDateTime(
  value: string | undefined,
  locale: string,
  timeZone: string,
) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

function statusLabel(value: string, locale: "en" | "ar" | "ms") {
  const labels = {
    en: { PENDING: "Pending", SENDING: "Sending", SENT: "Sent", FAILED: "Failed", DISABLED: "Disabled", UNCERTAIN: "Uncertain", CANCELLED: "Cancelled" },
    ar: { PENDING: "معلق", SENDING: "قيد الإرسال", SENT: "مرسل", FAILED: "فشل", DISABLED: "معطل", UNCERTAIN: "غير مؤكد", CANCELLED: "ملغي" },
    ms: { PENDING: "Tertunda", SENDING: "Menghantar", SENT: "Dihantar", FAILED: "Gagal", DISABLED: "Dilumpuhkan", UNCERTAIN: "Tidak pasti", CANCELLED: "Dibatalkan" },
  } as const;
  return labels[locale][value as keyof (typeof labels)["en"]]
    ?? value.replaceAll("_", " ");
}

function readinessStateLabel(value: string, locale: "en" | "ar" | "ms") {
  const labels = {
    en: { DELIVERY_DISABLED: "Delivery disabled", WEBHOOK_BOOTSTRAP: "Webhook bootstrap", SIGNED_WEBHOOK_CONFIGURED: "Signed webhook configured", ACCOUNT_REVIEW_PENDING: "Account review pending", READY_FOR_CONTROLLED_SEND: "Ready for controlled send", FULLY_ENABLED: "Fully enabled", MISCONFIGURED: "Misconfigured" },
    ar: { DELIVERY_DISABLED: "التسليم معطل", WEBHOOK_BOOTSTRAP: "تهيئة Webhook الأولية", SIGNED_WEBHOOK_CONFIGURED: "Webhook موقّع مهيأ", ACCOUNT_REVIEW_PENDING: "مراجعة الحساب معلقة", READY_FOR_CONTROLLED_SEND: "جاهز لإرسال مضبوط", FULLY_ENABLED: "مفعّل بالكامل", MISCONFIGURED: "تهيئة غير صحيحة" },
    ms: { DELIVERY_DISABLED: "Penghantaran dilumpuhkan", WEBHOOK_BOOTSTRAP: "Bootstrap webhook", SIGNED_WEBHOOK_CONFIGURED: "Webhook bertandatangan dikonfigurasi", ACCOUNT_REVIEW_PENDING: "Semakan akaun belum selesai", READY_FOR_CONTROLLED_SEND: "Sedia untuk penghantaran terkawal", FULLY_ENABLED: "Didayakan sepenuhnya", MISCONFIGURED: "Salah konfigurasi" },
  } as const;
  return labels[locale][value as keyof (typeof labels)["en"]] ?? value.replaceAll("_", " ");
}

export default async function EmailOperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("view_email_operations");
  const locale = actor.preferredLocale ?? "en";
  const messages = emailOperationsMessages(locale);
  const rawFilters = await searchParams;
  const filters = normalizeEmailOperationsFilters(rawFilters);
  const workspace = await getEmailOperationsWorkspace(actor, rawFilters);
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const number = new Intl.NumberFormat(locale);
  const offset = Number(filters.offset ?? 0);
  const baseSearch = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "offset" && value) baseSearch.set(key, value);
  }
  const previousSearch = new URLSearchParams(baseSearch);
  previousSearch.set("offset", String(Math.max(0, offset - 100)));
  const nextSearch = new URLSearchParams(baseSearch);
  nextSearch.set("offset", String(offset + 100));
  const metricCards = [
    [messages.created, workspace.metrics.created],
    [messages.submitted, workspace.metrics.submitted],
    [messages.delivered, workspace.metrics.delivered],
    [messages.queued, workspace.metrics.queueDepth, `${messages.oldest}: ${formatDateTime(workspace.metrics.oldestQueuedAt, locale, timeZone)}`],
    [messages.retries, workspace.metrics.retries],
    [messages.failures, workspace.metrics.permanentFailures],
    [messages.bounces, `${number.format(workspace.metrics.hardBounces)} / ${number.format(workspace.metrics.softBounces)}`],
    [messages.complaints, workspace.metrics.complaints],
    [messages.suppressions, workspace.metrics.suppressedRecipients],
    [messages.invalid, workspace.metrics.invalidRecipients],
    [messages.usage, `${number.format(workspace.metrics.dailyRecipientUnits)} / ${number.format(workspace.metrics.monthlyRecipientUnits)}`],
    [messages.webhookFailures, workspace.metrics.webhookFailures],
  ] as const;
  const notice = typeof rawFilters.notice === "string" ? rawFilters.notice : undefined;
  const configuredQuota = Number(process.env.AXORA_EMAIL_PERIOD_RECIPIENT_QUOTA ?? "");
  const hasConfiguredQuota = Number.isSafeInteger(configuredQuota) && configuredQuota > 0;
  const quotaUsed = workspace.metrics.monthlyRecipientUnits;
  const quotaRemaining = hasConfiguredQuota ? Math.max(0, configuredQuota - quotaUsed) : undefined;
  const periodStart = new Date();
  periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = new Date(Date.UTC(
    periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1,
  ));
  const quotaCopy = locale === "ar" ? {
    title: "سعة البريد للفترة الحالية", total: "الإجمالي", used: "المستخدم",
    remaining: "المتبقي", period: "الفترة", updated: "آخر تحديث",
    source: "المصدر: حصة إنتاج مضبوطة مع استخدام Axora المسجل",
    missing: "لم تُضبط حصة إنتاج موثوقة.",
  } : locale === "ms" ? {
    title: "Kapasiti e-mel tempoh semasa", total: "Jumlah", used: "Digunakan",
    remaining: "Baki", period: "Tempoh", updated: "Kemas kini terakhir",
    source: "Sumber: kuota produksi dikonfigurasi dengan penggunaan Axora direkodkan",
    missing: "Kuota produksi yang dipercayai belum dikonfigurasi.",
  } : {
    title: "Current-period email capacity", total: "Total", used: "Used",
    remaining: "Remaining", period: "Period", updated: "Last updated",
    source: "Source: configured production quota with Axora-recorded usage",
    missing: "No trustworthy production quota is configured.",
  };

  return <div className={styles.workspace} data-email-operations-workspace>
    <PageHeader eyebrow={messages.eyebrow} title={messages.title} description={messages.description} />
    {notice && notice in messages.notices ? <div
      className={`callout ${notice === "denied" ? "callout-warning" : "callout-success"}`}
      role={notice === "denied" ? "alert" : "status"}
    >{messages.notices[notice as keyof typeof messages.notices]}</div> : null}

    <section className={`callout ${styles.boundary}`}>
      <ShieldCheck size={20} aria-hidden="true" />
      <div><strong>{messages.privacy}</strong><p>{messages.privacyBody}</p></div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>{messages.filters}</h2><p>{messages.filtersBody}</p></div></div>
      <div className="panel-body">
        <form method="get" className={styles.filterGrid}>
          <label>{messages.from}<input type="date" name="from" defaultValue={filters.from ?? ""} /></label>
          <label>{messages.to}<input type="date" name="to" defaultValue={filters.to ?? ""} /></label>
          <label>{messages.agent}<select name="agent" defaultValue={filters.agent ?? ""}>
            <option value="">{messages.all}</option>
            {EMAIL_PROVIDER_AGENTS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
          </select></label>
          <label>{messages.status}<select name="status" defaultValue={filters.status ?? ""}>
            <option value="">{messages.all}</option>
            {EMAIL_DELIVERY_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status, locale)}</option>)}
          </select></label>
          <label>{messages.event}<input name="event" defaultValue={filters.event ?? ""} maxLength={120} /></label>
          <label>{messages.template}<input name="template" defaultValue={filters.template ?? ""} maxLength={120} /></label>
          <label>{messages.company}<select name="companyId" defaultValue={filters.companyId ?? ""}>
            <option value="">{messages.all}</option>
            {workspace.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select></label>
          <label>{messages.domain}<input className="bidi-ltr" dir="ltr" name="domain" defaultValue={filters.domain ?? ""} maxLength={253} /></label>
          <label>{messages.error}<input className="bidi-ltr" dir="ltr" name="error" defaultValue={filters.error ?? ""} maxLength={64} /></label>
          <label>{messages.correlation}<input className="bidi-ltr" dir="ltr" name="correlation" defaultValue={filters.correlation ?? ""} maxLength={36} /></label>
          <label>{messages.entity}<input className="bidi-ltr" dir="ltr" name="entity" defaultValue={filters.entity ?? ""} maxLength={120} /></label>
          <div className={styles.filterActions}>
            <button className="button button-primary" type="submit">{messages.apply}</button>
            <Link className="button button-secondary" href="/email-operations">{messages.clear}</Link>
          </div>
        </form>
      </div>
    </section>

    <section aria-labelledby="email-metrics-title">
      <div className="section-heading"><div><p className="eyebrow">{messages.metrics}</p><h2 id="email-metrics-title">{messages.metrics}</h2></div></div>
      <div className={styles.metricGrid}>
        {metricCards.map(([label, value, note]) => <article className={styles.metric} key={label}>
          <span>{label}</span><strong>{typeof value === "number" ? number.format(value) : value}</strong>
          {note ? <small>{note}</small> : null}
        </article>)}
      </div>
    </section>

    <section className="panel" aria-labelledby="email-quota-title">
      <div className="panel-header"><div>
        <h2 id="email-quota-title">{quotaCopy.title}</h2>
        <p>{hasConfiguredQuota ? quotaCopy.source : quotaCopy.missing}</p>
      </div></div>
      <div className={`panel-body ${styles.healthGrid}`}>
        <div><span>{quotaCopy.total}</span><strong>{hasConfiguredQuota ? number.format(configuredQuota) : "-"}</strong></div>
        <div><span>{quotaCopy.used}</span><strong>{number.format(quotaUsed)}</strong></div>
        <div><span>{quotaCopy.remaining}</span><strong>{quotaRemaining === undefined ? "-" : number.format(quotaRemaining)}</strong></div>
        <div><span>{quotaCopy.period}</span><strong>{formatDateTime(periodStart.toISOString(), locale, timeZone)} - {formatDateTime(periodEnd.toISOString(), locale, timeZone)}</strong></div>
        <div><span>{quotaCopy.updated}</span><strong>{formatDateTime(new Date().toISOString(), locale, timeZone)}</strong></div>
      </div>
    </section>

    <section className="panel" aria-labelledby="provider-runtime-title">
      <div className="panel-header"><div><h2 id="provider-runtime-title">{messages.runtimeReadiness}</h2><p>{messages.runtimeReadinessBody}</p></div></div>
      <div className={`panel-body ${styles.providerGrid}`}>
        <article className={styles.healthCard}>
          <MailCheck size={28} aria-hidden="true" />
          <strong>{workspace.providerRuntime.providerName}</strong>
          <div className={styles.healthGrid}>
            <div><span>{messages.configState}</span><strong>{readinessStateLabel(workspace.providerRuntime.state, locale)}</strong></div>
            <div><span>{messages.deliveryGate}</span><strong>{workspace.providerRuntime.deliveryEnabled ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.eventsGate}</span><strong>{workspace.providerRuntime.eventsEnabled ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.bootstrapGate}</span><strong>{workspace.providerRuntime.bootstrapEnabled ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.accountReviewed}</span><strong>{workspace.providerRuntime.accountReviewed === undefined ? "-" : workspace.providerRuntime.accountReviewed ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.domainVerified}</span><strong>{workspace.providerRuntime.domainVerified ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.creditsReady}</span><strong>{workspace.providerRuntime.creditsReady === undefined ? "-" : workspace.providerRuntime.creditsReady ? messages.enabled : messages.disabled}</strong></div>
            <div><span>{messages.webhookVerified}</span><strong>{workspace.providerRuntime.webhookVerified ? messages.enabled : messages.disabled}</strong></div>
          </div>
        </article>
      </div>
    </section>

    <section className="panel" aria-labelledby="email-agent-title">
      <div className="panel-header"><div><h2 id="email-agent-title">{messages.agents}</h2><p>{messages.agentsBody}</p></div></div>
      <div className={`panel-body ${styles.agentGrid}`}>
        {workspace.agents.map((agent) => <article className={styles.agent} key={agent.providerAgent}>
          <div className={styles.agentHead}><strong className="bidi-ltr" dir="ltr">{agent.providerAgent}</strong>
            <span className={`${styles.state} ${agent.paused ? styles.statePaused : ""}`}>{agent.paused ? messages.paused : messages.active}</span>
          </div>
          <div className={styles.agentMetrics}>
            <div><span>{messages.queue}</span><strong>{number.format(agent.queueDepth)}</strong></div>
            <div><span>{messages.retrying}</span><strong>{number.format(agent.retrying)}</strong></div>
            <div><span>{messages.agentFailures}</span><strong>{number.format(agent.failures)}</strong></div>
          </div>
          {workspace.canManage ? <form action={performEmailOperationAction} className={styles.agentForm}>
            <input type="hidden" name="commandId" value={randomUUID()} />
            <input type="hidden" name="providerAgent" value={agent.providerAgent} />
            <label>{messages.reason}<input name="reason" required minLength={10} maxLength={1_000} /></label>
            <button className={`button ${agent.paused ? "button-primary" : "button-secondary"}`} name="action" value={agent.paused ? "RESUME_AGENT" : "PAUSE_AGENT"} type="submit">
              {agent.paused ? messages.resume : messages.pause}
            </button>
          </form> : null}
        </article>)}
      </div>
    </section>

    {workspace.providerHealth ? <section className="panel" aria-labelledby="provider-health-title">
      <div className="panel-header"><div><h2 id="provider-health-title">{messages.provider}</h2><p>{messages.source}: {workspace.providerHealth.source}</p></div></div>
      <div className={`panel-body ${styles.providerGrid}`}>
        <article className={styles.healthCard}>
          <MailCheck size={28} aria-hidden="true" />
          <strong>{workspace.providerHealth.providerName ?? "provider"}</strong>
          <div className={styles.healthGrid}>
            <div><span>{messages.remaining}</span><strong>{workspace.providerHealth.remainingRecipientUnits === undefined ? "-" : number.format(workspace.providerHealth.remainingRecipientUnits)}</strong></div>
            <div><span>{messages.forecast}</span><strong>{workspace.providerHealth.forecastDays === undefined ? "-" : number.format(workspace.providerHealth.forecastDays)}</strong></div>
            <div><span>{messages.threshold}</span><strong>{workspace.providerHealth.threshold}</strong></div>
            <div><span>{messages.accountState}</span><strong>{workspace.providerHealth.accountState}</strong></div>
            <div><span>{messages.domainState}</span><strong>{workspace.providerHealth.domainState}</strong></div>
            <div><span>{messages.configState}</span><strong>{workspace.providerHealth.configurationState}</strong></div>
            <div><span>{messages.expires}</span><strong>{formatDateTime(workspace.providerHealth.creditExpiresAt, locale, timeZone)}</strong></div>
            <div><span>{messages.renews}</span><strong>{formatDateTime(workspace.providerHealth.allowanceRenewsAt, locale, timeZone)}</strong></div>
          </div>
        </article>
        {workspace.canManage ? <form action={performEmailOperationAction} className={styles.providerForm}>
          <input type="hidden" name="commandId" value={randomUUID()} />
          <input type="hidden" name="source" value="MANUAL" />
          <label>{messages.source}<select name="providerName" defaultValue="resend"><option value="resend">Resend</option><option value="zeptomail">ZeptoMail</option><option value="cloudflare-email-service">Cloudflare Email Service</option></select></label>
          <label>{messages.remaining}<input name="remainingRecipientUnits" type="number" min="0" step="1" inputMode="numeric" /></label>
          <label>{messages.renews}<input name="allowanceRenewsAt" type="date" /></label>
          <label>{messages.expires}<input name="creditExpiresAt" type="date" /></label>
          <label>{messages.accountState}<select name="accountState" defaultValue="UNKNOWN"><option>HEALTHY</option><option>DEGRADED</option><option>PAUSED</option><option>EXPIRED</option><option>UNKNOWN</option></select></label>
          <label>{messages.domain}<input name="domainName" className="bidi-ltr" dir="ltr" maxLength={253} /></label>
          <label>{messages.domainState}<select name="domainState" defaultValue="UNKNOWN"><option>VERIFIED</option><option>PENDING</option><option>FAILED</option><option>UNKNOWN</option></select></label>
          <label>{messages.configState}<select name="configurationState" defaultValue="UNKNOWN"><option>HEALTHY</option><option>DEGRADED</option><option>FAILED</option><option>UNKNOWN</option></select></label>
          <label className={styles.full}>{messages.note}<textarea name="note" minLength={10} maxLength={1_000} rows={3} /></label>
          <label className={styles.full}>{messages.reason}<input name="reason" required minLength={10} maxLength={1_000} /></label>
          <div className={`${styles.full} ${styles.actionButtons}`}>
            <button className="button button-primary" name="action" value="RECORD_PROVIDER_HEALTH" type="submit">{messages.recordHealth}</button>
            <button className="button button-secondary" name="action" value="RECONCILE" type="submit">{messages.reconcile}</button>
          </div>
        </form> : null}
      </div>
    </section> : null}

    <section className="panel" aria-labelledby="delivery-evidence-title">
      <div className="panel-header"><div><h2 id="delivery-evidence-title">{messages.records}</h2><p>{messages.recordsBody}</p></div><strong>{number.format(workspace.totalRecords)}</strong></div>
      <div className={`panel-body ${styles.records}`}>
        {workspace.records.length === 0 ? <div className="empty-state"><AlertTriangle aria-hidden="true" /><p>{messages.noRecords}</p></div> : workspace.records.map((record) => <article className={styles.record} key={`${record.deliveryKind}:${record.deliveryId}`}>
          <div className={styles.recordMeta}>
            <h3>{record.templateKey} <small>v{number.format(record.templateVersion)}</small></h3>
            <span><strong>{messages.delivery}:</strong> {statusLabel(record.status, locale)} / {record.deliveryKind}</span>
            <span><strong>{messages.recipient}:</strong> <bdi className="bidi-ltr" dir="ltr">{record.maskedRecipient}</bdi></span>
            <span><strong>{messages.agent}:</strong> <bdi className="bidi-ltr" dir="ltr">{record.providerAgent}</bdi></span>
          </div>
          <div className={styles.recordMeta}>
            <span><strong>{messages.event}:</strong> {record.eventKey}</span>
            <span><strong>{messages.attempts}:</strong> {number.format(record.attemptCount)} / {number.format(record.maximumAttempts)}</span>
            <span><strong>{messages.providerState}:</strong> {record.providerStatus ?? record.attemptOutcome ?? "-"}</span>
            <span><strong>{messages.error}:</strong> {record.lastError ?? "-"}</span>
            <span>{formatDateTime(record.createdAt, locale, timeZone)}</span>
            {record.routePath ? <Link href={record.routePath}>{messages.open} <ExternalLink size={14} aria-hidden="true" /></Link> : null}
          </div>
          <div className={styles.recordActions}>
            {workspace.canManage ? <details>
              <summary>{messages.delivery}</summary>
              <form action={performEmailOperationAction} className={styles.actionForm}>
                <input type="hidden" name="commandId" value={randomUUID()} />
                <input type="hidden" name="deliveryKind" value={record.deliveryKind} />
                <input type="hidden" name="deliveryId" value={record.deliveryId} />
                <label>{messages.reason}<input name="reason" required minLength={10} maxLength={1_000} /></label>
                <label>{messages.suppressions}<select name="targetType" defaultValue="ADDRESS"><option value="ADDRESS">{messages.suppressAddress}</option><option value="DOMAIN">{messages.suppressDomain}</option></select></label>
                <label><input type="checkbox" name="correctionResolved" value="true" />{messages.correction}</label>
                <div className={styles.actionButtons}>
                  {record.retryable ? <button className="button button-secondary" name="action" value="RETRY" type="submit">{messages.retry}</button> : null}
                  {record.cancellable ? <button className="button button-secondary" name="action" value="CANCEL" type="submit">{messages.cancel}</button> : null}
                  {record.resendable ? <button className="button button-secondary" name="action" value="RESEND" type="submit">{messages.resend}</button> : null}
                  {record.canReveal && !record.recipientSuppressed ? <button className="button button-secondary" name="action" value="SUPPRESS" type="submit">{messages.suppressions}</button> : null}
                  {record.canReveal && record.recipientSuppressed ? <button className="button button-primary" name="action" value="UNSUPPRESS" type="submit">{messages.unsuppress}</button> : null}
                </div>
              </form>
            </details> : null}
            {record.canReveal ? <EmailRecipientReveal
              commandId={randomUUID()}
              deliveryKind={record.deliveryKind}
              deliveryId={record.deliveryId}
              labels={{ reveal: messages.reveal, revealing: messages.revealing, reason: messages.reason, revealed: messages.revealed, invalid: messages.invalidAction, unavailable: messages.unavailable }}
            /> : null}
          </div>
        </article>)}
        <nav className={styles.pagination} aria-label={messages.records}>
          {offset > 0 ? <Link className="button button-secondary" href={`/email-operations?${previousSearch}`}>{messages.previous}</Link> : <span />}
          {offset + 100 < workspace.totalRecords ? <Link className="button button-secondary" href={`/email-operations?${nextSearch}`}>{messages.next}</Link> : null}
        </nav>
      </div>
    </section>

    <div className={styles.evidenceGrid}>
      <section className="panel">
        <div className="panel-header"><h2>{messages.suppressionEvidence}</h2></div>
        <div className={`panel-body ${styles.evidenceList}`}>
          {workspace.suppressions.length ? workspace.suppressions.map((item, index) => <div className={styles.evidenceRow} key={`${item.maskedTarget}:${item.occurredAt}:${index}`}>
            <span><bdi className="bidi-ltr" dir="ltr">{item.maskedTarget}</bdi><small>{item.source} / {item.targetType} / {item.action}</small></span>
            <small>{formatDateTime(item.occurredAt, locale, timeZone)}</small>
          </div>) : <p>{messages.none}</p>}
        </div>
      </section>
      <section className="panel">
        <div className="panel-header"><h2>{messages.webhookHealth}</h2></div>
        <div className={`panel-body ${styles.evidenceList}`}>
          {workspace.webhooks.length ? workspace.webhooks.map((item) => <div className={styles.evidenceRow} key={`${item.providerName}:${item.periodStart}`}>
            <span><strong>{item.providerName}</strong><small>{messages.accepted}: {number.format(item.accepted)} / {messages.rejected}: {number.format(item.rejected)} / {messages.processing}: {number.format(item.processingFailures)}</small></span>
            <small>{formatDateTime(item.lastEventAt, locale, timeZone)}</small>
          </div>) : <p>{messages.none}</p>}
        </div>
      </section>
    </div>
  </div>;
}

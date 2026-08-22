import { randomUUID } from "node:crypto";
import { NotificationInboxSync } from "@/components/NotificationInboxSync";
import { OperationalSubmitButton } from "@/components/OperationalSubmitButton";
import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { LOCALE_NAMES } from "@/lib/i18n";
import { notificationCentreMessages } from "@/lib/notification-centre-i18n";
import {
  notificationCenterSnapshot,
  type NotificationCenterCategoryFilter,
  type NotificationCenterItem,
  type NotificationStatusFilter,
} from "@/lib/notification-repository";
import {
  NOTIFICATION_EVENT_POLICIES,
  type NotificationCategory,
} from "@/lib/notifications";
import { getMyProfile } from "@/lib/profile";
import {
  AlertCircle,
  BellRing,
  Clock3,
  ExternalLink,
  Inbox,
  LockKeyhole,
  MailCheck,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  saveNotificationPreferenceAction,
} from "./actions";

const statuses: readonly NotificationStatusFilter[] = [
  "ALL", "UNREAD", "READ", "ARCHIVED",
];
const categories: readonly NotificationCenterCategoryFilter[] = [
  "ALL", "ACCOUNT", "LEAD", "APPROVAL", "BUDGET",
  "DELIVERY", "FINANCE", "EMAIL", "WORKFLOW",
];
const reminderOptions = [0, 12, 24, 72, 168] as const;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function statusFilter(value: string | undefined): NotificationStatusFilter {
  const normalized = value?.toUpperCase() as NotificationStatusFilter | undefined;
  return normalized && statuses.includes(normalized) ? normalized : "ALL";
}

function dateFormatter(locale: "en" | "ar" | "ms", timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
}

function groupFormatter(locale: "en" | "ar" | "ms", timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  });
}

function groupedNotifications(
  notifications: readonly NotificationCenterItem[],
  locale: "en" | "ar" | "ms",
  timezone: string,
) {
  const format = groupFormatter(locale, timezone);
  const groups = new Map<string, NotificationCenterItem[]>();
  for (const notification of notifications) {
    const key = format.format(new Date(notification.createdAt));
    const group = groups.get(key) ?? [];
    group.push(notification);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

function ReminderSelect({
  value,
  label,
  copy,
}: {
  value: number | null;
  label: string;
  copy: ReturnType<typeof notificationCentreMessages>;
}) {
  const labels: Record<number, string> = {
    0: copy.noReminder,
    12: copy.hours12,
    24: copy.hours24,
    72: copy.hours72,
    168: copy.hours168,
  };
  return <label>{label}<select name="reminderHours" defaultValue={value ?? 0}>
    {reminderOptions.map((hours) => <option key={hours} value={hours}>{labels[hours]}</option>)}
  </select></label>;
}

function CurrentFilterInputs({
  status,
  category,
}: {
  status: NotificationStatusFilter;
  category: NotificationCenterCategoryFilter;
}) {
  return <>
    <input type="hidden" name="returnStatus" value={status} />
    <input type="hidden" name="returnCategory" value={category} />
  </>;
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireSession();
  const [params, profile] = await Promise.all([searchParams, getMyProfile(actor)]);
  const locale = profile.preferredLocale;
  const copy = notificationCentreMessages(locale);
  const selectedStatus = statusFilter(first(params.status));
  const selectedCategory: NotificationCenterCategoryFilter = "ALL";
  const notice = first(params.notice);
  let snapshot;
  try {
    snapshot = await notificationCenterSnapshot(actor, {
      status: selectedStatus,
      category: selectedCategory,
    });
  } catch {
    return <section className="notification-centre" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      <div className="notification-error" role="alert">
        <AlertCircle size={22} aria-hidden="true" />
        <div><h2>{copy.errorTitle}</h2><p>{copy.errorBody}</p></div>
      </div>
    </section>;
  }

  const formatDate = dateFormatter(locale, profile.timezone);
  const grouped = groupedNotifications(snapshot.notifications, locale, profile.timezone);
  const preferenceGroups = categories.slice(1).map((category) => ({
    category: category as NotificationCategory,
    preferences: snapshot.preferences.filter((item) => item.category === category),
  })).filter((group) => group.preferences.length > 0);
  const statusLabels: Record<NotificationStatusFilter, string> = {
    ALL: copy.allStatuses,
    UNREAD: copy.unread,
    READ: copy.read,
    ARCHIVED: copy.archived,
  };

  return <section className="notification-centre" lang={locale} dir={LOCALE_NAMES[locale].dir}>
    <NotificationInboxSync versionToken={snapshot.versionToken} />
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />

    {notice ? <div className={notice === "saved" ? "form-success" : "form-alert"} role={notice === "saved" ? "status" : "alert"}>
      {notice === "saved" ? copy.saved : copy.denied}
    </div> : null}

    <div className="notification-metrics" aria-label={copy.title}>
      <article><span><Inbox size={18} aria-hidden="true" /></span><strong>{snapshot.unreadCount}</strong><small>{copy.unreadMetric}</small></article>
      <article><span><BellRing size={18} aria-hidden="true" /></span><strong>{snapshot.totalCount}</strong><small>{copy.visibleMetric}</small></article>
      <article><span><Clock3 size={18} aria-hidden="true" /></span><strong>30s</strong><small>{copy.deliveryMetric}</small></article>
    </div>

    <form className="notification-filter-bar" action="/notifications" method="get" aria-label={copy.filters}>
      <label>{copy.status}<select name="status" defaultValue={selectedStatus}>
        {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
      </select></label>
      <button className="button button-secondary" type="submit">{copy.apply}</button>
      <span><span className="environment-dot" aria-hidden="true" />{copy.live}</span>
    </form>

    <div className="notification-layout">
      <section className="notification-feed" aria-labelledby="notification-inbox-title">
        <header>
          <div><h2 id="notification-inbox-title">{copy.inbox}</h2><p aria-live="polite">{snapshot.unreadCount ? copy.unreadCount(snapshot.unreadCount) : copy.current}</p></div>
          {snapshot.unreadCount ? <form action={markAllNotificationsReadAction}>
            <input type="hidden" name="commandId" value={randomUUID()} />
            <CurrentFilterInputs status={selectedStatus} category={selectedCategory} />
            <OperationalSubmitButton className="button button-secondary" label={copy.markAll} pendingLabel={copy.saving} />
          </form> : null}
        </header>
        {grouped.length ? grouped.map(([label, notifications]) => <section className="notification-group" key={label} aria-label={label}>
          <h3>{label}</h3>
          <ol>{notifications.map((notification) => <li className={`${notification.readAt ? "" : "notification-unread"}${notification.archivedAt ? " notification-archived" : ""}`} key={notification.id}>
            <span className={`notification-priority notification-priority-${notification.priority.toLowerCase()}`} aria-hidden="true">
              {notification.reminderOfNotificationId ? <Clock3 size={18} /> : <BellRing size={18} />}
            </span>
            <div className="notification-copy">
              <div><strong>{notification.title}</strong><time dateTime={notification.createdAt}>{formatDate.format(new Date(notification.createdAt))}</time></div>
              <p>{notification.body}</p>
              <div className="notification-badges">
                <span>{copy.categories[notification.category]}</span>
                {notification.reminderOfNotificationId ? <span>{copy.reminder}</span> : null}
                {notification.emailDeliveryRelated ? <span><MailCheck size={12} aria-hidden="true" />{copy.emailRelated}</span> : null}
              </div>
              <small>{copy.expires(formatDate.format(new Date(notification.expiresAt)))}</small>
            </div>
            <div className="notification-actions">
              {notification.routePath ? <Link className="text-button" href={notification.routePath}>{copy.open}<ExternalLink size={13} aria-hidden="true" /></Link> : null}
              {!notification.readAt && !notification.archivedAt ? <form action={markNotificationReadAction}>
                <input type="hidden" name="commandId" value={randomUUID()} />
                <input type="hidden" name="notificationId" value={notification.id} />
                <input type="hidden" name="stateVersion" value={notification.stateVersion} />
                <CurrentFilterInputs status={selectedStatus} category={selectedCategory} />
                <OperationalSubmitButton label={copy.markRead} pendingLabel={copy.saving} />
              </form> : null}
              {!notification.archivedAt ? <form action={archiveNotificationAction}>
                <input type="hidden" name="commandId" value={randomUUID()} />
                <input type="hidden" name="notificationId" value={notification.id} />
                <CurrentFilterInputs status={selectedStatus} category={selectedCategory} />
                <OperationalSubmitButton label={copy.archive} pendingLabel={copy.saving} />
              </form> : null}
            </div>
          </li>)}</ol>
        </section>) : <div className="notification-empty">
          <Inbox size={30} aria-hidden="true" /><h3>{copy.empty}</h3><p>{copy.emptyBody}</p>
        </div>}
      </section>

      <aside className="notification-preferences" aria-labelledby="notification-preferences-title">
        <header><div><h2 id="notification-preferences-title">{copy.preferences}</h2><p>{copy.preferencesIntro}</p></div></header>
        <div className="notification-safety-note"><LockKeyhole size={18} aria-hidden="true" /><div><strong>{copy.inAppLocked}</strong><p>{copy.inAppLockedBody}</p></div></div>
        <div className="notification-preference-list">
          {preferenceGroups.map((group) => <details key={group.category} open={group.category === "APPROVAL"}>
            <summary>{copy.categories[group.category]}<span>{group.preferences.length}</span></summary>
            {group.preferences.map((preference) => {
              const policy = NOTIFICATION_EVENT_POLICIES.find((item) => item.eventKey === preference.eventKey);
              const label = copy.eventLabels[preference.eventKey] ?? copy.categories[preference.category];
              return <div className="notification-preference-event" key={preference.eventKey}>
                <div className="notification-preference-title"><strong>{label}</strong><span className={preference.mandatoryEmail ? "notification-required" : ""}>{preference.mandatoryEmail ? copy.mandatory : copy.optional}</span></div>
                <form action={saveNotificationPreferenceAction}>
                  <input type="hidden" name="commandId" value={randomUUID()} />
                  <input type="hidden" name="scope" value="USER" />
                  <input type="hidden" name="eventKey" value={preference.eventKey} />
                  <CurrentFilterInputs status={selectedStatus} category={selectedCategory} />
                  <strong>{copy.personalChoice}</strong>
                  <label>{copy.email}{preference.mandatoryEmail ? <><input type="hidden" name="emailEnabled" value="true" /><input type="checkbox" checked disabled /></> : <input name="emailEnabled" type="checkbox" defaultChecked={preference.emailEnabled} />}</label>
                  {preference.mandatoryEmail ? <><input type="hidden" name="deliverySchedule" value="IMMEDIATE" /><label>{copy.schedule}<select value="IMMEDIATE" disabled><option value="IMMEDIATE">{copy.immediate}</option></select></label></> : <label>{copy.schedule}<select name="deliverySchedule" defaultValue={preference.deliverySchedule}><option value="IMMEDIATE">{copy.immediate}</option><option value="DAILY">{copy.daily}</option><option value="WEEKLY">{copy.weekly}</option></select></label>}
                  <ReminderSelect value={preference.reminderHours} label={copy.reminderSchedule} copy={copy} />
                  <OperationalSubmitButton label={copy.save} pendingLabel={copy.saving} />
                </form>
                {snapshot.canManageCompanyPreferences && snapshot.companyId && preference.companyConfigurable && policy?.companyConfigurable ? <form action={saveNotificationPreferenceAction} className="notification-company-preference">
                  <input type="hidden" name="commandId" value={randomUUID()} />
                  <input type="hidden" name="scope" value="COMPANY" />
                  <input type="hidden" name="companyId" value={snapshot.companyId} />
                  <input type="hidden" name="eventKey" value={preference.eventKey} />
                  <CurrentFilterInputs status={selectedStatus} category={selectedCategory} />
                  <strong>{copy.companyDefault}</strong>
                  <label>{copy.email}<input name="emailEnabled" type="checkbox" defaultChecked={preference.companyEmailEnabled ?? true} /></label>
                  <label>{copy.schedule}<select name="deliverySchedule" defaultValue={preference.companyDeliverySchedule ?? "IMMEDIATE"}><option value="IMMEDIATE">{copy.immediate}</option><option value="DAILY">{copy.daily}</option><option value="WEEKLY">{copy.weekly}</option></select></label>
                  <ReminderSelect value={preference.companyReminderHours} label={copy.reminderSchedule} copy={copy} />
                  <OperationalSubmitButton label={copy.save} pendingLabel={copy.saving} />
                </form> : null}
              </div>;
            })}
          </details>)}
        </div>
        <div className="notification-preference-foot"><ShieldCheck size={17} aria-hidden="true" />{copy.inAppLockedBody}</div>
      </aside>
    </div>
  </section>;
}

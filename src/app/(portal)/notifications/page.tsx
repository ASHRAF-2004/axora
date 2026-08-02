import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import { listMyNotificationPreferences, listMyNotifications } from "@/lib/notification-repository";
import { Bell, CheckCheck, CircleAlert, Mail, Smartphone } from "lucide-react";
import Link from "next/link";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
  saveNotificationPreferenceAction,
} from "./actions";
import { operationalEventLabel, operationalMessage, operationalNumber, type OperationalMessageKey } from "@/lib/operational-i18n";
import { OperationalSubmitButton } from "@/components/OperationalSubmitButton";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requireSession();
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const { notice } = await searchParams;
  const noticeKey: OperationalMessageKey | null = notice === "read"
    ? "notifications.readSaved"
    : notice === "all-read"
      ? "notifications.allReadSaved"
      : notice === "preference-saved"
        ? "notifications.preferenceSaved"
        : null;
  const [notifications, preferences] = await Promise.all([
    listMyNotifications(actor),
    listMyNotificationPreferences(actor),
  ]);
  const unread = notifications.filter((notification) => !notification.readAt).length;
  return <>
    <PageHeader eyebrow={m("notifications.eyebrow")} title={m("notifications.title")} description={m("notifications.description")} />
    {noticeKey ? <div className="callout" role="status">{m(noticeKey)}</div> : null}
    <div className="notification-layout">
      <section className="notification-feed" aria-label={m("notifications.history")}>
        <header><div><h2>{m("notifications.inbox")}</h2><p>{unread ? m("notifications.unread", { count: operationalNumber(locale, unread) }) : m("notifications.current")}</p></div>{unread ? <form action={markAllNotificationsReadAction}><CheckCheck size={16} /><OperationalSubmitButton className="button button-secondary" label={m("notifications.markAll")} pendingLabel={m("notifications.marking")} /></form> : null}</header>
        {notifications.length ? <ol>{notifications.map((notification) => <li key={notification.id} className={notification.readAt ? "" : "notification-unread"}>
          <span className={`notification-priority notification-priority-${notification.priority.toLowerCase()}`}><Bell size={17} /></span>
          <div><div><strong>{operationalEventLabel(locale, notification.eventKey)}</strong><time>{formatDateTime(notification.createdAt, locale, actor.timezone)}</time></div><p>{notification.body}</p><span className="notification-event-key">{operationalEventLabel(locale, notification.eventKey)}</span></div>
          <div>{notification.routePath ? <Link className="text-button" href={notification.routePath}>{m("notifications.open")}</Link> : null}{!notification.readAt ? <form action={markNotificationReadAction.bind(null, notification.id)}><OperationalSubmitButton label={m("notifications.mark")} pendingLabel={m("notifications.marking")} /></form> : null}</div>
        </li>)}</ol> : <div className="empty-state"><Bell size={27} /><strong>{m("notifications.empty")}</strong><p>{m("notifications.emptyBody")}</p></div>}
      </section>

      <aside className="notification-preferences">
        <header><h2>{m("notifications.preferences")}</h2><p>{m("notifications.preferencesIntro")}</p></header>
        <div className="notification-preference-list">{preferences.map((preference) => <form action={saveNotificationPreferenceAction} key={preference.eventKey}>
          <input type="hidden" name="eventKey" value={preference.eventKey} />
          <strong>{operationalEventLabel(locale, preference.eventKey)}</strong>
          <label><Smartphone size={15} /><span>{m("notifications.inApp")}</span><input type="checkbox" name="inAppEnabled" defaultChecked={preference.inAppEnabled} /></label>
          <label><Mail size={15} /><span>{m("notifications.email")}</span><input type="checkbox" name="emailEnabled" defaultChecked={preference.emailEnabled} /></label>
          <label><span className="sr-only">{m("notifications.schedule")}</span><select name="digestMode" defaultValue={preference.digestMode}><option value="IMMEDIATE">{m("notifications.immediate")}</option><option value="DAILY">{m("notifications.daily")}</option><option value="WEEKLY">{m("notifications.weekly")}</option></select></label>
          <OperationalSubmitButton label={m("common.save")} pendingLabel={m("notifications.marking")} />
        </form>)}</div>
        <div className="notification-safety-note"><CircleAlert size={17} /><p>{m("notifications.safety")}</p></div>
      </aside>
    </div>
  </>;
}

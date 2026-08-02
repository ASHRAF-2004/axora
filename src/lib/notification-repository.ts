import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";

export const NOTIFICATION_EVENT_KEYS = [
  "invitation.sent",
  "invitation.accepted",
  "request.submitted",
  "approval.needed",
  "request.approved",
  "request.rejected",
  "quotation.requested",
  "quotation.received",
  "supplier.selected",
  "supplier.order_selected",
  "supplier.rfq_acknowledged",
  "supplier.order_acknowledged",
  "delivery.scheduled",
  "driver.assigned",
  "delivery.accepted",
  "delivery.arrived",
  "delivery.note_added",
  "delivery.delayed",
  "delivery.completed",
  "receipt.required",
  "discrepancy.opened",
  "invoice.issued",
  "payment.status_changed",
  "order.confirmed",
  "preparation.started",
  "delivery.out_for_delivery",
  "delivery.evidence_recorded",
  "delivery.partial_evidence_recorded",
  "delivery.failed",
  "receipt.confirmed",
  "three_way_match.completed",
  "three_way_match.exception",
  "request.completed",
  "request.cancelled",
  "request.on_hold",
] as const;

export interface MyNotification {
  id: string;
  eventKey: string;
  title: string;
  body: string;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  routePath?: string;
  createdAt: string;
  readAt?: string;
}

export interface MyNotificationPreference {
  eventKey: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  digestMode: "IMMEDIATE" | "DAILY" | "WEEKLY";
}

export async function listMyNotifications(actor: SessionUser, limit = 100): Promise<MyNotification[]> {
  if (isDemoMode()) return [];
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
  return withAuditTransaction({ userId: actor.id, reason: "Viewed personal notifications" }, async (client) => {
    const result = await client.query<MyNotification>(`
      SELECT id::text,event_key AS "eventKey",title,body,priority,
        route_path AS "routePath",created_at::text AS "createdAt",read_at::text AS "readAt"
      FROM in_app_notifications
      WHERE recipient_user_id=$1 AND archived_at IS NULL
      ORDER BY created_at DESC,id DESC
      LIMIT $2
    `, [actor.id, safeLimit]);
    return result.rows;
  });
}

export async function unreadNotificationCount(actor: SessionUser) {
  if (isDemoMode()) return 0;
  return withAuditTransaction({ userId: actor.id, reason: "Checked unread notification count" }, async (client) => {
    const result = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM in_app_notifications
      WHERE recipient_user_id=$1 AND read_at IS NULL AND archived_at IS NULL
    `, [actor.id]);
    return Number(result.rows[0]?.count ?? 0);
  });
}

export async function markMyNotificationRead(actor: SessionUser, notificationId: string) {
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Marked personal notification read" }, async (client) => {
    await client.query(`
      UPDATE in_app_notifications SET read_at=COALESCE(read_at,now())
      WHERE id=$1 AND recipient_user_id=$2 AND archived_at IS NULL
    `, [notificationId, actor.id]);
  });
}

export async function markAllMyNotificationsRead(actor: SessionUser) {
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Marked all personal notifications read" }, async (client) => {
    await client.query(`
      UPDATE in_app_notifications SET read_at=COALESCE(read_at,now())
      WHERE recipient_user_id=$1 AND archived_at IS NULL AND read_at IS NULL
    `, [actor.id]);
  });
}

export async function listMyNotificationPreferences(actor: SessionUser): Promise<MyNotificationPreference[]> {
  if (isDemoMode()) return NOTIFICATION_EVENT_KEYS.map((eventKey) => ({ eventKey, inAppEnabled: true, emailEnabled: true, digestMode: "IMMEDIATE" }));
  return withAuditTransaction({ userId: actor.id, reason: "Viewed personal notification preferences" }, async (client) => {
    const result = await client.query<MyNotificationPreference>(`
      SELECT event_key AS "eventKey",in_app_enabled AS "inAppEnabled",
        email_enabled AS "emailEnabled",digest_mode AS "digestMode"
      FROM notification_preferences WHERE user_id=$1
    `, [actor.id]);
    const saved = new Map(result.rows.map((row) => [row.eventKey, row]));
    return NOTIFICATION_EVENT_KEYS.map((eventKey) => saved.get(eventKey) ?? ({ eventKey, inAppEnabled: true, emailEnabled: true, digestMode: "IMMEDIATE" }));
  });
}

export async function saveMyNotificationPreference(actor: SessionUser, input: MyNotificationPreference) {
  if (!(NOTIFICATION_EVENT_KEYS as readonly string[]).includes(input.eventKey)) throw new Error("Unsupported notification event.");
  if (!["IMMEDIATE", "DAILY", "WEEKLY"].includes(input.digestMode)) throw new Error("Unsupported notification schedule.");
  if (isDemoMode()) return;
  await withAuditTransaction({ userId: actor.id, reason: "Updated personal notification preference" }, async (client) => {
    await client.query(`
      INSERT INTO notification_preferences(user_id,event_key,in_app_enabled,email_enabled,digest_mode,updated_at)
      VALUES ($1,$2,$3,$4,$5,now())
      ON CONFLICT(user_id,event_key) DO UPDATE SET
        in_app_enabled=EXCLUDED.in_app_enabled,email_enabled=EXCLUDED.email_enabled,
        digest_mode=EXCLUDED.digest_mode,updated_at=now()
    `, [actor.id, input.eventKey, input.inAppEnabled, input.emailEnabled, input.digestMode]);
  });
}

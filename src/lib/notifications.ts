import { randomUUID } from "node:crypto";
import { workflowIdempotencyKey } from "./workflow-events";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type NotificationDigestMode = "IMMEDIATE" | "DAILY" | "WEEKLY";

export interface GlobalNotificationPreference {
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

export interface EventNotificationPreference {
  eventKey: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  digestMode: NotificationDigestMode;
  mutedUntil?: Date | string | null;
}

export interface EffectiveNotificationPreference {
  inAppEnabled: boolean;
  emailEnabled: boolean;
  digestMode: NotificationDigestMode;
  muted: boolean;
}

export interface InAppNotificationDraft {
  id: string;
  companyId: string;
  recipientUserId: string;
  workflowEventId: string;
  eventKey: string;
  dedupeKey: string;
  title: string;
  body: string;
  priority: NotificationPriority;
  routePath?: string;
  createdAt: string;
  readAt?: string;
  archivedAt?: string;
}

export interface BuildInAppNotificationInput {
  id?: string;
  companyId: string;
  recipientUserId: string;
  workflowEventId: string;
  eventKey: string;
  variant?: string;
  title: string;
  body: string;
  priority?: NotificationPriority;
  routePath?: string;
  createdAt?: Date | string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,119}$/;

function validDate(value: Date | string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

export function resolveNotificationPreference(
  globalPreference: GlobalNotificationPreference,
  eventPreference?: EventNotificationPreference,
  now: Date = new Date(),
): EffectiveNotificationPreference {
  const mutedUntil = eventPreference?.mutedUntil
    ? validDate(eventPreference.mutedUntil, "Notification mute time")
    : null;
  const muted = Boolean(mutedUntil && mutedUntil.getTime() > now.getTime());
  return {
    inAppEnabled: globalPreference.inAppEnabled
      && (eventPreference?.inAppEnabled ?? true)
      && !muted,
    emailEnabled: globalPreference.emailEnabled
      && (eventPreference?.emailEnabled ?? true)
      && !muted,
    digestMode: eventPreference?.digestMode ?? "IMMEDIATE",
    muted,
  };
}

export function notificationDedupeKey(input: Pick<
  BuildInAppNotificationInput,
  "workflowEventId" | "eventKey" | "variant"
>) {
  return workflowIdempotencyKey(
    "notification",
    input.workflowEventId,
    input.eventKey,
    input.variant?.trim() || "default",
  );
}

function validateRoutePath(routePath: string | undefined) {
  if (routePath === undefined) return;
  if (routePath.length > 500 || !routePath.startsWith("/")
    || routePath.startsWith("//") || routePath.includes("://")
    || /[\u0000-\u001f\u007f]/.test(routePath)) {
    throw new Error("Notification route must be a safe application-relative path.");
  }
}

function validateNotificationText(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain between 1 and ${maximum} characters.`);
  }
  return normalized;
}

export function buildInAppNotification(
  input: BuildInAppNotificationInput,
): InAppNotificationDraft {
  for (const [label, value] of [
    ["Notification id", input.id ?? ""],
    ["Company id", input.companyId],
    ["Recipient user id", input.recipientUserId],
    ["Workflow event id", input.workflowEventId],
  ] as const) {
    if (value && !UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
  }
  if (!EVENT_KEY_PATTERN.test(input.eventKey)) {
    throw new Error("Notification event key is invalid.");
  }
  if (input.priority !== undefined
    && !["LOW", "NORMAL", "HIGH", "URGENT"].includes(input.priority)) {
    throw new Error("Notification priority is invalid.");
  }
  validateRoutePath(input.routePath);
  const createdAt = validDate(input.createdAt ?? new Date(), "Notification creation time");
  return {
    id: input.id ?? randomUUID(),
    companyId: input.companyId,
    recipientUserId: input.recipientUserId,
    workflowEventId: input.workflowEventId,
    eventKey: input.eventKey,
    dedupeKey: notificationDedupeKey(input),
    title: validateNotificationText(input.title, "Notification title", 180),
    body: validateNotificationText(input.body, "Notification body", 2_000),
    priority: input.priority ?? "NORMAL",
    ...(input.routePath ? { routePath: input.routePath } : {}),
    createdAt: createdAt.toISOString(),
  };
}

export function deduplicateNotifications<T extends Pick<
  InAppNotificationDraft,
  "companyId" | "recipientUserId" | "dedupeKey"
>>(notifications: readonly T[]) {
  const byKey = new Map<string, T>();
  for (const notification of notifications) {
    const key = `${notification.companyId}:${notification.recipientUserId}:${notification.dedupeKey}`;
    if (!byKey.has(key)) byKey.set(key, notification);
  }
  return [...byKey.values()];
}

export function markNotificationRead<T extends InAppNotificationDraft>(
  notification: T,
  at: Date | string = new Date(),
): T {
  if (notification.readAt) return notification;
  const readAt = validDate(at, "Notification read time");
  if (readAt < new Date(notification.createdAt)) {
    throw new Error("Notification cannot be read before it was created.");
  }
  return { ...notification, readAt: readAt.toISOString() };
}

export function archiveNotification<T extends InAppNotificationDraft>(
  notification: T,
  at: Date | string = new Date(),
): T {
  if (notification.archivedAt) return notification;
  const archivedAt = validDate(at, "Notification archive time");
  if (archivedAt < new Date(notification.createdAt)) {
    throw new Error("Notification cannot be archived before it was created.");
  }
  return { ...notification, archivedAt: archivedAt.toISOString() };
}

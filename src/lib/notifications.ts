import { randomUUID } from "node:crypto";
import { workflowIdempotencyKey } from "./workflow-events";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type NotificationDigestMode = "IMMEDIATE" | "DAILY" | "WEEKLY";
export type NotificationCategory =
  | "ACCOUNT"
  | "LEAD"
  | "APPROVAL"
  | "BUDGET"
  | "SOURCING"
  | "DELIVERY"
  | "FINANCE"
  | "EMAIL"
  | "WORKFLOW";

export interface NotificationEventPolicy {
  eventKey: string;
  category: NotificationCategory;
  emailMandatory: boolean;
  defaultReminderHours?: number;
  companyConfigurable: boolean;
}

export const NOTIFICATION_EVENT_POLICIES = [
  { eventKey: "invitation.sent", category: "ACCOUNT", emailMandatory: true, companyConfigurable: false },
  { eventKey: "invitation.accepted", category: "ACCOUNT", emailMandatory: true, companyConfigurable: false },
  { eventKey: "password.changed", category: "ACCOUNT", emailMandatory: true, companyConfigurable: false },
  { eventKey: "email.verification", category: "ACCOUNT", emailMandatory: true, companyConfigurable: false },
  { eventKey: "company.lead.created", category: "LEAD", emailMandatory: false, defaultReminderHours: 24, companyConfigurable: false },
  { eventKey: "company.lead.submitted", category: "LEAD", emailMandatory: false, defaultReminderHours: 24, companyConfigurable: false },
  { eventKey: "company.lead.assigned", category: "LEAD", emailMandatory: false, defaultReminderHours: 24, companyConfigurable: false },
  { eventKey: "company.lead.reassigned", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.contacted", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.information_requested", category: "LEAD", emailMandatory: false, defaultReminderHours: 24, companyConfigurable: false },
  { eventKey: "company.lead.qualified", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.converted", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.rejected", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.archived", category: "LEAD", emailMandatory: false, companyConfigurable: false },
  { eventKey: "company.lead.sla_overdue", category: "LEAD", emailMandatory: true, defaultReminderHours: 12, companyConfigurable: false },
  { eventKey: "request.submitted", category: "WORKFLOW", emailMandatory: false, companyConfigurable: true },
  { eventKey: "request.status_changed", category: "WORKFLOW", emailMandatory: false, companyConfigurable: true },
  { eventKey: "request.approved", category: "APPROVAL", emailMandatory: false, companyConfigurable: true },
  { eventKey: "request.rejected", category: "APPROVAL", emailMandatory: false, companyConfigurable: true },
  { eventKey: "approval.needed", category: "APPROVAL", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "approval.company_required", category: "APPROVAL", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "budget.low", category: "BUDGET", emailMandatory: false, companyConfigurable: true },
  { eventKey: "budget.zero", category: "BUDGET", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "budget.refreshed", category: "BUDGET", emailMandatory: false, companyConfigurable: true },
  { eventKey: "budget.refresh_failed", category: "BUDGET", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "quotation.requested", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "quotation.received", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "supplier.selected", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "supplier.order_selected", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "supplier.order_acknowledged", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "supplier.rfq_acknowledged", category: "SOURCING", emailMandatory: false, companyConfigurable: true },
  { eventKey: "delivery.scheduled", category: "DELIVERY", emailMandatory: false, companyConfigurable: true },
  { eventKey: "driver.assigned", category: "DELIVERY", emailMandatory: false, defaultReminderHours: 12, companyConfigurable: true },
  { eventKey: "delivery.out_for_delivery", category: "DELIVERY", emailMandatory: false, companyConfigurable: true },
  { eventKey: "delivery.arrived", category: "DELIVERY", emailMandatory: false, companyConfigurable: true },
  { eventKey: "delivery.completed", category: "DELIVERY", emailMandatory: false, companyConfigurable: true },
  { eventKey: "receipt.required", category: "DELIVERY", emailMandatory: true, defaultReminderHours: 12, companyConfigurable: true },
  { eventKey: "receipt.confirmed", category: "DELIVERY", emailMandatory: false, companyConfigurable: true },
  { eventKey: "discrepancy.opened", category: "DELIVERY", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "invoice.issued", category: "FINANCE", emailMandatory: false, companyConfigurable: true },
  { eventKey: "payment.status_changed", category: "FINANCE", emailMandatory: false, companyConfigurable: true },
  { eventKey: "three_way_match.completed", category: "FINANCE", emailMandatory: false, companyConfigurable: true },
  { eventKey: "three_way_match.exception", category: "FINANCE", emailMandatory: true, defaultReminderHours: 24, companyConfigurable: true },
  { eventKey: "email.hard_bounce", category: "EMAIL", emailMandatory: true, companyConfigurable: false },
] as const satisfies readonly NotificationEventPolicy[];

export const NOTIFICATION_EVENT_KEYS = NOTIFICATION_EVENT_POLICIES.map(
  (policy) => policy.eventKey,
);

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
  emailMandatory: boolean;
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
  const policy = eventPreference
    ? NOTIFICATION_EVENT_POLICIES.find((item) => item.eventKey === eventPreference.eventKey)
    : undefined;
  const emailMandatory = policy?.emailMandatory ?? false;
  const muted = !emailMandatory
    && Boolean(mutedUntil && mutedUntil.getTime() > now.getTime());
  return {
    // In-app evidence is authoritative and cannot be suppressed by either a
    // legacy profile value, an event preference, or a temporary email mute.
    inAppEnabled: true,
    emailEnabled: emailMandatory || (globalPreference.emailEnabled
      && (eventPreference?.emailEnabled ?? true)
      && !muted),
    emailMandatory,
    digestMode: emailMandatory
      ? "IMMEDIATE"
      : eventPreference?.digestMode ?? "IMMEDIATE",
    muted,
  };
}

export function notificationPolicyForEvent(eventKey: string): NotificationEventPolicy {
  const configured = NOTIFICATION_EVENT_POLICIES.find(
    (policy) => policy.eventKey === eventKey,
  );
  if (configured) return configured;
  const category: NotificationCategory = eventKey.startsWith("company.lead.")
    ? "LEAD"
    : eventKey.startsWith("approval.") || eventKey.startsWith("request.approv")
      || eventKey.startsWith("request.reject")
      ? "APPROVAL"
      : eventKey.startsWith("budget.")
        ? "BUDGET"
        : eventKey.startsWith("quotation.") || eventKey.startsWith("supplier.")
          ? "SOURCING"
          : eventKey.startsWith("delivery.") || eventKey.startsWith("driver.")
            || eventKey.startsWith("receipt.") || eventKey.startsWith("discrepancy.")
            ? "DELIVERY"
            : eventKey.startsWith("invoice.") || eventKey.startsWith("payment.")
              || eventKey.startsWith("three_way_match.")
              ? "FINANCE"
              : eventKey.startsWith("invitation.") || eventKey.startsWith("password.")
                || eventKey.startsWith("account.")
                ? "ACCOUNT"
                : eventKey.startsWith("email.") ? "EMAIL" : "WORKFLOW";
  return { eventKey, category, emailMandatory: false, companyConfigurable: true };
}

export function notificationEmailIsMandatory(eventKey: string) {
  return notificationPolicyForEvent(eventKey).emailMandatory;
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

import { z } from "zod";
import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import {
  NOTIFICATION_EVENT_POLICIES,
  type NotificationCategory,
  type NotificationDigestMode,
  type NotificationPriority,
} from "./notifications";
import { customerNotificationKind, customerNotificationPresentation } from "./customer-notification-privacy";
import { isSupportedLocale } from "./i18n";

const uuid = z.uuid();
const statusFilterSchema = z.enum(["ALL", "UNREAD", "READ", "ARCHIVED"]);
const categorySchema = z.enum([
  "ACCOUNT", "LEAD", "APPROVAL", "BUDGET", "SOURCING",
  "DELIVERY", "FINANCE", "EMAIL", "WORKFLOW",
]);
const notificationSchema = z.object({
  id: uuid,
  eventKey: z.string().min(2).max(120),
  category: categorySchema,
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(2_000),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  routePath: z.string().max(500).nullable().optional(),
  createdAt: z.coerce.date().transform((value) => value.toISOString()),
  deliveredAt: z.coerce.date().transform((value) => value.toISOString()).nullable().optional(),
  readAt: z.coerce.date().transform((value) => value.toISOString()).nullable().optional(),
  archivedAt: z.coerce.date().transform((value) => value.toISOString()).nullable().optional(),
  expiresAt: z.coerce.date().transform((value) => value.toISOString()),
  stateVersion: z.coerce.number().int().positive(),
  reminderOfNotificationId: uuid.nullable().optional(),
  emailDeliveryRelated: z.boolean(),
}).transform((value) => ({
  ...value,
  ...(value.routePath ? { routePath: value.routePath } : {}),
  ...(value.deliveredAt ? { deliveredAt: value.deliveredAt } : {}),
  ...(value.readAt ? { readAt: value.readAt } : {}),
  ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}),
  ...(value.reminderOfNotificationId
    ? { reminderOfNotificationId: value.reminderOfNotificationId }
    : {}),
}));
const preferenceSchema = z.object({
  eventKey: z.string().min(2).max(120),
  category: categorySchema,
  mandatoryEmail: z.boolean(),
  emailEnabled: z.boolean(),
  deliverySchedule: z.enum(["IMMEDIATE", "DAILY", "WEEKLY"]),
  reminderHours: z.coerce.number().int().min(0).max(720).nullable().optional(),
  companyEmailEnabled: z.boolean().nullable().optional(),
  companyDeliverySchedule: z.enum(["IMMEDIATE", "DAILY", "WEEKLY"]).nullable().optional(),
  companyReminderHours: z.coerce.number().int().min(0).max(720).nullable().optional(),
  companyConfigurable: z.boolean(),
}).transform((value) => ({
  ...value,
  reminderHours: value.reminderHours ?? null,
  companyEmailEnabled: value.companyEmailEnabled ?? null,
  companyDeliverySchedule: value.companyDeliverySchedule ?? null,
  companyReminderHours: value.companyReminderHours ?? null,
}));
const summarySchema = z.object({
  capturedAt: z.coerce.date().transform((value) => value.toISOString()),
  unreadCount: z.coerce.number().int().nonnegative(),
  versionToken: z.string().regex(/^[0-9a-f]{32}$/),
});
const snapshotSchema = summarySchema.extend({
  filters: z.object({
    status: statusFilterSchema,
    category: z.union([z.literal("ALL"), categorySchema]),
  }),
  totalCount: z.coerce.number().int().nonnegative(),
  canManageCompanyPreferences: z.boolean(),
  companyId: uuid.nullable().optional(),
  notifications: z.array(notificationSchema),
  preferences: z.array(preferenceSchema),
}).transform((value) => ({
  ...value,
  ...(value.companyId ? { companyId: value.companyId } : {}),
}));
const commandResultSchema = z.object({
  changed: z.boolean(),
}).passthrough();

export type NotificationStatusFilter = z.infer<typeof statusFilterSchema>;
export type NotificationCenterCategoryFilter = "ALL" | NotificationCategory;
export type NotificationCenterItem = z.infer<typeof notificationSchema>;
export type NotificationPreferenceRecord = z.infer<typeof preferenceSchema>;
export type NotificationCenterSnapshot = z.infer<typeof snapshotSchema>;
export type NotificationSummary = z.infer<typeof summarySchema>;

export interface NotificationCenterFilters {
  status?: NotificationStatusFilter;
  category?: NotificationCenterCategoryFilter;
  limit?: number;
}

function requiredAssignment(actor: SessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new Error("Notifications are unavailable.");
  return parsed.data;
}

function demoPreferences(): NotificationPreferenceRecord[] {
  return NOTIFICATION_EVENT_POLICIES.map((policy) => ({
    eventKey: policy.eventKey,
    category: policy.category,
    mandatoryEmail: policy.emailMandatory,
    emailEnabled: true,
    deliverySchedule: "IMMEDIATE" as const,
    reminderHours: "defaultReminderHours" in policy
      ? policy.defaultReminderHours ?? null
      : null,
    companyEmailEnabled: null,
    companyDeliverySchedule: null,
    companyReminderHours: null,
    companyConfigurable: policy.companyConfigurable,
  }));
}

export async function notificationSummary(
  actor: SessionUser,
): Promise<NotificationSummary> {
  if (isDemoMode()) {
    return {
      capturedAt: new Date().toISOString(),
      unreadCount: 0,
      versionToken: "00000000000000000000000000000000",
    };
  }
  return withAuditTransaction(
    { actor, reason: "Viewed notification summary" },
    async (client) => {
      const result = await client.query<{ snapshot: unknown }>(`
        SELECT public.axora_notification_summary($1,$2,$3) AS snapshot
      `, [actor.id, requiredAssignment(actor), new Date()]);
      const parsed = summarySchema.safeParse(result.rows[0]?.snapshot);
      if (!parsed.success) throw new Error("Notifications are unavailable.");
      return parsed.data;
    },
  );
}

export async function notificationCenterSnapshot(
  actor: SessionUser,
  filters: NotificationCenterFilters = {},
): Promise<NotificationCenterSnapshot> {
  const normalizedFilters = {
    status: statusFilterSchema.catch("ALL").parse(filters.status ?? "ALL"),
    category: z.union([z.literal("ALL"), categorySchema])
      .catch("ALL").parse(filters.category ?? "ALL"),
    limit: Math.min(Math.max(Math.trunc(filters.limit ?? 100), 1), 200),
  };
  if (actor.accountKind === "COMPANY" && normalizedFilters.category === "SOURCING") {
    normalizedFilters.category = "ALL";
  }
  if (isDemoMode()) {
    return {
      capturedAt: new Date().toISOString(),
      unreadCount: 0,
      versionToken: "00000000000000000000000000000000",
      filters: {
        status: normalizedFilters.status,
        category: normalizedFilters.category,
      },
      totalCount: 0,
      canManageCompanyPreferences: actor.role === "COMPANY_ADMIN",
      ...(actor.companyId ? { companyId: actor.companyId } : {}),
      notifications: [],
      preferences: demoPreferences(),
    };
  }
  return withAuditTransaction(
    { actor, reason: "Viewed authorized notification centre" },
    async (client) => {
      const result = await client.query<{ snapshot: unknown }>(`
        SELECT public.axora_notification_center_snapshot(
          $1,$2,$3::jsonb,$4
        ) AS snapshot
      `, [
        actor.id,
        requiredAssignment(actor),
        JSON.stringify(normalizedFilters),
        new Date(),
      ]);
      const parsed = snapshotSchema.safeParse(result.rows[0]?.snapshot);
      if (!parsed.success) throw new Error("Notifications are unavailable.");
      if (actor.accountKind !== "COMPANY") return parsed.data;
      const locale = isSupportedLocale(actor.preferredLocale) ? actor.preferredLocale : "en";
      return {
        ...parsed.data,
        notifications: parsed.data.notifications.map((notification) => {
          const presentation = customerNotificationPresentation(notification.eventKey, locale);
          return presentation ? { ...notification, ...presentation } : notification;
        }),
        preferences: parsed.data.preferences.filter((preference) => !customerNotificationKind(preference.eventKey)),
      };
    },
  );
}

type NotificationCommandAction =
  | "MARK_READ"
  | "MARK_ALL_READ"
  | "ARCHIVE"
  | "SAVE_USER_PREFERENCE"
  | "SAVE_COMPANY_PREFERENCE";

async function executeNotificationCommand(
  actor: SessionUser,
  input: {
    commandId: string;
    action: NotificationCommandAction;
    payload?: Record<string, unknown>;
  },
) {
  const commandId = uuid.parse(input.commandId);
  if (isDemoMode()) return { changed: false };
  return withAuditTransaction(
    {
      actor,
      reason: `Notification ${input.action.toLowerCase().replaceAll("_", " ")}`,
      commandId,
    },
    async (client) => {
      const result = await client.query<{ result: unknown }>(`
        SELECT public.axora_notification_command(
          $1,$2,$3,$4,$5::jsonb,$6
        ) AS result
      `, [
        actor.id,
        requiredAssignment(actor),
        commandId,
        input.action,
        JSON.stringify(input.payload ?? {}),
        new Date(),
      ]);
      const parsed = commandResultSchema.safeParse(result.rows[0]?.result);
      if (!parsed.success) throw new Error("Notification action is unavailable.");
      return parsed.data;
    },
  );
}

export function markMyNotificationRead(
  actor: SessionUser,
  notificationId: string,
  commandId: string,
  stateVersion?: number,
) {
  return executeNotificationCommand(actor, {
    commandId,
    action: "MARK_READ",
    payload: {
      notificationId: uuid.parse(notificationId),
      ...(stateVersion ? { stateVersion } : {}),
    },
  });
}

export function markAllMyNotificationsRead(actor: SessionUser, commandId: string) {
  return executeNotificationCommand(actor, { commandId, action: "MARK_ALL_READ" });
}

export function archiveMyNotification(
  actor: SessionUser,
  notificationId: string,
  commandId: string,
) {
  return executeNotificationCommand(actor, {
    commandId,
    action: "ARCHIVE",
    payload: { notificationId: uuid.parse(notificationId) },
  });
}

export function saveMyNotificationPreference(
  actor: SessionUser,
  input: {
    commandId: string;
    scope: "USER" | "COMPANY";
    eventKey: string;
    emailEnabled: boolean;
    deliverySchedule: NotificationDigestMode;
    reminderHours: number;
    companyId?: string;
  },
) {
  const policy = NOTIFICATION_EVENT_POLICIES.find(
    (item) => item.eventKey === input.eventKey,
  );
  if (!policy) throw new Error("Notification preference is unavailable.");
  if (!Number.isInteger(input.reminderHours)
    || input.reminderHours < 0 || input.reminderHours > 720) {
    throw new Error("Notification preference is unavailable.");
  }
  return executeNotificationCommand(actor, {
    commandId: input.commandId,
    action: input.scope === "COMPANY"
      ? "SAVE_COMPANY_PREFERENCE"
      : "SAVE_USER_PREFERENCE",
    payload: {
      eventKey: input.eventKey,
      emailEnabled: policy.emailMandatory ? true : input.emailEnabled,
      deliverySchedule: policy.emailMandatory
        ? "IMMEDIATE"
        : input.deliverySchedule,
      reminderHours: input.reminderHours,
      ...(input.scope === "COMPANY"
        ? { companyId: uuid.parse(input.companyId) }
        : {}),
    },
  });
}

// Compatibility exports keep existing server callers stable while all access
// still crosses the new PostgreSQL capability boundary.
export async function unreadNotificationCount(actor: SessionUser) {
  return (await notificationSummary(actor)).unreadCount;
}

export async function listMyNotifications(actor: SessionUser) {
  return (await notificationCenterSnapshot(actor)).notifications;
}

export async function listMyNotificationPreferences(actor: SessionUser) {
  return (await notificationCenterSnapshot(actor)).preferences;
}

export type InAppNotificationRecord = NotificationCenterItem & {
  priority: NotificationPriority;
};

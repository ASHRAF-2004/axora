import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import type { SessionUser } from "@/lib/auth";
import {
  markMyNotificationRead,
  notificationCenterSnapshot,
  notificationSummary,
  saveMyNotificationPreference,
} from "@/lib/notification-repository";

const ids = {
  actor: "10000000-0000-4000-8000-000000000001",
  assignment: "10000000-0000-4000-8000-000000000002",
  company: "10000000-0000-4000-8000-000000000003",
  notification: "10000000-0000-4000-8000-000000000004",
  command: "10000000-0000-4000-8000-000000000005",
};

const actor: SessionUser = {
  id: ids.actor,
  email: "notifications@example.test",
  name: "Notification User",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: ids.company,
  roleAssignmentId: ids.assignment,
  isOwner: false,
};

const summary = {
  capturedAt: "2026-08-09T08:00:00.000Z",
  unreadCount: 1,
  versionToken: "a".repeat(32),
};

describe("notification repository capability boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads only a live-assignment PostgreSQL snapshot", async () => {
    mocks.client.query.mockResolvedValueOnce({
      rows: [{ snapshot: {
        ...summary,
        filters: { status: "UNREAD", category: "APPROVAL" },
        totalCount: 1,
        canManageCompanyPreferences: true,
        companyId: ids.company,
        notifications: [{
          id: ids.notification,
          eventKey: "approval.needed",
          category: "APPROVAL",
          title: "Approval required",
          body: "A request needs your decision.",
          priority: "HIGH",
          routePath: "/approvals",
          createdAt: "2026-08-09T07:00:00.000Z",
          deliveredAt: "2026-08-09T08:00:00.000Z",
          readAt: null,
          archivedAt: null,
          expiresAt: "2027-08-09T07:00:00.000Z",
          stateVersion: 2,
          reminderOfNotificationId: null,
          emailDeliveryRelated: true,
        }],
        preferences: [{
          eventKey: "approval.needed",
          category: "APPROVAL",
          mandatoryEmail: true,
          emailEnabled: true,
          deliverySchedule: "IMMEDIATE",
          reminderHours: 24,
          companyEmailEnabled: null,
          companyDeliverySchedule: null,
          companyReminderHours: null,
          companyConfigurable: true,
        }],
      } }],
    });
    const result = await notificationCenterSnapshot(actor, {
      status: "UNREAD",
      category: "APPROVAL",
    });
    expect(result.notifications[0]).toMatchObject({
      id: ids.notification,
      routePath: "/approvals",
      stateVersion: 2,
    });
    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(String(sql)).toContain("axora_notification_center_snapshot");
    expect(String(sql)).not.toMatch(/FROM\s+in_app_notifications/i);
    expect(values).toEqual([
      ids.actor,
      ids.assignment,
      JSON.stringify({ status: "UNREAD", category: "APPROVAL", limit: 100 }),
      expect.any(Date),
    ]);
  });

  it("uses narrow idempotent commands for read and mandatory preferences", async () => {
    mocks.client.query.mockResolvedValue({ rows: [{ result: { changed: true } }] });
    await markMyNotificationRead(actor, ids.notification, ids.command, 2);
    await saveMyNotificationPreference(actor, {
      commandId: "10000000-0000-4000-8000-000000000006",
      scope: "USER",
      eventKey: "approval.needed",
      emailEnabled: false,
      deliverySchedule: "WEEKLY",
      reminderHours: 24,
    });
    for (const [sql] of mocks.client.query.mock.calls) {
      expect(String(sql)).toContain("axora_notification_command");
      expect(String(sql)).not.toMatch(/UPDATE\s+in_app_notifications/i);
    }
    const preferencePayload = JSON.parse(
      String(mocks.client.query.mock.calls[1][1]?.[4]),
    );
    expect(preferencePayload).toMatchObject({
      eventKey: "approval.needed",
      emailEnabled: true,
      deliverySchedule: "IMMEDIATE",
    });
  });

  it("refuses to query without the exact live role assignment", async () => {
    const actorWithoutAssignment = { ...actor, roleAssignmentId: undefined };
    await expect(notificationSummary(actorWithoutAssignment)).rejects.toThrow(/unavailable/i);
    expect(mocks.client.query).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import {
  archiveNotification,
  buildInAppNotification,
  deduplicateNotifications,
  markNotificationRead,
  resolveNotificationPreference,
} from "@/lib/notifications";

const base = {
  id: "a0000000-0000-4000-8000-000000000001",
  companyId: "10000000-0000-4000-8000-000000000001",
  recipientUserId: "20000000-0000-4000-8000-000000000001",
  workflowEventId: "30000000-0000-4000-8000-000000000001",
  eventKey: "supplier.rfq.issued",
  title: "New RFQ",
  body: "A quotation response is requested.",
  routePath: "/supplier/rfqs/30000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-02T08:00:00.000Z",
};

describe("in-app notification records", () => {
  it("combines global and event preferences, including a temporary mute", () => {
    const result = resolveNotificationPreference(
      { inAppEnabled: true, emailEnabled: true },
      {
        eventKey: base.eventKey,
        inAppEnabled: true,
        emailEnabled: true,
        digestMode: "DAILY",
        mutedUntil: "2026-08-03T00:00:00.000Z",
      },
      new Date("2026-08-02T08:00:00.000Z"),
    );
    expect(result).toEqual({
      inAppEnabled: true,
      emailEnabled: false,
      emailMandatory: false,
      digestMode: "DAILY",
      muted: true,
    });
  });

  it("keeps mandatory workflow email immediate and in-app evidence authoritative", () => {
    const result = resolveNotificationPreference(
      { inAppEnabled: false, emailEnabled: false },
      {
        eventKey: "approval.needed",
        inAppEnabled: false,
        emailEnabled: false,
        digestMode: "WEEKLY",
        mutedUntil: "2099-08-03T00:00:00.000Z",
      },
      new Date("2026-08-02T08:00:00.000Z"),
    );
    expect(result).toEqual({
      inAppEnabled: true,
      emailEnabled: true,
      emailMandatory: true,
      digestMode: "IMMEDIATE",
      muted: false,
    });
  });

  it("derives a stable dedupe key and removes retry duplicates per recipient", () => {
    const first = buildInAppNotification(base);
    const retry = buildInAppNotification({ ...base, id: "a0000000-0000-4000-8000-000000000002" });
    expect(retry.dedupeKey).toBe(first.dedupeKey);
    expect(deduplicateNotifications([first, retry])).toEqual([first]);
  });

  it("accepts only relative routes and makes lifecycle timestamps monotonic", () => {
    expect(() => buildInAppNotification({ ...base, routePath: "https://attacker.test" }))
      .toThrow("relative path");
    const notification = buildInAppNotification(base);
    const read = markNotificationRead(notification, "2026-08-02T08:01:00.000Z");
    expect(markNotificationRead(read, "2026-08-02T08:02:00.000Z")).toBe(read);
    expect(archiveNotification(read, "2026-08-02T08:03:00.000Z").archivedAt)
      .toBe("2026-08-02T08:03:00.000Z");
    expect(() => markNotificationRead(notification, "2026-08-01T08:00:00.000Z"))
      .toThrow("before");
  });
});

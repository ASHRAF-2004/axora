import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  notifyWorkflowUsers,
  type PersistedWorkflowEvent,
} from "@/lib/workflow-repository";

const event: PersistedWorkflowEvent = {
  id: "00000000-0000-4000-8000-000000000051",
  companyId: "00000000-0000-4000-8000-000000000052",
  requestId: "00000000-0000-4000-8000-000000000053",
  aggregateType: "request",
  aggregateId: "00000000-0000-4000-8000-000000000053",
  eventKey: "request.approved",
  eventVersion: 2,
  correlationId: "00000000-0000-4000-8000-000000000053",
  occurredAt: "2026-08-02T08:00:00.000Z",
  created: true,
};
const recipientUserId = "00000000-0000-4000-8000-000000000054";

function clientWithPreference(input: {
  globalInAppEnabled: boolean;
  globalEmailEnabled: boolean;
  eventInAppEnabled?: boolean;
  eventEmailEnabled?: boolean;
  digestMode?: "IMMEDIATE" | "DAILY" | "WEEKLY";
  mutedUntil?: string;
  recipientLocale?: "en" | "ar" | "ms";
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("axora_workflow_notification_preference")) {
      return {
        rowCount: 1,
        rows: [{
          ...input,
          eventPreferenceExists: true,
          digestMode: input.digestMode ?? "IMMEDIATE",
          recipientLocale: input.recipientLocale ?? "en",
        }],
      };
    }
    if (sql.includes("axora_enqueue_workflow_email")) {
      return {
        rowCount: 1,
        rows: [{ id: "00000000-0000-4000-8000-000000000055" }],
      };
    }
    if (sql.includes("INSERT INTO in_app_notifications")) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as PoolClient;
}

describe("independent workflow notification preferences", () => {
  it("queues email when in-app is disabled", async () => {
    const client = clientWithPreference({
      globalInAppEnabled: true,
      globalEmailEnabled: true,
      eventInAppEnabled: false,
      eventEmailEnabled: true,
      digestMode: "DAILY",
    });
    const inserted = await notifyWorkflowUsers(client, event, {
      recipientUserIds: [recipientUserId, recipientUserId],
      message: { key: "request_approved" },
      routePath: `/requests/${event.requestId}`,
    });

    expect(inserted).toBe(0);
    const calls = vi.mocked(client.query).mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => sql.includes("axora_enqueue_workflow_email"))).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO in_app_notifications"))).toBe(false);
  });

  it("creates in-app notification when email is disabled", async () => {
    const client = clientWithPreference({
      globalInAppEnabled: true,
      globalEmailEnabled: true,
      eventInAppEnabled: true,
      eventEmailEnabled: false,
    });
    const inserted = await notifyWorkflowUsers(client, event, {
      recipientUserIds: [recipientUserId],
      message: { key: "request_approved" },
    });

    expect(inserted).toBe(1);
    const calls = vi.mocked(client.query).mock.calls.map(([sql]) => String(sql));
    expect(calls.some((sql) => sql.includes("INSERT INTO in_app_notifications"))).toBe(true);
    expect(calls.some((sql) => sql.includes("axora_enqueue_workflow_email"))).toBe(false);
  });

  it("honors a temporary mute for both channels", async () => {
    const client = clientWithPreference({
      globalInAppEnabled: true,
      globalEmailEnabled: true,
      eventInAppEnabled: true,
      eventEmailEnabled: true,
      mutedUntil: "2099-08-03T08:00:00.000Z",
    });
    await expect(notifyWorkflowUsers(client, event, {
      recipientUserIds: [recipientUserId],
      message: { key: "request_approved" },
    })).resolves.toBe(0);
    expect(vi.mocked(client.query)).toHaveBeenCalledOnce();
  });

  it("renders stored and emailed content in the recipient's saved locale", async () => {
    const client = clientWithPreference({
      globalInAppEnabled: true,
      globalEmailEnabled: true,
      eventInAppEnabled: true,
      eventEmailEnabled: true,
      recipientLocale: "ar",
    });
    await notifyWorkflowUsers(client, event, {
      recipientUserIds: [recipientUserId],
      message: { key: "request_approved" },
    });

    const calls = vi.mocked(client.query).mock.calls;
    const inApp = calls.find(([sql]) => String(sql).includes("INSERT INTO in_app_notifications"));
    const email = calls.find(([sql]) => String(sql).includes("axora_enqueue_workflow_email"));
    expect(inApp?.[1]).toEqual(expect.arrayContaining([
      "تم اعتماد طلب الشراء",
      "اعتمدت الشركة طلب الشراء، ويمكن لأكسورا بدء التوريد.",
    ]));
    expect(email?.[1]).toEqual(expect.arrayContaining([
      "تم اعتماد طلب الشراء",
      "اعتمدت الشركة طلب الشراء، ويمكن لأكسورا بدء التوريد.",
    ]));
  });
});

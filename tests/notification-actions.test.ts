import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: { id: "10000000-0000-4000-8000-000000000001" },
  requireSession: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  archive: vi.fn(),
  savePreference: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/auth", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/notification-repository", () => ({
  archiveMyNotification: mocks.archive,
  markAllMyNotificationsRead: mocks.markAllRead,
  markMyNotificationRead: mocks.markRead,
  saveMyNotificationPreference: mocks.savePreference,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { markNotificationReadAction } from
  "@/app/(portal)/notifications/actions";

describe("notification action return state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockResolvedValue(mocks.actor);
    mocks.markRead.mockResolvedValue(undefined);
  });

  it("returns to the same validated status and category after mutation", async () => {
    const form = new FormData();
    form.set("commandId", "20000000-0000-4000-8000-000000000001");
    form.set("notificationId", "20000000-0000-4000-8000-000000000002");
    form.set("stateVersion", "2");
    form.set("returnStatus", "UNREAD");
    form.set("returnCategory", "DELIVERY");

    await expect(markNotificationReadAction(form)).rejects.toThrow(
      "REDIRECT:/notifications?notice=saved&status=UNREAD&category=DELIVERY",
    );
    expect(mocks.markRead).toHaveBeenCalledOnce();
  });

  it("drops forged return filters from a denied mutation", async () => {
    const form = new FormData();
    form.set("commandId", "invalid");
    form.set("notificationId", "invalid");
    form.set("returnStatus", "OWNER_ONLY");
    form.set("returnCategory", "../../companies");

    await expect(markNotificationReadAction(form)).rejects.toThrow(
      "REDIRECT:/notifications?notice=denied",
    );
    expect(mocks.markRead).not.toHaveBeenCalled();
  });
});

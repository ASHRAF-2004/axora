import { afterEach, describe, expect, it, vi } from "vitest";
import { protectedLiveRefresh } from "@/lib/protected-live-refresh";
describe("scoped safe live refresh", () => {
  afterEach(() => vi.useRealTimers());
  it("coalesces changes without refresh storms", async () => {
    vi.useFakeTimers(); const refresh = vi.fn(); const deferred = vi.fn();
    const scheduler = protectedLiveRefresh({ blocked: () => false, refresh, deferred, later: setTimeout, clear: clearTimeout });
    for (let index = 0; index < 30; index++) scheduler.changed();
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["dirty quantity", "approval reason", "focused filter", "branch chooser", "modal", "offline"])("defers %s without losing the pending canonical read", async () => {
    vi.useFakeTimers(); let blocked = true; const refresh = vi.fn(); const deferred = vi.fn();
    const scheduler = protectedLiveRefresh({ blocked: () => blocked, refresh, deferred, later: setTimeout, clear: clearTimeout });
    scheduler.changed(); await vi.advanceTimersByTimeAsync(10_000);
    expect(refresh).not.toHaveBeenCalled(); expect(deferred).toHaveBeenCalledWith(true);
    blocked = false; await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1); expect(deferred).toHaveBeenLastCalledWith(false);
    scheduler.stop();
  });
});

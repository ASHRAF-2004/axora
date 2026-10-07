import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedLiveClient, type LiveClientEnvironment } from "@/lib/shared-live-client";
import { acceptLiveFrame, parseLiveSubscription } from "@/lib/live-update-contract";

const epochA = "00000000-0000-4000-8000-000000000001";
const epochB = "00000000-0000-4000-8000-000000000002";
const version = "a".repeat(64);
const frame = (epoch = epochA, sequence = 1, next = version) => ({ epoch, sequence, resync: sequence === 1, snapshot: { topics: { notifications: { version: next, unreadCount: 1 } } } });
class FakeSource {
  handlers = new Map<string, (event: MessageEvent<string>) => void>();
  onerror: ((event: Event) => unknown) | null = null;
  closed = false;
  addEventListener(type: string, receive: (event: MessageEvent<string>) => void) { this.handlers.set(type, receive); }
  close() { this.closed = true; }
  emit(value: unknown) { this.handlers.get("snapshot")?.({ data: JSON.stringify(value) } as MessageEvent<string>); }
}
function setup(withSource = true) {
  let visible = true;
  const sources: FakeSource[] = [];
  const read = vi.fn(async () => ({ status: 200, snapshot: frame().snapshot }));
  const environment: LiveClientEnvironment = {
    ...(withSource ? { source: vi.fn(() => { const source = new FakeSource(); sources.push(source); return source; }) } : {}),
    read, visible: () => visible, online: () => true,
    later: (callback, ms) => setTimeout(callback, ms), clear: (timer) => clearTimeout(timer),
  };
  const client = new SharedLiveClient(environment);
  return { client, environment, sources, read, hide: () => { visible = false; client.visibilityChanged(); }, show: () => { visible = true; client.visibilityChanged(); } };
}

describe("shared live snapshot contract", () => {
  afterEach(() => vi.useRealTimers());
  it("requires bounded allowlisted topics and strict context identifiers", () => {
    expect(parseLiveSubscription(new URL("https://axora.invalid/api/live?topics=notifications,drivers")).topics).toEqual(["notifications", "drivers"]);
    for (const search of ["topics=other", "topics=notifications,notifications", "topics=notifications&token=secret", "topics=driver&driverId=foreign", "topics=notifications&companyId=00000000-0000-4000-8000-000000000001", "topics=notifications&topics=jobs"]) {
      expect(() => parseLiveSubscription(new URL(`https://axora.invalid/api/live?${search}`))).toThrow();
    }
  });
  it("accepts reset sequences only under explicit new-epoch resync", () => {
    expect(acceptLiveFrame({ epoch: epochA, sequence: 8 }, frame(epochB))).not.toBeNull();
    expect(acceptLiveFrame({ epoch: epochA, sequence: 8 }, frame(epochA, 7))).toBeNull();
    expect(acceptLiveFrame({ epoch: epochA, sequence: 8 }, frame(epochB, 2))).toBeNull();
    expect(acceptLiveFrame(null, { ...frame(), snapshot: { topics: { supplier: { version } } } })).toBeNull();
  });
  it("fans one connection out independently and prevents duplicate reads", async () => {
    vi.useFakeTimers();
    const { client, sources, environment } = setup();
    const first = vi.fn(); const second = vi.fn();
    client.subscribe("notifications", {}, first);
    client.subscribe("notifications", {}, second);
    client.start();
    sources[0].emit(frame());
    sources[0].emit(frame(epochA, 2));
    expect(environment.source).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    sources[0].emit(frame(epochB, 1, "b".repeat(64)));
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    sources[0].emit(frame(epochA, 1));
    expect(first).toHaveBeenCalledTimes(2);
    client.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("polls on errors, backs off, and accepts a fresh reconnect snapshot", async () => {
    vi.useFakeTimers();
    const { client, sources, read } = setup();
    const receive = vi.fn(); const statuses: string[] = [];
    client.subscribe("notifications", {}, receive); client.onStatus((status) => statuses.push(status)); client.start();
    sources[0].emit(frame(epochA, 1));
    sources[0].onerror?.(new Event("error"));
    expect(sources[0].closed).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    expect(statuses).toContain("polling");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sources).toHaveLength(2);
    sources[1].emit(frame(epochB, 1, "b".repeat(64)));
    expect(receive).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe("current");
    client.stop();
  });
  it("pauses hidden views and cleans stale source callbacks/timers", async () => {
    vi.useFakeTimers();
    const { client, sources, hide, show, read } = setup();
    const receive = vi.fn(); client.subscribe("notifications", {}, receive); client.start();
    hide(); sources[0].emit(frame());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(receive).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    show(); sources[1].emit(frame(epochB));
    expect(receive).toHaveBeenCalledTimes(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("invalidates a delayed fallback response after a newer reconnect frame", async () => {
    vi.useFakeTimers();
    const { client, sources, environment } = setup();
    let finish!: (result: { status: number; snapshot: ReturnType<typeof frame>["snapshot"] }) => void;
    let signal!: AbortSignal;
    environment.read = vi.fn((_url, pendingSignal) => {
      signal = pendingSignal;
      return new Promise<{ status: number; snapshot: ReturnType<typeof frame>["snapshot"] }>((resolve) => { finish = resolve; });
    });
    const receive = vi.fn(); const statuses: string[] = [];
    client.subscribe("notifications", {}, receive); client.onStatus((status) => statuses.push(status)); client.start();
    sources[0].emit(frame());
    sources[0].onerror?.(new Event("error"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal.aborted).toBe(false);
    sources[1].emit({ ...frame(epochB, 1, "b".repeat(64)), snapshot: { topics: { notifications: { version: "b".repeat(64), unreadCount: 9 } } } });
    expect(signal.aborted).toBe(true);
    finish({ status: 200, snapshot: frame().snapshot });
    await vi.advanceTimersByTimeAsync(0);
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenLastCalledWith({ version: "b".repeat(64), unreadCount: 9 });
    expect(statuses.at(-1)).toBe("current");
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses bounded read polling without EventSource and stops on auth loss", async () => {
    vi.useFakeTimers();
    const { client, read } = setup(false);
    const receive = vi.fn(); client.subscribe("notifications", {}, receive); client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(receive).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce({ status: 401, snapshot: frame().snapshot });
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    client.stop();
  });
});

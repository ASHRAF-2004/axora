import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveDetailReader } from "@/lib/live-detail-read";

describe("live authorized detail reads", () => {
  afterEach(() => vi.useRealTimers());
  it.each([401, 403])("does not retry or parse a %s authorization loss", async (status) => {
    vi.useFakeTimers();
    const json = vi.fn(); const read = vi.fn(async () => ({ status, ok: false, json }) as unknown as Response);
    const apply = vi.fn(); const failed = vi.fn();
    const reader = new LiveDetailReader("/api/authorized-detail", apply, failed, read);
    reader.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1); expect(failed).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0); reader.stop();
  });
  it("bounds transient read retries and preserves existing cookie read semantics", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => new Response(null, { status: 503 }));
    const failed = vi.fn(); const reader = new LiveDetailReader("/api/authorized-detail", vi.fn(), failed, read);
    reader.refresh(); await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(4); expect(failed).toHaveBeenCalledTimes(4);
    expect(read).toHaveBeenCalledWith("/api/authorized-detail", expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }));
    reader.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("ignores a late resolution after scoped reader cleanup", async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const read = vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const apply = vi.fn(); const failed = vi.fn();
    const reader = new LiveDetailReader("/api/authorized-detail", apply, failed, read);
    reader.refresh(); reader.stop(); finish(Response.json({ value: "stale" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

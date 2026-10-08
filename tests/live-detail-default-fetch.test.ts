import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveDetailReader } from "@/lib/live-detail-read";

describe("live detail default browser fetch receiver", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("calls default fetch without assigning the reader as its native receiver", async () => {
    vi.useFakeTimers();
    // Browser fetch accepts an ordinary global/bare call, but not a foreign
    // object receiver. Node fetch and receiver-insensitive mocks miss this.
    const read = vi.fn(async function browserFetch(this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return Response.json({ jobs: ["authorized-default-fetch"] });
    });
    vi.stubGlobal("fetch", read);
    const apply = vi.fn();
    const failed = vi.fn();
    const reader = new LiveDetailReader("/api/driver/jobs", apply, failed);

    try {
      reader.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith("/api/driver/jobs", expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }));
      expect(apply).toHaveBeenCalledWith({ jobs: ["authorized-default-fetch"] });
      expect(failed).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      reader.stop();
    }
  });
});

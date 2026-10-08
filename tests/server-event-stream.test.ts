import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotEventStream } from "@/lib/server-event-stream";

async function firstEvent(response: Response, abort: AbortController) {
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  abort.abort();
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(chunk.value);
}

describe("snapshot event streams", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
  it("resynchronizes under a new epoch rather than comparing reset sequences", async () => {
    const firstAbort = new AbortController();
    const first = snapshotEventStream(
      new Request("https://axora.invalid/live", { signal: firstAbort.signal }),
      async () => ({ sequence: 4_000_000_000_000, value: "first" }),
      60_000,
    );
    const firstPayload = await firstEvent(first, firstAbort);

    const secondAbort = new AbortController();
    const second = snapshotEventStream(
      new Request("https://axora.invalid/live", { signal: secondAbort.signal }),
      async () => ({ sequence: 4_000_000_000_001, value: "reconnected" }),
      60_000,
    );
    const secondPayload = await firstEvent(second, secondAbort);

    expect(firstPayload).toContain('"sequence":4000000000000');
    expect(secondPayload).toContain('"sequence":4000000000001');
    expect(secondPayload).toContain('"value":"reconnected"');
    const decode = (frame: string) => JSON.parse(frame.split("data: ")[1].trim());
    expect(decode(firstPayload).sequence).toBe(1);
    expect(decode(secondPayload).sequence).toBe(1);
    expect(decode(secondPayload).epoch).not.toBe(decode(firstPayload).epoch);
    expect(decode(secondPayload).resync).toBe(true);
  });

  it("rejects malformed cursors; unknown bounded cursors still get fresh state", async () => {
    expect(snapshotEventStream(new Request("https://axora.invalid/live", { headers: { "Last-Event-ID": "bad\"cursor" } }), async () => ({})).status).toBe(400);
    const abort = new AbortController();
    const response = snapshotEventStream(new Request("https://axora.invalid/live", { signal: abort.signal, headers: { "Last-Event-ID": "f".repeat(64) } }), async () => ({ committed: true }));
    expect(await firstEvent(response, abort)).toContain('"resync":true');
  });

  it("keeps canonical reads available when the stream kill switch returns 204", () => {
    vi.stubEnv("AXORA_SSE_ENABLED", "false");
    const load = vi.fn(async () => ({}));
    expect(snapshotEventStream(new Request("https://axora.invalid/live"), load).status).toBe(204);
    expect(load).not.toHaveBeenCalled();
  });

  it("checks authorization before the read and immediately before emission", async () => {
    const abort = new AbortController();
    const authorize = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    const response = snapshotEventStream(new Request("https://axora.invalid/live", { signal: abort.signal }), async () => ({ secret: "must-not-emit" }), 10_000, { authorize });
    const payload = await firstEvent(response, abort);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(payload).toContain("event: unavailable");
    expect(payload).not.toContain("must-not-emit");
  });

  it("cleans up aborted pending loads without late enqueue or a second load", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let finish!: (value: unknown) => void;
    const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const response = snapshotEventStream(new Request("https://axora.invalid/live", { signal: abort.signal }), load);
    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    finish({ late: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await response.body!.getReader().read()).toEqual({ value: undefined, done: true });
    expect(load).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes slow loads and emits heartbeat without timestamp churn", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const load = vi.fn(async () => ({ value: "unchanged", capturedAt: Date.now() }));
    const response = snapshotEventStream(new Request("https://axora.invalid/live", { signal: abort.signal }), load, 5_000, { version: () => "stable" });
    const reader = response.body!.getReader();
    await vi.advanceTimersByTimeAsync(0);
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: snapshot");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(": heartbeat\n\n");
    expect(load).toHaveBeenCalledTimes(4);
    abort.abort();
    await reader.cancel();
  });

  it("bounds message bytes and same-scope connections, releasing slots on cancel", async () => {
    const request = () => new Request("https://axora.invalid/live");
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    for (let index = 0; index < 3; index++) {
      const response = snapshotEventStream(request(), async () => ({}), 10_000, { connectionScope: "isolated-fixture" });
      const reader = response.body!.getReader();
      await reader.read();
      readers.push(reader);
    }
    expect(snapshotEventStream(request(), async () => ({}), 10_000, { connectionScope: "isolated-fixture" }).status).toBe(429);
    await Promise.all(readers.map((reader) => reader.cancel()));
    const large = snapshotEventStream(request(), async () => ({ body: "a".repeat(65_536) }), 10_000, { connectionScope: "isolated-fixture" });
    expect((await large.body!.getReader().read()).done).toBe(true);
  });
  it("retains a pending-read quota after abort until the underlying read settles", async () => {
    const abort = new AbortController();
    let finish!: (value: unknown) => void;
    const first = snapshotEventStream(new Request("https://axora.invalid/live", { signal: abort.signal }), () => new Promise((resolve) => { finish = resolve; }), 10_000, { connectionScope: "pending-fixture" });
    await Promise.resolve();
    abort.abort();
    const load = vi.fn(async () => ({}));
    const second = snapshotEventStream(new Request("https://axora.invalid/live"), load, 10_000, { connectionScope: "pending-fixture" });
    expect(new TextDecoder().decode((await second.body!.getReader().read()).value)).toContain("event: unavailable");
    expect(load).not.toHaveBeenCalled();
    finish({ late: true });
    await first.body!.cancel();
    await Promise.resolve();
  });
});

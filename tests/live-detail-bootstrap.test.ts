import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  subscribe: vi.fn(() => vi.fn()),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => { lifecycle.effects.push(effect); },
  useRef: <T,>(current: T) => ({ current }),
  useContext: () => ({ subscribe: lifecycle.subscribe }),
}));
import { useLiveRead } from "@/components/LiveUpdatesProvider";

function BootstrapFixture(apply: (value: { jobs: string[] }) => void, failed = vi.fn()) {
  useLiveRead("jobs", "/api/driver/jobs", apply, {}, failed);
  const cleanup = lifecycle.effects.map((effect) => effect()).filter((value): value is () => void => typeof value === "function");
  return () => cleanup.reverse().forEach((stop) => stop());
}

describe("live detail mount bootstrap", () => {
  beforeEach(() => { lifecycle.effects = []; vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("loads the existing authorized workspace without waiting for any hint", async () => {
    const read = vi.fn(async () => Response.json({ jobs: ["available-fixture"] }));
    vi.stubGlobal("fetch", read);
    const apply = vi.fn(); const stop = BootstrapFixture(apply);
    await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.subscribe).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith("/api/driver/jobs", expect.objectContaining({ cache: "no-store", credentials: "same-origin", signal: expect.any(AbortSignal) }));
    expect(apply).toHaveBeenCalledWith({ jobs: ["available-fixture"] });
    stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401, 403])("does not retry a denied bootstrap read (%s)", async (status) => {
    const read = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", read);
    const apply = vi.fn(); const failed = vi.fn(); const stop = BootstrapFixture(apply, failed);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1); expect(failed).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled(); stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts the bootstrap on unmount and leaves existing state untouched", async () => {
    let finish!: (response: Response) => void;
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => {
      signal = options.signal as AbortSignal;
      return new Promise<Response>((resolve) => { finish = resolve; });
    }));
    const workspace = { jobs: ["existing-state"] };
    const apply = vi.fn((value: typeof workspace) => { workspace.jobs = value.jobs; });
    const failed = vi.fn(); const stop = BootstrapFixture(apply, failed);
    stop(); expect(signal.aborted).toBe(true);
    finish(Response.json({ jobs: ["late-stale-state"] }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workspace.jobs).toEqual(["existing-state"]);
    expect(apply).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

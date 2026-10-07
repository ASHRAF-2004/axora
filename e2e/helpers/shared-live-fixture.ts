import { expect, type Page } from "@playwright/test";

/** Controlled hints contain no detail data; consumers must reload their authorized GET. */
export async function installSharedLiveFixture(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent<string>) => void;
    const sources = new Set<FixtureEventSource>();
    const runtime = window as unknown as {
      __axoraLiveFixtureUrls?: () => string[];
      __emitAxoraLiveFixture?: (topic: string, sequence: number) => void;
    };
    class FixtureEventSource {
      readonly url: string;
      private listeners = new Map<string, Listener[]>();
      constructor(url: string) { this.url = url; sources.add(this); }
      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as unknown as Listener]);
      }
      emit(event: MessageEvent<string>) { this.listeners.get("snapshot")?.forEach((listener) => listener(event)); }
      close() { this.listeners.clear(); sources.delete(this); }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: FixtureEventSource });
    runtime.__axoraLiveFixtureUrls = () => [...sources].map((source) => source.url);
    runtime.__emitAxoraLiveFixture = (topic, sequence) => {
      const matching = [...sources].filter((source) => new URL(source.url, location.origin).searchParams.get("topics")?.split(",").includes(topic));
      if (matching.length !== 1) throw new Error("Expected one scoped shared live source");
      matching[0].emit(new MessageEvent("snapshot", { data: JSON.stringify({
        epoch: "00000000-0000-4000-8000-000000000002",
        sequence,
        ...(sequence === 1 ? { resync: true } : {}),
        snapshot: { topics: { [topic]: { version: sequence.toString(16).padStart(64, "0") } } },
      }) }));
    };
  });
}

export async function expectSharedLiveFixture(page: Page, topic: string, context?: { key: string; value: string }) {
  await expect.poll(() => page.evaluate(({ expectedTopic, expectedContext }) => {
    const runtime = window as unknown as { __axoraLiveFixtureUrls?: () => string[] };
    const urls = runtime.__axoraLiveFixtureUrls?.() ?? [];
    return urls.length === 1 && urls.some((value) => {
      const url = new URL(value, location.origin);
      return url.pathname === "/api/live" && url.searchParams.get("topics")?.split(",").includes(expectedTopic)
        && (!expectedContext || url.searchParams.get(expectedContext.key) === expectedContext.value);
    });
  }, { expectedTopic: topic, expectedContext: context })).toBe(true);
}

export async function emitSharedLiveFixture(page: Page, topic: string, sequence: number) {
  await page.evaluate(({ expectedTopic, nextSequence }) => {
    const runtime = window as unknown as { __emitAxoraLiveFixture?: (topic: string, sequence: number) => void };
    if (!runtime.__emitAxoraLiveFixture) throw new Error("Shared live fixture is not installed");
    runtime.__emitAxoraLiveFixture(expectedTopic, nextSequence);
  }, { expectedTopic: topic, nextSequence: sequence });
}

import { describe, expect, it } from "vitest";
import { snapshotEventStream } from "@/lib/server-event-stream";

async function firstEvent(response: Response, abort: AbortController) {
  const reader = response.body!.getReader();
  const chunk = await reader.read();
  abort.abort();
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(chunk.value);
}

describe("snapshot event streams", () => {
  it("uses authoritative monotonic sequence values across reconnects", async () => {
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
  });
});

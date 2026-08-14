import { createHash } from "node:crypto";

type SnapshotLoader = () => Promise<unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}

export function authoritativeSnapshotVersion(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(snapshot))).digest("hex");
}

/**
 * Bounded near-live authoritative snapshot polling transported over SSE.
 * This is deliberately not described as database-event push. Each connection
 * starts with a full snapshot, emits only changed versions, and uses a local
 * monotonic sequence solely to reject duplicate/out-of-order transport data.
 */
export function snapshotEventStream(request: Request, load: SnapshotLoader, intervalMs = 10_000) {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let sequence = 0;
  let previousVersion: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (lifetime) clearTimeout(lifetime);
        try { controller.close(); } catch { /* Already closed by the client. */ }
      };
      const emit = async () => {
        if (closed) return;
        try {
          const snapshot = await load();
          const version = authoritativeSnapshotVersion(snapshot);
          if (version === previousVersion) return;
          previousVersion = version;
          sequence += 1;
          controller.enqueue(encoder.encode(`id: ${version}\nevent: snapshot\ndata: ${JSON.stringify({ sequence, version, snapshot })}\n\n`));
        } catch {
          controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
          close();
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      void emit();
      interval = setInterval(() => void emit(), Math.max(5_000, intervalMs));
      lifetime = setTimeout(close, 55_000);
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
      if (lifetime) clearTimeout(lifetime);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

export const serverEventStreamInternals = { canonicalize };

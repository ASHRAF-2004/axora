import { createHash, randomUUID } from "node:crypto";

type SnapshotLoader = () => Promise<unknown>;
interface StreamOptions {
  /** Revalidate the live session/permissions, not the actor captured at open. */
  authorize?: () => Promise<void>;
  version?: (snapshot: unknown) => string;
  /** Operational limits only, never canonical business state. */
  connectionScope?: string;
}
const MAX_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 128;
const MAX_SCOPE_CONNECTIONS = 3;
const connections = new Map<string, number>();
let activeConnections = 0;
let pendingLoads = 0;
const scopeLoads = new Set<string>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalize(child)]));
}

export function authoritativeSnapshotVersion(snapshot: unknown) {
  return createHash("sha256").update(JSON.stringify(canonicalize(snapshot))).digest("hex");
}

export function eventStreamsEnabled() {
  return process.env.AXORA_SSE_ENABLED !== "false";
}
const headers = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  "Content-Type": "text/event-stream; charset=utf-8",
  Vary: "Cookie",
  "X-Accel-Buffering": "no",
};

/**
 * Bounded polling of committed authorized snapshots, not persisted event replay.
 * Every connection starts with current-state resync. Last-Event-ID is validated
 * but never used as authority or as a persisted history cursor.
 */
export function snapshotEventStream(request: Request, load: SnapshotLoader, intervalMs = 10_000, options: StreamOptions = {}) {
  if (!eventStreamsEnabled()) return new Response(null, { status: 204, headers });
  const cursor = request.headers.get("last-event-id");
  if (cursor !== null && !/^[a-f0-9]{64}$/.test(cursor)) return new Response(null, { status: 400, headers });
  const scope = options.connectionScope;
  if (activeConnections >= MAX_CONNECTIONS
    || (scope && (connections.get(scope) ?? 0) >= MAX_SCOPE_CONNECTIONS)) {
    return new Response(null, { status: 429, headers: { ...headers, "Retry-After": "15" } });
  }
  activeConnections += 1;
  if (scope) connections.set(scope, (connections.get(scope) ?? 0) + 1);
  const encoder = new TextEncoder();
  const epoch = randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let sequence = 0;
  let previousVersion: string | null = null;
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        cleanup();
        try { controller.close(); } catch { /* Already cancelled by the reader. */ }
      };
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        clearTimeout(lifetime);
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", close);
        activeConnections -= 1;
        if (scope) {
          const remaining = (connections.get(scope) ?? 1) - 1;
          if (remaining > 0) connections.set(scope, remaining);
          else connections.delete(scope);
        }
      };
      const enqueue = (frame: string) => {
        if (closed || request.signal.aborted) { close(); return false; }
        const bytes = encoder.encode(frame);
        if (bytes.length > MAX_BYTES || (controller.desiredSize ?? 0) < bytes.length) {
          close();
          return false;
        }
        controller.enqueue(bytes);
        return true;
      };
      const emit = async () => {
        if (closed) return;
        try {
          // Aborted/timed-out reads keep their slot until the underlying DB read
          // settles, so rapid reconnects cannot enqueue an unbounded pool backlog.
          if (pendingLoads >= 16 || (scope && scopeLoads.has(scope))) throw new Error("unavailable");
          pendingLoads += 1;
          if (scope) scopeLoads.add(scope);
          const snapshot = await Promise.race([
            (async () => {
              try {
                await options.authorize?.();
                if (closed) throw new Error("closed");
                const value = await load();
                if (closed) throw new Error("closed");
                // Revocation can race the read; check again before emit.
                await options.authorize?.();
                return value;
              } finally {
                pendingLoads -= 1;
                if (scope) scopeLoads.delete(scope);
              }
            })(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error("unavailable")), 25_000);
            }),
          ]);
          clearTimeout(timeout);
          if (closed || request.signal.aborted) return;
          const version = options.version?.(snapshot) ?? authoritativeSnapshotVersion(snapshot);
          if (version !== previousVersion) {
            sequence += 1;
            if (!enqueue(`retry: 3000\nid: ${authoritativeSnapshotVersion({ epoch, sequence, version })}\nevent: snapshot\ndata: ${JSON.stringify({ epoch, sequence, version, resync: sequence === 1, snapshot })}\n\n`)) return;
            previousVersion = version;
          }
          // Serialized schedule prevents overlapping DB reads and old snapshots.
          timer = setTimeout(() => void emit(), Math.max(5_000, intervalMs));
        } catch {
          if (!closed) enqueue("event: unavailable\ndata: {}\n\n");
          close();
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) { close(); return; }
      heartbeat = setInterval(() => enqueue(": heartbeat\n\n"), 15_000);
      lifetime = setTimeout(close, 55_000);
      void emit();
    },
    cancel() { cleanup(); },
  }, { highWaterMark: MAX_BYTES, size: (chunk) => chunk.byteLength });

  return new Response(stream, { headers });
}

export const serverEventStreamInternals = { canonicalize };

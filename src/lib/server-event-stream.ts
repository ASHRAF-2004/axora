type SnapshotLoader = () => Promise<unknown>;

export function snapshotEventStream(request: Request, load: SnapshotLoader, intervalMs = 10_000) {
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let sequence = 0;

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
          const snapshotSequence = typeof snapshot === "object" && snapshot !== null
            && "sequence" in snapshot && Number.isSafeInteger((snapshot as { sequence?: unknown }).sequence)
            ? Number((snapshot as { sequence: number }).sequence)
            : 0;
          sequence = Math.max(sequence + 1, snapshotSequence, Date.now());
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ sequence, snapshot })}\n\n`));
        } catch {
          controller.enqueue(encoder.encode("event: unavailable\ndata: {}\n\n"));
          close();
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      void emit();
      interval = setInterval(() => void emit(), intervalMs);
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

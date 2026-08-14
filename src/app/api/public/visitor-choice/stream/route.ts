import { isDemoMode } from "@/lib/db";
import { getPublicVisitorSnapshot } from "@/lib/public-visitor-counter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", close, { once: true });
      const publish = async () => {
        if (closed) return;
        try {
          const snapshot = isDemoMode()
            ? { totalCount: 0, earlyBirdCount: 0, nightOwlCount: 0 }
            : await getPublicVisitorSnapshot({});
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ ...snapshot, sequence: snapshot.totalCount })}\n\n`));
        } catch {
          controller.enqueue(encoder.encode(": snapshot temporarily unavailable\n\n"));
        }
      };
      void publish();
      timer = setInterval(() => void publish(), 10_000);
    },
    cancel() { if (timer) clearInterval(timer); },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-store, max-age=0", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}

import { getSession } from "@/lib/auth";
import { parseLiveSubscription } from "@/lib/live-update-contract";
import { createLiveReader } from "@/lib/live-update-reader";
import { snapshotEventStream } from "@/lib/server-event-stream";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  let subscription;
  try { subscription = parseLiveSubscription(new URL(request.url)); }
  catch { return Response.json({ error: "Live subscription unavailable" }, { status: 400, headers }); }
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401, headers });
  const reader = createLiveReader(actor, subscription.topics, subscription.context);
  try { await reader.authorize(); }
  catch { return Response.json({ error: "Live subscription unavailable" }, { status: 403, headers }); }
  if (subscription.polling) {
    try {
      const snapshot = await reader.load();
      await reader.authorize();
      return Response.json(snapshot, { headers });
    } catch { return Response.json({ error: "Live updates unavailable" }, { status: 503, headers }); }
  }
  return snapshotEventStream(request, reader.load, 10_000, {
    authorize: reader.authorize,
    connectionScope: `${actor.id}:${actor.roleAssignmentId ?? actor.role}`,
  });
}

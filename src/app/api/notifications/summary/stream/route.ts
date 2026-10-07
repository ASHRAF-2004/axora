import { getSession } from "@/lib/auth";
import { notificationSummary } from "@/lib/notification-repository";
import { authorizedLiveSnapshotStream } from "@/lib/live-update-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, {
      status: 401,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }

  return authorizedLiveSnapshotStream(request, actor, "notifications", notificationSummary, 10_000);
}

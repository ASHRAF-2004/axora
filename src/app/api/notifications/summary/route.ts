import { getSession } from "@/lib/auth";
import { notificationSummary } from "@/lib/notification-repository";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, {
      status: 401,
      headers: privateHeaders,
    });
  }
  try {
    const summary = await notificationSummary(actor);
    const etag = `"${summary.versionToken}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, {
        status: 304,
        headers: { ...privateHeaders, ETag: etag },
      });
    }
    return Response.json(summary, {
      headers: { ...privateHeaders, ETag: etag },
    });
  } catch {
    return Response.json({ error: "Notifications unavailable" }, {
      status: 503,
      headers: privateHeaders,
    });
  }
}

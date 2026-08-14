import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import {
  buildVisitorIdentity,
  consumeVisitorStreamRateLimit,
  getPublicVisitorSnapshot,
  normalizedPublicNetworkIdentifier,
} from "@/lib/public-visitor-counter";
import { snapshotEventStream } from "@/lib/server-event-stream";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1"
    || await getAccountLifecycleSession()) {
    return Response.json({ error: "Visitor stream unavailable" }, { status: 403 });
  }
  const remoteIp = normalizedPublicNetworkIdentifier(
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0],
  );
  try {
    await consumeVisitorStreamRateLimit(buildVisitorIdentity({ remoteIp }));
  } catch {
    return Response.json({ error: "Visitor stream rate limited" }, { status: 429 });
  }
  return snapshotEventStream(request, async () => isDemoMode()
    ? { totalCount: 0, earlyBirdCount: 0, nightOwlCount: 0 }
    : getPublicVisitorSnapshot({}), 10_000);
}

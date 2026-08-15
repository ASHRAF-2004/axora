import { getAccountLifecycleSession } from "@/lib/auth";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Axora-Near-Live-Transport": "visibility-aware-polling",
};

// A 204 tells legacy EventSource clients to stop reconnecting. Current clients
// use bounded visibility-aware polling against the authoritative GET endpoint.
export async function GET(request: NextRequest) {
  if (request.headers.get("sec-gpc") === "1"
    || request.headers.get("dnt") === "1"
    || await getAccountLifecycleSession()) {
    return Response.json(
      { error: "Visitor updates are unavailable for this request." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  return new Response(null, { status: 204, headers: noStoreHeaders });
}

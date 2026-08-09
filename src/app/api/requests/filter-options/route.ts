import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import {
  isRequestFilterDimension,
  normalizeRequestOptionValues,
} from "@/lib/request-filters";
import { listAuthorizedRequestFilterOptions } from "@/lib/request-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_requests")) {
    return Response.json({ error: "Request access denied" }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const dimension = params.get("dimension") ?? "";
  if (!isRequestFilterDimension(dimension)) {
    return Response.json({ error: "Invalid filter dimension" }, { status: 400 });
  }
  const query = (params.get("q") ?? "").trim().normalize("NFKC").slice(0, 80);
  const selected = normalizeRequestOptionValues(dimension, params.getAll("selected"));
  try {
    const options = await listAuthorizedRequestFilterOptions(actor, dimension, query, selected);
    return Response.json({ options }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch {
    return Response.json({ error: "Filter options are unavailable" }, { status: 400 });
  }
}

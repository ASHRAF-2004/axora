import { getSession } from "@/lib/auth";
import { setStaffAtmosphere } from "@/lib/staff-atmosphere";

export async function PATCH(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024) {
    return Response.json({ error: "Preference unavailable" }, { status: 413 });
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return Response.json({ error: "Preference unavailable" }, { status: 403 });
  }
  try {
    return Response.json({ atmosphere: await setStaffAtmosphere(actor, (await request.json())?.atmosphere) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Preference unavailable" }, { status: 403 });
  }
}

import { getSession } from "@/lib/auth";
import { setStaffAtmosphere } from "@/lib/staff-atmosphere";

function expectedOrigin() {
  try { return new URL(process.env.APP_BASE_URL ?? "https://axora.management").origin; }
  catch { return "https://axora.management"; }
}

function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const supplied = new URL(origin);
    if (supplied.origin === expectedOrigin()) return true;
    if (process.env.NODE_ENV === "production") return false;
    const received = new URL(request.url);
    return supplied.protocol === received.protocol
      && supplied.port === received.port
      && isLoopback(supplied.hostname)
      && isLoopback(received.hostname);
  } catch {
    return false;
  }
}

export async function PATCH(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 1024) {
    return Response.json({ error: "Preference unavailable" }, { status: 413 });
  }
  if (!isSameOrigin(request)) {
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

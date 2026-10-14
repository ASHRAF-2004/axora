import { getSession } from "@/lib/auth";
import { loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { companyRegisterRows } from "@/lib/company-register";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401, headers });
  if (!canAccess(actor, "manage_companies")) return Response.json({ error: "Company register unavailable" }, { status: 403, headers });
  try {
    const workspace = await loadCompanyLifecycleWorkspace(actor);
    const params = new URL(request.url).searchParams;
    const companies = companyRegisterRows(workspace.companies, actor.preferredLocale ?? "en", params.get("q") ?? "", params.get("status") ?? undefined);
    return Response.json({ companies }, { headers });
  } catch {
    return Response.json({ error: "Company register unavailable" }, { status: 404, headers });
  }
}

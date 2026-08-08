import { getSession } from "@/lib/auth";
import { exportCompanyLead } from "@/lib/company-leads";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const actor = await getSession();
  if (!actor || !canAccess(actor, "manage_companies")) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const { leadId } = await params;
    const lead = await exportCompanyLead(actor, leadId);
    return Response.json(lead, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${lead.code.toLowerCase()}-audit-export.json"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

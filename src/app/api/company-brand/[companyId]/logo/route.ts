import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode, query } from "@/lib/db";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const actor = await getAccountLifecycleSession();
  if (!actor) return new Response("Not found", { status: 404 });
  const { companyId: rawCompanyId } = await context.params;
  const parsed = z.uuid().safeParse(rawCompanyId);
  if (!parsed.success || (!actor.isOwner && actor.companyId !== parsed.data)) {
    return new Response("Not found", { status: 404 });
  }
  if (isDemoMode()) return new Response("Not found", { status: 404 });
  const result = await query<{ bytes: Buffer; contentType: string; sha256: string }>(`
    SELECT logo.logo_content AS bytes,logo.content_type AS "contentType",logo.sha256
    FROM company_logos logo
    WHERE logo.company_id=$1 AND logo.active=true
    LIMIT 1
  `, [parsed.data]);
  const logo = result.rows[0];
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.bytes), {
    headers: {
      "Cache-Control": "private, max-age=3600, must-revalidate",
      "Content-Type": logo.contentType,
      "Content-Disposition": "inline",
      ETag: `"${logo.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

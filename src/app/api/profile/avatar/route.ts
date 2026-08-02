import { getAccountLifecycleSession } from "@/lib/auth";
import { isDemoMode, query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getAccountLifecycleSession();
  if (!actor || isDemoMode()) return new Response("Not found", { status: 404 });
  const result = await query<{ bytes: Buffer; contentType: string; sha256: string }>(`
    SELECT avatar_content AS bytes,avatar_content_type AS "contentType",avatar_sha256 AS sha256
    FROM user_profiles
    WHERE user_id=$1 AND avatar_content IS NOT NULL
  `, [actor.id]);
  const avatar = result.rows[0];
  if (!avatar) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Cache-Control": "private, max-age=3600, must-revalidate",
      "Content-Type": avatar.contentType,
      "Content-Disposition": "inline",
      ETag: `"${avatar.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { getAccountLifecycleSession } from "@/lib/auth";
import { getCompanyBrandLogo } from "@/lib/tenant-branding";
import { z } from "zod";

export const dynamic = "force-dynamic";

function notFound() {
  return new Response("Not found", { status: 404 });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
) {
  const actor = await getAccountLifecycleSession();
  if (!actor) return notFound();
  const { companyId: rawCompanyId } = await context.params;
  const parsedCompanyId = z.uuid().safeParse(rawCompanyId);
  const rawThemeId = new URL(request.url).searchParams.get("theme");
  const parsedThemeId = rawThemeId === null
    ? { success: true as const, data: null }
    : z.uuid().safeParse(rawThemeId);
  if (!parsedCompanyId.success || !parsedThemeId.success) return notFound();
  try {
    const logo = await getCompanyBrandLogo(
      parsedCompanyId.data,
      parsedThemeId.data,
      actor,
    );
    if (!logo) return notFound();
    return new Response(new Uint8Array(logo.bytes), {
      headers: {
        "Cache-Control": "private, max-age=3600, must-revalidate",
        "Content-Type": logo.contentType,
        "Content-Disposition": "inline",
        ETag: "\"" + logo.sha256 + "\"",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return notFound();
  }
}

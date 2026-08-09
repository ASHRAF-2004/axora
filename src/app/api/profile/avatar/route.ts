import { getAccountLifecycleSession } from "@/lib/auth";
import { authorizedProfileImageResponse } from "@/lib/profile-image-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getAccountLifecycleSession();
  if (!actor) return new Response("Not found", { status: 404 });
  return authorizedProfileImageResponse(request, actor, actor.id);
}

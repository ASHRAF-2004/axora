import { getAccountLifecycleSession } from "@/lib/auth";
import { authorizedProfileImageResponse } from "@/lib/profile-image-response";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const [actor, route] = await Promise.all([getAccountLifecycleSession(), params]);
  if (!actor) return new Response("Not found", { status: 404 });
  return authorizedProfileImageResponse(request, actor, route.userId);
}

import type { SessionUser } from "./auth";
import { loadAuthorizedProfileImage, PROFILE_IMAGE_SIZES } from "./profile-images";

function imageSize(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("size") ?? 128);
  return PROFILE_IMAGE_SIZES.find((size) => size === requested) ?? 128;
}

export async function authorizedProfileImageResponse(request: Request, actor: SessionUser, targetUserId: string) {
  const deliveryJobId = new URL(request.url).searchParams.get("deliveryJobId") ?? undefined;
  try {
    const image = await loadAuthorizedProfileImage({ actor, targetUserId, size: imageSize(request), deliveryJobId });
    if (!image) return new Response("Not found", { status: 404 });
    const etag = `"${image.sha256}"`;
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return new Response(new Uint8Array(image.bytes), { headers: {
      "Cache-Control": "private, max-age=300, must-revalidate", "Content-Disposition": "inline",
      "Content-Type": image.contentType, ETag: etag, Vary: "Cookie", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

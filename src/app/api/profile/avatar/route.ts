import { randomUUID } from "node:crypto";
import { getAccountLifecycleSession } from "@/lib/auth";
import { removeMyProfileImage, saveMyProfileImage } from "@/lib/profile";
import { authorizedProfileImageResponse } from "@/lib/profile-image-response";
import {
  PROFILE_IMAGE_MAX_INPUT_BYTES,
  ProfileImageError,
} from "@/lib/profile-images";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

const MAX_MULTIPART_BYTES = PROFILE_IMAGE_MAX_INPUT_BYTES + 128 * 1024;

function expectedOrigin() {
  try {
    return new URL(
      process.env.APP_BASE_URL ?? "https://axora.management",
    ).origin;
  } catch {
    return "https://axora.management";
  }
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

function referenceId(request: Request) {
  const supplied = request.headers.get("x-axora-request-id")?.trim();
  return supplied && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(supplied)
    ? supplied
    : randomUUID();
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function failure(error: unknown, reference: string) {
  const code = error instanceof ProfileImageError ? error.code : "unavailable";
  if (!(error instanceof ProfileImageError)) {
    console.error(`[profile-image:${reference}] mutation failed`);
  }
  const status = code === "size"
    ? 413
    : ["storage", "unavailable"].includes(code)
      ? 503
      : 422;
  return json({ ok: false, code, referenceId: reference }, status);
}

export async function GET(request: Request) {
  const actor = await getAccountLifecycleSession();
  if (!actor) return new Response("Not found", { status: 404 });
  return authorizedProfileImageResponse(request, actor, actor.id);
}

export async function POST(request: Request) {
  const actor = await getAccountLifecycleSession();
  const sameOrigin = isSameOrigin(request);
  if (!actor || !sameOrigin) {
    return new Response("Not found", { status: 404 });
  }
  const reference = referenceId(request);
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      throw new ProfileImageError("size");
    }
    const formData = await request.formData();
    const file = formData.get("avatar");
    if (!(file instanceof File)) throw new ProfileImageError("type");
    const result = await saveMyProfileImage(file, actor, {
      focalX: formData.get("focalX") ?? 50,
      focalY: formData.get("focalY") ?? 50,
      zoom: formData.get("zoom") ?? 1,
    });
    revalidatePath("/profile");
    return json({ ok: true, ...result, referenceId: reference });
  } catch (error) {
    return failure(error, reference);
  }
}

export async function DELETE(request: Request) {
  const actor = await getAccountLifecycleSession();
  if (!actor || !isSameOrigin(request)) {
    return new Response("Not found", { status: 404 });
  }
  const reference = referenceId(request);
  try {
    await removeMyProfileImage(actor);
    revalidatePath("/profile");
    return json({ ok: true, status: "REMOVED", referenceId: reference });
  } catch (error) {
    return failure(error, reference);
  }
}

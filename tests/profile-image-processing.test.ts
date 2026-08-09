import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { prepareProfileImage, ProfileImageError, PROFILE_IMAGE_MAX_INPUT_BYTES, PROFILE_IMAGE_SIZES } from "@/lib/profile-images";

function upload(bytes: Buffer, type: string, name = "profile") {
  return new File([new Uint8Array(bytes)], name, { type });
}
async function raster(format: "jpeg" | "png" | "webp", width = 320, height = 240) {
  return sharp({ create: { width, height, channels: 4, background: { r: 30, g: 90, b: 70, alpha: 1 } } })[format]().toBuffer();
}

describe("profile image processing", () => {
  it.each(["jpeg", "png", "webp"] as const)("validates and creates private %s thumbnails", async (format) => {
    const prepared = await prepareProfileImage(upload(await raster(format), `image/${format}`), { focalX: 35, focalY: 60, zoom: 1.4 });
    expect(prepared.focalX).toBe(35); expect(prepared.focalY).toBe(60);
    for (const size of PROFILE_IMAGE_SIZES) {
      const metadata = await sharp(prepared.variants[size]).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: size, height: size });
      expect(metadata.exif).toBeUndefined();
    }
  });
  it("rejects MIME spoofing without changing an existing image", async () => {
    await expect(prepareProfileImage(upload(await raster("png"), "image/jpeg")))
      .rejects.toMatchObject({ code: "type" } satisfies Partial<ProfileImageError>);
  });
  it("rejects oversized and unsafe dimensions", async () => {
    await expect(prepareProfileImage(upload(Buffer.alloc(PROFILE_IMAGE_MAX_INPUT_BYTES + 1), "image/png")))
      .rejects.toMatchObject({ code: "size" } satisfies Partial<ProfileImageError>);
    await expect(prepareProfileImage(upload(await raster("png", 32, 32), "image/png")))
      .rejects.toMatchObject({ code: "dimensions" } satisfies Partial<ProfileImageError>);
  });
  it("normalizes EXIF orientation and produces deterministic duplicate hashes", async () => {
    const bytes = await sharp({ create: { width: 180, height: 320, channels: 3, background: "#245b49" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const first = await prepareProfileImage(upload(bytes, "image/jpeg"));
    const second = await prepareProfileImage(upload(bytes, "image/jpeg"));
    expect(first.sha256).toBe(second.sha256);
    expect(await sharp(first.variants[256]).metadata()).toMatchObject({ width: 256, height: 256 });
  });
  it("rejects almost transparent and animated or spoofed content", async () => {
    const transparent = await sharp({ create: {
      width: 128, height: 128, channels: 4,
      background: { r: 20, g: 80, b: 60, alpha: 0.02 },
    } }).png().toBuffer();
    await expect(prepareProfileImage(upload(transparent, "image/png")))
      .rejects.toMatchObject({ code: "transparent" } satisfies Partial<ProfileImageError>);
    const animatedGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    await expect(prepareProfileImage(upload(animatedGif, "image/webp", "animated.webp")))
      .rejects.toMatchObject({ code: "type" } satisfies Partial<ProfileImageError>);
  });
});

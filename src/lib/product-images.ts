import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";

export const MAX_PRODUCT_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_OUTPUT_BYTES = 1024 * 1024;
export const MAX_PRODUCT_IMAGE_DIMENSION = 1600;

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_ALT_TEXT_LENGTH = 200;
const PRODUCT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const inputTypes = new Map([
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
] as const);

type SupportedInputFormat = "jpeg" | "png" | "webp";

const servedTypes = new Set<string>(inputTypes.values());

export interface NormalizedProductImage {
  fileName: string;
  contentType: "image/webp";
  content: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export interface StoredProductImage {
  fileName: string;
  contentType: string;
  content: Buffer;
  altText: string;
}

interface ProductImageRow {
  fileName: string;
  contentType: string;
  content: Buffer;
  altText: string;
}

declare global {
  var __axoraDemoProductImages: Map<string, ProductImageRow> | undefined;
}

function demoProductImages() {
  if (!global.__axoraDemoProductImages) global.__axoraDemoProductImages = new Map();
  return global.__axoraDemoProductImages;
}

function validateProductId(productId: string) {
  if ((!isDemoMode() && !PRODUCT_ID_PATTERN.test(productId)) || !productId.trim()) {
    throw new Error("Product not found.");
  }
}

function requireOwner(actor: SessionUser) {
  if (!actor.isOwner) throw new Error("Only an Axora platform owner can manage product images.");
}

function normalizeAltText(value?: string) {
  const altText = value?.trim() ?? "";
  if (altText.length > MAX_ALT_TEXT_LENGTH) {
    throw new Error(`Image alternative text must not exceed ${MAX_ALT_TEXT_LENGTH} characters.`);
  }
  return altText;
}

function safeWebpName(originalName: string) {
  const baseName = originalName
    .replace(/\.[^.]*$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${baseName || "product-image"}.webp`;
}

export async function normalizeProductImage(file: File): Promise<NormalizedProductImage> {
  if (!(file instanceof File) || file.size < 1) throw new Error("Choose a product image to upload.");
  if (file.size > MAX_PRODUCT_IMAGE_INPUT_BYTES) {
    throw new Error("The original product image must not exceed 5 MB.");
  }
  if (![...inputTypes.values()].includes(file.type as "image/jpeg" | "image/png" | "image/webp")) {
    throw new Error("Product images must be JPEG, PNG, or WebP.");
  }

  const sourceBytes = Buffer.from(await file.arrayBuffer());
  let decodedFormat: string | undefined;
  let pages = 1;
  try {
    const metadata = await sharp(sourceBytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    }).metadata();
    decodedFormat = metadata.format;
    pages = metadata.pages ?? 1;
  } catch {
    throw new Error("The product image is damaged, unsupported, or too large to decode.");
  }

  const detectedType = decodedFormat ? inputTypes.get(decodedFormat as SupportedInputFormat) : undefined;
  if (!detectedType || detectedType !== file.type || pages !== 1) {
    throw new Error("The uploaded file is not a supported single-frame JPEG, PNG, or WebP image.");
  }

  let output: Buffer;
  let width: number;
  let height: number;
  try {
    const converted = await sharp(sourceBytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
      animated: false,
    })
      .rotate()
      .resize({
        width: MAX_PRODUCT_IMAGE_DIMENSION,
        height: MAX_PRODUCT_IMAGE_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    output = converted.data;
    width = converted.info.width;
    height = converted.info.height;
  } catch {
    throw new Error("The product image could not be prepared for the catalog.");
  }

  if (!width || !height || output.length > MAX_PRODUCT_IMAGE_OUTPUT_BYTES) {
    throw new Error("The prepared product image is too large. Choose a simpler or smaller image.");
  }

  return {
    fileName: safeWebpName(file.name),
    contentType: "image/webp",
    content: output,
    width,
    height,
    sha256: createHash("sha256").update(output).digest("hex"),
  };
}

export async function saveProductImage(
  input: { productId: string; file: File; altText?: string },
  actor: SessionUser,
): Promise<NormalizedProductImage & { altText: string }> {
  requireOwner(actor);
  validateProductId(input.productId);
  const requestedAltText = normalizeAltText(input.altText);
  const image = await normalizeProductImage(input.file);

  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === input.productId);
    if (!product) throw new Error("Product not found.");
    const altText = requestedAltText || product.name;
    demoProductImages().set(input.productId, {
      fileName: image.fileName,
      contentType: image.contentType,
      content: image.content,
      altText,
    });
    return { ...image, altText };
  }

  const result = await withAuditTransaction(
    { userId: actor.id, reason: "Product image uploaded" },
    (client) => client.query<{ altText: string }>(
      `UPDATE products
       SET image_file_name=$2,
           image_content_type=$3,
           image_content=$4,
           image_alt_text=COALESCE(NULLIF($5,''),name)
       WHERE id=$1
       RETURNING image_alt_text AS "altText"`,
      [input.productId, image.fileName, image.contentType, image.content, requestedAltText],
    ),
  );
  const saved = result.rows[0];
  if (!saved) throw new Error("Product not found.");
  return { ...image, altText: saved.altText };
}

export async function loadProductImage(productId: string, actor: SessionUser): Promise<StoredProductImage | null> {
  if ((!isDemoMode() && !PRODUCT_ID_PATTERN.test(productId)) || !productId.trim()) return null;

  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === productId);
    const image = demoProductImages().get(productId);
    if (!product || !image || (!actor.isOwner && product.status !== "Active")) return null;
    return image;
  }

  const result = await query<ProductImageRow>(
    `SELECT image_file_name AS "fileName",
            image_content_type AS "contentType",
            image_content AS content,
            COALESCE(NULLIF(image_alt_text,''),name) AS "altText"
     FROM products
     WHERE id=$1
       AND image_content IS NOT NULL
       AND image_file_name IS NOT NULL
       AND image_content_type IS NOT NULL
       AND ($2::boolean OR (
         active=true
         AND needs_review=false
         AND (company_id IS NULL OR company_id=$3::uuid)
       ))`,
    [productId, actor.isOwner, actor.companyId ?? null],
  );
  const image = result.rows[0];
  if (!image || !servedTypes.has(image.contentType) || !image.content.length) return null;
  return image;
}

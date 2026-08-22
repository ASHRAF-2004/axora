import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import sharp from "sharp";
import type { SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";
import type { ProductImageSummary } from "./types";
import { canAccess } from "./permissions";

export const MAX_PRODUCT_IMAGES = 8;
export const MAX_PRODUCT_IMAGE_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_PRODUCT_IMAGE_OUTPUT_BYTES = 1024 * 1024;
export const MAX_PRODUCT_IMAGE_DIMENSION = 1600;

const MAX_INPUT_PIXELS = 40_000_000;
const MAX_ALT_TEXT_LENGTH = 200;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

interface ProductImageRow extends ProductImageSummary {
  fileName: string;
  contentType: string;
  content: Buffer;
  active: boolean;
  sha256: string;
}

declare global {
  var __axoraDemoProductImages: Map<string, ProductImageRow[]> | undefined;
}

function demoProductImages() {
  if (!global.__axoraDemoProductImages) global.__axoraDemoProductImages = new Map();
  return global.__axoraDemoProductImages;
}

function validateUuid(value: string, message: string) {
  if ((!isDemoMode() && !UUID_PATTERN.test(value)) || !value.trim()) throw new Error(message);
}

function validateProductId(productId: string) {
  validateUuid(productId, "Product not found.");
}

function canManageCatalog(actor: SessionUser) {
  return canAccess(actor, "manage_catalog");
}

function requireCatalogManager(actor: SessionUser) {
  if (!canManageCatalog(actor)) throw new Error("Your account cannot manage product images.");
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
    throw new Error("Each original product image must not exceed 5 MB.");
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
    throw new Error("A product image is damaged, unsupported, or too large to decode.");
  }

  const detectedType = decodedFormat ? inputTypes.get(decodedFormat as SupportedInputFormat) : undefined;
  if (!detectedType || detectedType !== file.type || pages !== 1) {
    throw new Error("Every uploaded file must be a supported single-frame JPEG, PNG, or WebP image.");
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
    throw new Error("A product image could not be prepared for the catalog.");
  }

  if (!width || !height || output.length > MAX_PRODUCT_IMAGE_OUTPUT_BYTES) {
    throw new Error("A prepared product image is too large. Choose a simpler or smaller image.");
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

export async function prepareProductImages(files: File[]) {
  const selected = files.filter((file) => file.size > 0);
  if (!selected.length) return [];
  if (selected.length > MAX_PRODUCT_IMAGES) {
    throw new Error(`Upload no more than ${MAX_PRODUCT_IMAGES} product images at once.`);
  }
  const images = await Promise.all(selected.map(normalizeProductImage));
  if (new Set(images.map((image) => image.sha256)).size !== images.length) {
    throw new Error("The selected product images contain duplicates.");
  }
  return images;
}

async function syncPrimaryProductColumns(client: PoolClient, productId: string) {
  const primary = await client.query<{
    fileName: string;
    contentType: string;
    content: Buffer;
    altText: string;
  }>(
    `SELECT file_name AS "fileName", content_type AS "contentType", image_content AS content, alt_text AS "altText"
     FROM product_images
     WHERE product_id=$1 AND active=true
     ORDER BY is_primary DESC, sort_order, created_at
     LIMIT 1`,
    [productId],
  );
  const image = primary.rows[0];
  await client.query(
    `UPDATE products
     SET image_file_name=$2, image_content_type=$3, image_content=$4,
         image_alt_text=COALESCE(NULLIF($5,''),name)
     WHERE id=$1`,
    [productId, image?.fileName ?? null, image?.contentType ?? null, image?.content ?? null, image?.altText ?? null],
  );
}

export async function savePreparedProductImages(
  input: { productId: string; images: NormalizedProductImage[]; altText?: string },
  actor: SessionUser,
): Promise<ProductImageSummary[]> {
  requireCatalogManager(actor);
  validateProductId(input.productId);
  if (!input.images.length) return [];
  const requestedAltText = normalizeAltText(input.altText);

  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === input.productId);
    if (!product) throw new Error("Product not found.");
    const current = demoProductImages().get(input.productId) ?? [];
    if (current.filter((image) => image.active).length + input.images.length > MAX_PRODUCT_IMAGES) {
      throw new Error(`A product can have at most ${MAX_PRODUCT_IMAGES} active images.`);
    }
    const existingHashes = new Set(current.filter((image) => image.active).map((image) => image.sha256));
    if (input.images.some((image) => existingHashes.has(image.sha256))) {
      throw new Error("This product already contains one of the selected images.");
    }
    const hasPrimary = current.some((image) => image.active && image.isPrimary);
    const startOrder = current.reduce((max, image) => Math.max(max, image.sortOrder), -1) + 1;
    const created = input.images.map((image, index): ProductImageRow => ({
      id: randomUUID(),
      fileName: image.fileName,
      contentType: image.contentType,
      content: image.content,
      altText: requestedAltText || product.name,
      isPrimary: !hasPrimary && index === 0,
      sortOrder: startOrder + index,
      active: true,
      sha256: image.sha256,
    }));
    demoProductImages().set(input.productId, [...current, ...created]);
    product.hasImage = true;
    product.imageAltText = (created.find((image) => image.isPrimary) ?? current.find((image) => image.isPrimary))?.altText || product.name;
    return created.map(({ id, altText, isPrimary, sortOrder }) => ({ id, altText, isPrimary, sortOrder }));
  }

  return withAuditTransaction(
    { actor, reason: "Product gallery images uploaded" },
    async (client) => {
      const product = await client.query<{ name: string }>("SELECT name FROM products WHERE id=$1 FOR UPDATE", [input.productId]);
      if (!product.rows[0]) throw new Error("Product not found.");
      const existing = await client.query<{ count: number; maxOrder: number; hasPrimary: boolean; hashes: string[] }>(
        `SELECT count(*)::int AS count,
                COALESCE(max(sort_order),-1)::int AS "maxOrder",
                bool_or(is_primary) AS "hasPrimary",
                COALESCE(array_agg(sha256),ARRAY[]::text[]) AS hashes
         FROM product_images WHERE product_id=$1 AND active=true`,
        [input.productId],
      );
      const current = existing.rows[0];
      if (current.count + input.images.length > MAX_PRODUCT_IMAGES) {
        throw new Error(`A product can have at most ${MAX_PRODUCT_IMAGES} active images.`);
      }
      const existingHashes = new Set(current.hashes);
      if (input.images.some((image) => existingHashes.has(image.sha256))) {
        throw new Error("This product already contains one of the selected images.");
      }

      const created: ProductImageSummary[] = [];
      for (const [index, image] of input.images.entries()) {
        const inserted = await client.query<ProductImageSummary>(
          `INSERT INTO product_images
            (product_id,file_name,content_type,image_content,alt_text,width,height,sha256,sort_order,is_primary,created_by)
           VALUES ($1,$2,$3,$4,COALESCE(NULLIF($5,''),$6),$7,$8,$9,$10,$11,$12)
           RETURNING id::text, alt_text AS "altText", is_primary AS "isPrimary", sort_order AS "sortOrder"`,
          [input.productId, image.fileName, image.contentType, image.content, requestedAltText, product.rows[0].name,
            image.width, image.height, image.sha256, current.maxOrder + 1 + index, !current.hasPrimary && index === 0, actor.id],
        );
        created.push(inserted.rows[0]);
      }
      await syncPrimaryProductColumns(client, input.productId);
      return created;
    },
  );
}

export async function saveProductImages(
  input: { productId: string; files: File[]; altText?: string },
  actor: SessionUser,
) {
  const images = await prepareProductImages(input.files);
  return savePreparedProductImages({ productId: input.productId, images, altText: input.altText }, actor);
}

export async function saveProductImage(
  input: { productId: string; file: File; altText?: string },
  actor: SessionUser,
) {
  const [saved] = await saveProductImages({ productId: input.productId, files: [input.file], altText: input.altText }, actor);
  return saved;
}

export async function listProductImages(productId: string, actor: SessionUser): Promise<ProductImageSummary[]> {
  validateProductId(productId);
  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === productId);
    if (!product || (!canManageCatalog(actor) && product.status !== "Active")) return [];
    return (demoProductImages().get(productId) ?? [])
      .filter((image) => image.active)
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)
      .map(({ id, altText, isPrimary, sortOrder }) => ({ id, altText, isPrimary, sortOrder }));
  }
  const result = await query<ProductImageSummary>(
    `SELECT pi.id::text, COALESCE(NULLIF(pi.alt_text,''),p.name) AS "altText",
            pi.is_primary AS "isPrimary", pi.sort_order AS "sortOrder"
     FROM product_images pi JOIN products p ON p.id=pi.product_id
     WHERE pi.product_id=$1 AND pi.active=true
       AND ($2::boolean OR (p.active=true AND p.needs_review=false AND (p.company_id IS NULL OR p.company_id=$3::uuid)))
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at`,
    [productId, canManageCatalog(actor), actor.companyId ?? null],
  );
  return result.rows;
}

export async function setPrimaryProductImage(productId: string, imageId: string, actor: SessionUser) {
  requireCatalogManager(actor);
  validateProductId(productId);
  validateUuid(imageId, "Product image not found.");
  if (isDemoMode()) {
    const images = demoProductImages().get(productId) ?? [];
    const selected = images.find((image) => image.id === imageId && image.active);
    if (!selected) throw new Error("Product image not found.");
    images.forEach((image) => { image.isPrimary = image.id === imageId && image.active; });
    const product = getDemoStore().products.find((item) => item.id === productId);
    if (product) product.imageAltText = selected.altText || product.name;
    return;
  }
  await withAuditTransaction({ actor, reason: "PRODUCT_PRIMARY_IMAGE_UPDATED" }, async (client) => {
    const selected = await client.query("SELECT 1 FROM product_images WHERE id=$1 AND product_id=$2 AND active=true FOR UPDATE", [imageId, productId]);
    if (!selected.rowCount) throw new Error("Product image not found.");
    await client.query("UPDATE product_images SET is_primary=false, updated_at=now() WHERE product_id=$1 AND active=true", [productId]);
    await client.query("UPDATE product_images SET is_primary=true, updated_at=now() WHERE id=$1", [imageId]);
    await syncPrimaryProductColumns(client, productId);
  });
}

export async function updateProductImageAltText(productId: string, imageId: string, altText: string, actor: SessionUser) {
  requireCatalogManager(actor);
  validateProductId(productId);
  validateUuid(imageId, "Product image not found.");
  const normalized = normalizeAltText(altText);
  if (isDemoMode()) {
    const image = (demoProductImages().get(productId) ?? []).find((item) => item.id === imageId && item.active);
    const product = getDemoStore().products.find((item) => item.id === productId);
    if (!image || !product) throw new Error("Product image not found.");
    image.altText = normalized || product.name;
    if (image.isPrimary) product.imageAltText = image.altText;
    return;
  }
  await withAuditTransaction({ actor, reason: "PRODUCT_IMAGE_DESCRIPTION_UPDATED" }, async (client) => {
    const updated = await client.query(
      `UPDATE product_images image
       SET alt_text=COALESCE(NULLIF($3,''),(SELECT name FROM products WHERE id=$1)), updated_at=now()
       WHERE image.product_id=$1 AND image.id=$2 AND image.active=true`,
      [productId, imageId, normalized],
    );
    if (!updated.rowCount) throw new Error("Product image not found.");
    await syncPrimaryProductColumns(client, productId);
  });
}

export async function deactivateProductImage(productId: string, imageId: string, actor: SessionUser) {
  requireCatalogManager(actor);
  validateProductId(productId);
  validateUuid(imageId, "Product image not found.");
  if (isDemoMode()) {
    const images = demoProductImages().get(productId) ?? [];
    const selected = images.find((image) => image.id === imageId && image.active);
    if (!selected) throw new Error("Product image not found.");
    const wasPrimary = selected.isPrimary;
    selected.active = false;
    selected.isPrimary = false;
    const remaining = images.filter((image) => image.active).sort((a, b) => a.sortOrder - b.sortOrder);
    if (wasPrimary && remaining[0]) remaining[0].isPrimary = true;
    const product = getDemoStore().products.find((item) => item.id === productId);
    if (product) {
      product.hasImage = remaining.length > 0;
      product.imageAltText = remaining.find((image) => image.isPrimary)?.altText;
    }
    return;
  }
  await withAuditTransaction({ actor, reason: "PRODUCT_IMAGE_REMOVED" }, async (client) => {
    const removed = await client.query<{ wasPrimary: boolean }>(
      `UPDATE product_images SET active=false, is_primary=false, updated_at=now()
       WHERE id=$1 AND product_id=$2 AND active=true RETURNING is_primary AS "wasPrimary"`,
      [imageId, productId],
    );
    if (!removed.rowCount) throw new Error("Product image not found.");
    const primary = await client.query("SELECT 1 FROM product_images WHERE product_id=$1 AND active=true AND is_primary=true", [productId]);
    if (!primary.rowCount) {
      await client.query(
        `UPDATE product_images SET is_primary=true, updated_at=now()
         WHERE id=(SELECT id FROM product_images WHERE product_id=$1 AND active=true ORDER BY sort_order,created_at LIMIT 1)`,
        [productId],
      );
    }
    await syncPrimaryProductColumns(client, productId);
  });
}

export async function loadProductImage(productId: string, actor: SessionUser, imageId?: string): Promise<StoredProductImage | null> {
  if ((!isDemoMode() && !UUID_PATTERN.test(productId)) || !productId.trim()) return null;
  if (imageId && ((!isDemoMode() && !UUID_PATTERN.test(imageId)) || !imageId.trim())) return null;

  if (isDemoMode()) {
    const product = getDemoStore().products.find((item) => item.id === productId);
    const images = (demoProductImages().get(productId) ?? []).filter((image) => image.active);
    const image = imageId
      ? images.find((item) => item.id === imageId)
      : images.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder)[0];
    if (!product || !image || (!canManageCatalog(actor) && product.status !== "Active")) return null;
    return image;
  }

  const result = await query<ProductImageRow>(
    `SELECT pi.id::text, pi.file_name AS "fileName", pi.content_type AS "contentType",
            pi.image_content AS content, COALESCE(NULLIF(pi.alt_text,''),p.name) AS "altText",
            pi.is_primary AS "isPrimary", pi.sort_order AS "sortOrder", pi.active, pi.sha256
     FROM product_images pi JOIN products p ON p.id=pi.product_id
     WHERE pi.product_id=$1 AND pi.active=true
       AND ($4::uuid IS NULL OR pi.id=$4::uuid)
       AND ($2::boolean OR (p.active=true AND p.needs_review=false AND (p.company_id IS NULL OR p.company_id=$3::uuid)))
     ORDER BY pi.is_primary DESC, pi.sort_order, pi.created_at
     LIMIT 1`,
    [productId, canManageCatalog(actor), actor.companyId ?? null, imageId ?? null],
  );
  const image = result.rows[0];
  if (image && servedTypes.has(image.contentType) && image.content.length) return image;
  if (imageId) return null;

  const legacy = await query<ProductImageRow>(
    `SELECT p.id::text, p.image_file_name AS "fileName", p.image_content_type AS "contentType",
            p.image_content AS content, COALESCE(NULLIF(p.image_alt_text,''),p.name) AS "altText",
            true AS "isPrimary", 0 AS "sortOrder", true AS active, '' AS sha256
     FROM products p
     WHERE p.id=$1 AND p.image_content IS NOT NULL
       AND ($2::boolean OR (p.active=true AND p.needs_review=false AND (p.company_id IS NULL OR p.company_id=$3::uuid)))`,
    [productId, canManageCatalog(actor), actor.companyId ?? null],
  );
  const fallback = legacy.rows[0];
  if (!fallback || !servedTypes.has(fallback.contentType) || !fallback.content.length) return null;
  return fallback;
}

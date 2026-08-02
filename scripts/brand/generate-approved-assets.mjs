import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceDirectory = process.env.AXORA_APPROVED_BRAND_SOURCE_DIR
  ?? path.join(projectRoot, "assets/brand/source");
const markSource = path.join(sourceDirectory, "axora-approved-mark.png");
const horizontalSource = path.join(sourceDirectory, "axora-approved-horizontal.png");
const expectedHashes = {
  [markSource]: "5ab7e58eb090287ead5ebbe4b2085526d9d2757101f77199db70b7cb5d161563",
  [horizontalSource]: "808f566659039e07becbc47f1ee3ed0b7f195a25dd372d534a9dea8053a3aa0d",
};
const publicDirectory = path.join(projectRoot, "public/brand");
const provenanceDirectory = path.join(projectRoot, "assets/brand/source");

async function verifiedSource(filePath) {
  const bytes = await readFile(filePath);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== expectedHashes[filePath]) {
    throw new Error(`Approved brand source hash changed: ${path.basename(filePath)}`);
  }
  return bytes;
}

await mkdir(publicDirectory, { recursive: true });
await mkdir(provenanceDirectory, { recursive: true });
const [markBytes, horizontalBytes] = await Promise.all([
  verifiedSource(markSource),
  verifiedSource(horizontalSource),
]);

await Promise.all([
  copyFile(markSource, path.join(provenanceDirectory, "axora-approved-mark.png")),
  copyFile(horizontalSource, path.join(provenanceDirectory, "axora-approved-horizontal.png")),
]);

const mark = sharp(markBytes).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });
const horizontal = sharp(horizontalBytes).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } });

await Promise.all([
  mark.clone().resize(512, 512, { fit: "contain" }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-mark-512.png")),
  mark.clone().resize(192, 192, { fit: "contain" }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-icon-192.png")),
  mark.clone().resize(180, 180, { fit: "contain" }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-apple-180.png")),
  mark.clone().resize(32, 32, { fit: "contain" }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-icon-32.png")),
  horizontal.clone().resize({ width: 1200, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-logo.png")),
  horizontal.clone().resize({ width: 1200, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-logo-light-background.png")),
  horizontal.clone().resize({ width: 600, withoutEnlargement: true }).png({ compressionLevel: 9, palette: true })
    .toFile(path.join(publicDirectory, "axora-email.png")),
]);

const darkLogo = await horizontal.clone()
  .resize({ width: 1100, withoutEnlargement: true })
  .png()
  .toBuffer({ resolveWithObject: true });
await sharp({
  create: {
    width: darkLogo.info.width + 96,
    height: darkLogo.info.height + 72,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite([{ input: darkLogo.data, left: 48, top: 36 }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(path.join(publicDirectory, "axora-logo-dark-background.png"));

process.stdout.write("Generated faithful Axora raster assets from hash-verified approved sources.\n");

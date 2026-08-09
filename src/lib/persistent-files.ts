import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadedContentMatchesMime } from "./file-content";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_PROFILE_VARIANT_BYTES = 512 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// `turbopackIgnore` is build-time tracing metadata only. Uploads are supplied
// by a runtime-mounted volume, while the validation, realpath, containment,
// symlink, MIME, size, and exclusive-create checks below still run normally.
function storageRoot(override?: string) {
  return path.resolve(
    /* turbopackIgnore: true */ override
      ?? process.env.AXORA_UPLOADS_CONTAINER_DIR
      ?? path.join(/* turbopackIgnore: true */ process.cwd(), "data", "uploads"),
  );
}

function safeSegment(value: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error("Upload scope is invalid.");
  return value;
}

export interface StoredUpload {
  relativePath: string;
  safeFileName: string;
  contentType: string;
  bytes: Buffer;
}

export async function storePersistentUpload(input: {
  namespace: "supplier-portal" | "delivery-evidence";
  scopeSegments: string[];
  file: File;
  rootOverride?: string;
}): Promise<StoredUpload> {
  if (!input.file.size || input.file.size > MAX_UPLOAD_BYTES) throw new Error("Choose a file between 1 byte and 5 MB.");
  const extension = MIME_EXTENSIONS[input.file.type];
  if (!extension) throw new Error("Use a PDF, PNG, JPEG, or WebP file.");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (bytes.length !== input.file.size || !uploadedContentMatchesMime(input.file.type, bytes)) throw new Error("The file content does not match its declared type.");
  const root = storageRoot(input.rootOverride);
  const rootInfo = await lstat(/* turbopackIgnore: true */ root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Persistent upload storage is unavailable.");
  const verifiedRoot = await realpath(/* turbopackIgnore: true */ root);
  const directory = path.join(/* turbopackIgnore: true */ verifiedRoot, input.namespace, ...input.scopeSegments.map(safeSegment));
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o750 });
  const verifiedDirectory = await realpath(/* turbopackIgnore: true */ directory);
  if (!verifiedDirectory.startsWith(`${verifiedRoot}${path.sep}`)) throw new Error("Persistent upload scope is invalid.");
  const relativePath = path.posix.join(input.namespace, ...input.scopeSegments.map(safeSegment), `${randomUUID()}${extension}`);
  const target = path.join(/* turbopackIgnore: true */ verifiedRoot, ...relativePath.split("/"));
  await writeFile(/* turbopackIgnore: true */ target, bytes, { flag: "wx", mode: 0o640 });
  const safeFileName = input.file.name.replace(/[^A-Za-z0-9._ -]/g, "_").trim().slice(-180) || `document${extension}`;
  return { relativePath, safeFileName, contentType: input.file.type, bytes };
}

export async function removePersistentUpload(relativePath: string, rootOverride?: string) {
  try {
    const root = storageRoot(rootOverride);
    const target = path.resolve(/* turbopackIgnore: true */ root, relativePath);
    if (!target.startsWith(`${root}${path.sep}`)) return;
    await unlink(/* turbopackIgnore: true */ target);
  } catch {
    // A failed database write should attempt cleanup, but cleanup failure must
    // never mask the original transactional error.
  }
}

export async function storePersistentProfileImageVariant(input: {
  userId: string;
  versionId: string;
  bytes: Buffer;
  rootOverride?: string;
}) {
  if (!input.bytes.length || input.bytes.length > MAX_PROFILE_VARIANT_BYTES
    || !uploadedContentMatchesMime("image/webp", input.bytes)) {
    throw new Error("The processed profile image is unavailable.");
  }
  const root = storageRoot(input.rootOverride);
  const rootInfo = await lstat(/* turbopackIgnore: true */ root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Persistent upload storage is unavailable.");
  }
  const verifiedRoot = await realpath(/* turbopackIgnore: true */ root);
  const userId = safeSegment(input.userId);
  const versionId = safeSegment(input.versionId);
  const directory = path.join(
    /* turbopackIgnore: true */ verifiedRoot,
    "profile-images",
    userId,
    versionId,
  );
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o750 });
  const verifiedDirectory = await realpath(/* turbopackIgnore: true */ directory);
  if (!verifiedDirectory.startsWith(`${verifiedRoot}${path.sep}`)) {
    throw new Error("Persistent upload scope is invalid.");
  }
  const relativePath = path.posix.join(
    "profile-images",
    userId,
    versionId,
    `${randomUUID()}.webp`,
  );
  const target = path.join(
    /* turbopackIgnore: true */ verifiedRoot,
    ...relativePath.split("/"),
  );
  await writeFile(/* turbopackIgnore: true */ target, input.bytes, {
    flag: "wx",
    mode: 0o640,
  });
  return relativePath;
}

export async function readPersistentProfileImage(
  relativePath: string,
  rootOverride?: string,
) {
  if (!/^profile-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/.test(relativePath)
    || /(^|\/)\.\.?(\/|$)/.test(relativePath)) return null;
  const root = storageRoot(rootOverride);
  const target = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (!info.isFile() || info.isSymbolicLink()
      || info.size < 1 || info.size > MAX_PROFILE_VARIANT_BYTES) return null;
    const bytes = await readFile(/* turbopackIgnore: true */ target);
    return uploadedContentMatchesMime("image/webp", bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function readPersistentUpload(relativePath: string, rootOverride?: string) {
  if (!/^(supplier-portal|delivery-evidence)\/[A-Za-z0-9._/-]+$/.test(relativePath) || /(^|\/)\.\.?(\/|$)/.test(relativePath)) return null;
  const root = storageRoot(rootOverride);
  const target = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_UPLOAD_BYTES) return null;
    return await readFile(/* turbopackIgnore: true */ target);
  } catch {
    return null;
  }
}

export async function readPersistentGeneratedDocument(relativePath: string, rootOverride?: string) {
  if (!/^generated-documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(relativePath)
    || /(^|\/)\.\.?(\/|$)/.test(relativePath)) return null;
  const root = storageRoot(rootOverride);
  const target = path.resolve(/* turbopackIgnore: true */ root, relativePath);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  try {
    const info = await lstat(/* turbopackIgnore: true */ target);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 100 || info.size > 25 * 1024 * 1024) return null;
    return await readFile(/* turbopackIgnore: true */ target);
  } catch {
    return null;
  }
}

export const persistentFileLimits = {
  maximumBytes: MAX_UPLOAD_BYTES,
  maximumProfileVariantBytes: MAX_PROFILE_VARIANT_BYTES,
};

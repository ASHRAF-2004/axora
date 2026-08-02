import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPersistentUpload, removePersistentUpload, storePersistentUpload } from "../src/lib/persistent-files";

const roots: string[] = [];
const initialUploadsDirectory = process.env.AXORA_UPLOADS_CONTAINER_DIR;
const pngBytes = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from("00000000IEND00000000"),
]);
afterEach(async () => {
  if (initialUploadsDirectory === undefined) delete process.env.AXORA_UPLOADS_CONTAINER_DIR;
  else process.env.AXORA_UPLOADS_CONTAINER_DIR = initialUploadsDirectory;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function root() {
  const value = await mkdtemp(path.join(tmpdir(), "axora-upload-test-"));
  roots.push(value);
  return value;
}

describe("persistent upload storage", () => {
  it("stores an authenticated image under a generated scoped path", async () => {
    const directory = await root();
    const bytes = pngBytes;
    const stored = await storePersistentUpload({ namespace: "supplier-portal", scopeSegments: ["supplier", "rfq"], file: new File([bytes], "quote.png", { type: "image/png" }), rootOverride: directory });
    expect(stored.relativePath).toMatch(/^supplier-portal\/supplier\/rfq\/[0-9a-f-]+\.png$/);
    expect(await readPersistentUpload(stored.relativePath, directory)).toEqual(bytes);
    await removePersistentUpload(stored.relativePath, directory);
    expect(await readPersistentUpload(stored.relativePath, directory)).toBeNull();
  });

  it("rejects MIME spoofing and symbolic-link roots", async () => {
    const directory = await root();
    await expect(storePersistentUpload({ namespace: "delivery-evidence", scopeSegments: ["driver"], file: new File(["not-png"], "proof.png", { type: "image/png" }), rootOverride: directory })).rejects.toThrow(/content/);
    const parent = await root();
    const real = path.join(parent, "real");
    const link = path.join(parent, "link");
    await mkdir(real);
    await symlink(real, link);
    await expect(storePersistentUpload({ namespace: "delivery-evidence", scopeSegments: ["driver"], file: new File([pngBytes], "proof.png", { type: "image/png" }), rootOverride: link })).rejects.toThrow(/unavailable/);
  });

  it("uses the configured external volume without weakening path containment", async () => {
    const directory = await root();
    process.env.AXORA_UPLOADS_CONTAINER_DIR = directory;

    const stored = await storePersistentUpload({
      namespace: "delivery-evidence",
      scopeSegments: ["driver_42", "delivery_8"],
      file: new File([pngBytes], "proof.png", { type: "image/png" }),
    });
    expect(await readPersistentUpload(stored.relativePath)).toEqual(pngBytes);
    await expect(storePersistentUpload({
      namespace: "delivery-evidence",
      scopeSegments: [".."],
      file: new File([pngBytes], "proof.png", { type: "image/png" }),
    })).rejects.toThrow(/scope/);
    expect(await readPersistentUpload("delivery-evidence/../outside.png")).toBeNull();

    const outside = path.join(await root(), "outside.png");
    await writeFile(outside, pngBytes);
    const symlinkDirectory = path.join(directory, "delivery-evidence", "driver_42");
    await mkdir(symlinkDirectory, { recursive: true });
    await symlink(outside, path.join(symlinkDirectory, "linked.png"));
    expect(await readPersistentUpload("delivery-evidence/driver_42/linked.png")).toBeNull();
  });
});

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repositoryRoot, "third-party-assets.json");
const runtimeRoots = [
  "public/immersive/models",
  "public/immersive/sounds",
  "public/catalog/categories",
  "public/maps",
];
const thirdPartyExtensions = new Set([".glb", ".ogg", ".wav", ".avif", ".webp", ".geojson"]);
const forbiddenLicences = /non[- ]?commercial|\bNC\b|no[- ]?derivatives|\bND\b|editorial|unknown|unclear/i;
const runtimeAssetHotlink = /(?:src\s*=\s*["'`]https?:\/\/[^"'`]*(?:kenney\.nl|3dicons\.co|opengameart\.org|naturalearthdata\.com|supabase\.co)|url\(\s*["']?https?:\/\/[^)'"\s]*(?:kenney\.nl|3dicons\.co|opengameart\.org|naturalearthdata\.com|supabase\.co)|fetch\(\s*["'`]https?:\/\/[^"'`]*(?:kenney\.nl|3dicons\.co|opengameart\.org|naturalearthdata\.com|supabase\.co))/i;

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(target));
    else files.push(target);
  }
  return files;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateThirdPartyAssets({ reportPath } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert(manifest.schemaVersion === 1 && Array.isArray(manifest.assets), "Unsupported asset manifest schema.");
  const seen = new Set();
  const report = { generatedAt: new Date().toISOString(), totalBytes: 0, byKind: {}, assets: [] };

  for (const asset of manifest.assets) {
    assert(typeof asset.path === "string" && !path.isAbsolute(asset.path) && !asset.path.includes(".."), `Unsafe asset path: ${asset.path}`);
    assert(!seen.has(asset.path), `Conflicting provenance entries for ${asset.path}`);
    seen.add(asset.path);
    for (const key of ["assetName", "originalFilename", "creator", "canonicalSource", "exactPackOrItem", "downloadDate", "repositoryFileSha256", "modifications", "restrictions"]) {
      assert(typeof asset[key] === "string" && asset[key].trim(), `${asset.path} is missing ${key}`);
    }
    assert(/^https:\/\//.test(asset.canonicalSource), `${asset.path} must use a canonical HTTPS source page.`);
    assert(asset.license && typeof asset.license.name === "string" && typeof asset.license.url === "string" && typeof asset.license.recordPath === "string", `${asset.path} has incomplete licence metadata.`);
    assert(!forbiddenLicences.test(`${asset.license.name} ${asset.restrictions}`), `${asset.path} uses a prohibited or unclear licence.`);
    assert(asset.originalFileSha256 === null || /^[a-f0-9]{64}$/.test(asset.originalFileSha256), `${asset.path} has an invalid original checksum.`);
    const absolute = path.join(repositoryRoot, asset.path);
    const info = await stat(absolute);
    assert(info.isFile(), `${asset.path} is not a file.`);
    assert(await sha256(absolute) === asset.repositoryFileSha256, `${asset.path} checksum does not match the manifest.`);
    await stat(path.join(repositoryRoot, asset.license.recordPath));
    const kind = path.extname(asset.path).slice(1);
    report.byKind[kind] = (report.byKind[kind] ?? 0) + info.size;
    report.totalBytes += info.size;
    report.assets.push({ path: asset.path, bytes: info.size, sha256: asset.repositoryFileSha256 });
  }

  const runtimeFiles = [];
  for (const root of runtimeRoots) {
    for (const file of await walk(path.join(repositoryRoot, root))) {
      if (thirdPartyExtensions.has(path.extname(file))) runtimeFiles.push(path.relative(repositoryRoot, file));
    }
  }
  runtimeFiles.sort();
  const documented = [...seen].sort();
  assert(JSON.stringify(runtimeFiles) === JSON.stringify(documented), `Third-party runtime inventory differs from the manifest.\nRuntime: ${runtimeFiles.join(", ")}\nManifest: ${documented.join(", ")}`);

  for (const root of ["src", "server-tools"]) {
    for (const file of await walk(path.join(repositoryRoot, root))) {
      if (!/\.(?:ts|tsx|js|mjs|css)$/.test(file)) continue;
      assert(!runtimeAssetHotlink.test(await readFile(file, "utf8")), `Runtime hotlink to an asset host found in ${path.relative(repositoryRoot, file)}.`);
    }
  }

  if (reportPath) {
    const target = path.resolve(repositoryRoot, reportPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportIndex = process.argv.indexOf("--report");
  const report = await validateThirdPartyAssets({ reportPath: reportIndex >= 0 ? process.argv[reportIndex + 1] : undefined });
  process.stdout.write(`Validated ${report.assets.length} self-hosted third-party assets (${report.totalBytes} bytes).\n`);
}

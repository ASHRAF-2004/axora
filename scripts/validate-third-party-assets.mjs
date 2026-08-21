#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repositoryRoot, "third-party-assets.json");
const runtimeRoots = ["public/catalog/categories", "public/maps"];
const thirdPartyExtensions = new Set([".avif", ".webp", ".geojson", ".pbf"]);
const forbiddenLicences = /non[- ]?commercial|\bNC\b|no[- ]?derivatives|\bND\b|editorial|unknown|unclear/i;
const knownAssetHostHotlink = /(?:kenney\.nl|3dicons\.co|opengameart\.org|naturalearthdata\.com|poly\.pizza|sketchfab\.com)/i;
const remoteRuntimeAsset = /https?:\/\/[^\s"'`)]+\.(?:glb|gltf|bin|ktx2|png|jpe?g|webp|avif|svg|ogg|wav|mp3|woff2?|ttf|otf|geojson)(?:[?#][^\s"'`)]*)?/i;

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

function provenanceSignature(asset) {
  return JSON.stringify([asset.originalFilename, asset.creator, asset.canonicalSource, asset.exactPackOrItem, asset.license]);
}

export function validateAssetManifestMetadata(manifest) {
  assert(manifest.schemaVersion === 1 && Array.isArray(manifest.assets), "Unsupported asset manifest schema.");
  const seen = new Set();
  const originalProvenance = new Map();
  const runtimeProvenance = new Map();
  const unavailableOriginals = [];
  for (const asset of manifest.assets) {
    assert(typeof asset.path === "string" && !path.isAbsolute(asset.path) && !asset.path.includes(".."), `Unsafe asset path: ${asset.path}`);
    assert(!seen.has(asset.path), `Conflicting provenance entries for ${asset.path}`);
    seen.add(asset.path);
    for (const key of ["assetName", "originalFilename", "creator", "canonicalSource", "exactPackOrItem", "downloadDate", "repositoryFileSha256", "modifications", "restrictions"]) {
      assert(typeof asset[key] === "string" && asset[key].trim(), `${asset.path} is missing ${key}`);
    }
    assert(/^https:\/\//.test(asset.canonicalSource), `${asset.path} must use a canonical HTTPS source page.`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(asset.downloadDate), `${asset.path} has an invalid download date.`);
    assert(typeof asset.attributionRequired === "boolean", `${asset.path} must state whether attribution is required.`);
    assert(asset.license && typeof asset.license.name === "string" && /^https:\/\//.test(asset.license.url) && typeof asset.license.recordPath === "string", `${asset.path} has incomplete licence metadata.`);
    assert(!path.isAbsolute(asset.license.recordPath) && !asset.license.recordPath.includes(".."), `${asset.path} has an unsafe licence record path.`);
    assert(!forbiddenLicences.test(`${asset.license.name} ${asset.restrictions}`), `${asset.path} uses a prohibited or unclear licence.`);
    assert(/^[a-f0-9]{64}$/.test(asset.repositoryFileSha256), `${asset.path} has an invalid repository checksum.`);
    if (asset.originalFileSha256 === null) {
      assert(typeof asset.originalChecksumReason === "string" && asset.originalChecksumReason.trim(), `${asset.path} lacks an original checksum without documenting why.`);
      unavailableOriginals.push(asset.path);
    } else {
      assert(/^[a-f0-9]{64}$/.test(asset.originalFileSha256), `${asset.path} has an invalid original checksum.`);
      assert(!asset.originalChecksumReason, `${asset.path} has an original checksum and must not claim it is unavailable.`);
      const signature = provenanceSignature(asset);
      assert(!originalProvenance.has(asset.originalFileSha256) || originalProvenance.get(asset.originalFileSha256) === signature, `${asset.path} conflicts with another record for the same original file.`);
      originalProvenance.set(asset.originalFileSha256, signature);
    }
    const runtimeSignature = provenanceSignature(asset);
    assert(!runtimeProvenance.has(asset.repositoryFileSha256) || runtimeProvenance.get(asset.repositoryFileSha256) === runtimeSignature, `${asset.path} conflicts with another record for identical runtime bytes.`);
    runtimeProvenance.set(asset.repositoryFileSha256, runtimeSignature);
  }
  assert(unavailableOriginals.length === 0, `Every runtime asset must have a verified original checksum; missing: ${unavailableOriginals.join(", ")}`);
  return { seen, unavailableOriginals };
}

export async function validateThirdPartyAssets({ reportPath } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const { seen, unavailableOriginals } = validateAssetManifestMetadata(manifest);
  const report = { generatedAt: new Date().toISOString(), totalBytes: 0, byKind: {}, originalChecksumUnavailable: unavailableOriginals, assets: [] };
  const referencedLicences = new Set();

  for (const asset of manifest.assets) {
    const absolute = path.join(repositoryRoot, asset.path);
    const info = await stat(absolute);
    assert(info.isFile(), `${asset.path} is not a file.`);
    assert(await sha256(absolute) === asset.repositoryFileSha256, `${asset.path} checksum does not match the manifest.`);
    const licencePath = path.join(repositoryRoot, asset.license.recordPath);
    const licence = await readFile(licencePath, "utf8");
    assert(licence.trim().length > 100, `${asset.path} references an empty or incomplete licence record.`);
    referencedLicences.add(asset.license.recordPath);
    const kind = path.extname(asset.path).slice(1);
    report.byKind[kind] = (report.byKind[kind] ?? 0) + info.size;
    report.totalBytes += info.size;
    report.assets.push({ path: asset.path, bytes: info.size, sha256: asset.repositoryFileSha256 });
  }

  const runtimeFiles = [];
  for (const root of runtimeRoots) {
    for (const file of await walk(path.join(repositoryRoot, root))) {
      if (thirdPartyExtensions.has(path.extname(file))) runtimeFiles.push(path.relative(repositoryRoot, file).split(path.sep).join("/"));
    }
  }
  runtimeFiles.sort();
  assert(JSON.stringify(runtimeFiles) === JSON.stringify([...seen].sort()), `Third-party runtime inventory differs from the manifest.\nRuntime: ${runtimeFiles.join(", ")}\nManifest: ${[...seen].sort().join(", ")}`);

  const licenceFiles = (await walk(path.join(repositoryRoot, "third_party/licenses"))).map((file) => path.relative(repositoryRoot, file).split(path.sep).join("/")).sort();
  assert(JSON.stringify(licenceFiles) === JSON.stringify([...referencedLicences].sort()), "Asset licence records and manifest references differ.");

  for (const root of ["src", "server-tools"]) {
    for (const file of await walk(path.join(repositoryRoot, root))) {
      if (!/\.(?:ts|tsx|js|mjs|css)$/.test(file)) continue;
      const source = await readFile(file, "utf8");
      assert(!knownAssetHostHotlink.test(source) && !remoteRuntimeAsset.test(source), `Runtime asset hotlink found in ${path.relative(repositoryRoot, file)}.`);
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
  process.stdout.write(`Validated ${report.assets.length} self-hosted third-party assets (${report.totalBytes} bytes); ${report.originalChecksumUnavailable.length} original-source checksum(s) unavailable with documented reasons.\n`);
}

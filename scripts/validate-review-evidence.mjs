import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { EVIDENCE_CONFIGURATION_PATHS, REQUIRED_REPORT_EVIDENCE, REQUIRED_REVIEW_EVIDENCE } from "./evidence-contract.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_PATH = "output/reports/review-evidence-manifest.json";

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function readVint(buffer, offset, preserveMarker = false) {
  const first = buffer[offset];
  if (first === undefined || first === 0) return null;
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > buffer.length) return null;
  let value = preserveMarker ? first : first & (mask - 1);
  for (let index = 1; index < length; index += 1) value = value * 256 + buffer[offset + index];
  return { length, value };
}

export function readWebmDimensions(buffer) {
  for (let offset = 0; offset < Math.min(buffer.length, 512_000); offset += 1) {
    if (buffer[offset] !== 0xe0) continue;
    const size = readVint(buffer, offset + 1);
    if (!size || size.value <= 0) continue;
    let cursor = offset + 1 + size.length;
    const end = Math.min(buffer.length, cursor + size.value);
    let width;
    let height;
    while (cursor < end) {
      const id = readVint(buffer, cursor, true);
      if (!id) break;
      cursor += id.length;
      const itemSize = readVint(buffer, cursor);
      if (!itemSize) break;
      cursor += itemSize.length;
      if (cursor + itemSize.value > end) break;
      if (id.value === 0xb0 || id.value === 0xba) {
        let value = 0;
        for (let index = 0; index < itemSize.value; index += 1) value = value * 256 + buffer[cursor + index];
        if (id.value === 0xb0) width = value;
        else height = value;
      }
      cursor += itemSize.value;
    }
    if (width && height && width <= 16_384 && height <= 16_384) return { width, height };
  }
  return null;
}

export async function inspectEvidenceFile(absolutePath, contract) {
  const info = await stat(absolutePath);
  if (!info.isFile() || info.size < (contract.minBytes ?? 1)) throw new Error(`${contract.path ?? absolutePath} is empty or too small.`);
  if (contract.kind === "image") {
    const image = sharp(absolutePath);
    const [metadata, statistics] = await Promise.all([image.metadata(), image.stats()]);
    if (metadata.format !== "png") throw new Error(`${contract.path ?? absolutePath} is not PNG evidence.`);
    if ((metadata.width ?? 0) < contract.minWidth || (metadata.height ?? 0) < contract.minHeight) throw new Error(`${contract.path ?? absolutePath} has invalid dimensions.`);
    if (statistics.entropy < contract.minEntropy || statistics.sharpness <= 0) throw new Error(`${contract.path ?? absolutePath} appears blank or non-reviewable.`);
    return { bytes: info.size, mediaType: "image/png", dimensions: { width: metadata.width, height: metadata.height }, entropy: statistics.entropy, sharpness: statistics.sharpness };
  }
  const buffer = await readFile(absolutePath);
  if (contract.kind === "video") {
    if (!buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) throw new Error(`${contract.path ?? absolutePath} is not WebM evidence.`);
    const dimensions = readWebmDimensions(buffer);
    if (!dimensions) throw new Error(`${contract.path ?? absolutePath} does not expose WebM video dimensions.`);
    if (contract.expectedWidth && dimensions.width !== contract.expectedWidth) throw new Error(`${contract.path ?? absolutePath} width ${dimensions.width} does not match ${contract.expectedWidth}.`);
    if (contract.expectedHeight && dimensions.height !== contract.expectedHeight) throw new Error(`${contract.path ?? absolutePath} height ${dimensions.height} does not match ${contract.expectedHeight}.`);
    return { bytes: info.size, mediaType: "video/webm", dimensions };
  }
  const text = buffer.toString("utf8");
  if (contract.kind === "json") JSON.parse(text);
  if (contract.kind === "html" && !/<html[\s>]/i.test(text)) throw new Error(`${contract.path ?? absolutePath} is not reviewable HTML.`);
  return { bytes: info.size, mediaType: contract.kind === "json" ? "application/json" : contract.kind === "html" ? "text/html" : "text/plain", dimensions: null };
}

async function walk(directory, repositoryRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute, repositoryRoot));
    else if (entry.isFile()) files.push(path.relative(repositoryRoot, absolute).split(path.sep).join("/"));
  }
  return files;
}

export async function listEvidenceFiles(repositoryRoot = defaultRoot) {
  const files = [];
  for (const root of ["output/playwright", "output/lighthouse", "output/reports"]) files.push(...await walk(path.join(repositoryRoot, root), repositoryRoot));
  return files.filter((file) => file !== MANIFEST_PATH).sort();
}

export async function validateRequiredEvidence(repositoryRoot = defaultRoot) {
  const results = [];
  for (const contract of [...REQUIRED_REVIEW_EVIDENCE, ...REQUIRED_REPORT_EVIDENCE]) {
    results.push({ path: contract.path, ...await inspectEvidenceFile(path.join(repositoryRoot, contract.path), contract) });
  }
  return results;
}

export async function validateEvidenceManifest(repositoryRoot = defaultRoot) {
  const absoluteManifest = path.join(repositoryRoot, MANIFEST_PATH);
  const manifest = JSON.parse(await readFile(absoluteManifest, "utf8"));
  if (manifest.schemaVersion !== 1) throw new Error("Unsupported review evidence manifest schema.");
  for (const key of ["headSha", "testedCommitSha"]) {
    if (!/^[a-f0-9]{40}$/.test(manifest.source?.[key] ?? "")) throw new Error(`Evidence manifest has invalid ${key}.`);
  }
  if (process.env.AXORA_EVIDENCE_HEAD_SHA && manifest.source.headSha !== process.env.AXORA_EVIDENCE_HEAD_SHA) throw new Error("Evidence manifest head does not match the pull-request head.");
  if (process.env.GITHUB_SHA && manifest.source.testedCommitSha !== process.env.GITHUB_SHA) throw new Error("Evidence manifest tested commit does not match GITHUB_SHA.");
  if (!manifest.source?.nextBuildId || !/^[a-f0-9]{64}$/.test(manifest.source?.standaloneServerSha256 ?? "")) throw new Error("Evidence manifest is not bound to the standalone build.");
  if (!manifest.browser?.chromiumVersion || !manifest.browser?.playwrightVersion) throw new Error("Evidence manifest is missing browser versions.");
  if (!manifest.run?.id || !manifest.environment?.nodeVersion) throw new Error("Evidence manifest is missing run or environment identity.");

  const configuration = new Map((manifest.configuration ?? []).map((entry) => [entry.path, entry]));
  for (const configPath of EVIDENCE_CONFIGURATION_PATHS) {
    const entry = configuration.get(configPath);
    if (!entry || entry.sha256 !== await sha256File(path.join(repositoryRoot, configPath))) throw new Error(`Evidence configuration drift: ${configPath}`);
  }

  const actualFiles = await listEvidenceFiles(repositoryRoot);
  const records = manifest.files ?? [];
  if (new Set(records.map((entry) => entry.path)).size !== records.length) throw new Error("Evidence manifest contains duplicate file records.");
  if (JSON.stringify(actualFiles) !== JSON.stringify(records.map((entry) => entry.path).sort())) throw new Error("Evidence manifest does not exactly match artifact contents.");
  for (const record of records) {
    const absolute = path.join(repositoryRoot, record.path);
    const info = await stat(absolute);
    if (record.bytes !== info.size || record.sha256 !== await sha256File(absolute)) throw new Error(`Evidence checksum drift: ${record.path}`);
    if (!record.testSource) throw new Error(`Evidence record lacks a test source: ${record.path}`);
  }
  return { manifest, manifestSha256: await sha256File(absoluteManifest) };
}

export async function validateReviewEvidence({ repositoryRoot = defaultRoot } = {}) {
  const required = await validateRequiredEvidence(repositoryRoot);
  const manifest = await validateEvidenceManifest(repositoryRoot);
  return { required, ...manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validateReviewEvidence();
  process.stdout.write(`Verified ${result.required.length} content-inspected evidence files; manifest SHA-256 ${result.manifestSha256}.\n`);
}

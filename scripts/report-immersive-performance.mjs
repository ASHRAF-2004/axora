import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { readPublicSceneModelInventory } from "./read-public-scene-inventory.mjs";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(readFileSync(join(root, "docs/immersive-world-v2-performance-baseline.json"), "utf8"));

function filesUnder(directory, extensions) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path, extensions));
    else if (extensions.has(extname(entry.name))) files.push({ path: relative(root, path), bytes: statSync(path).size });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function total(files) {
  return files.reduce((sum, file) => sum + file.bytes, 0);
}

const chunks = filesUnder(join(root, ".next/static/chunks"), new Set([".js"]));
const models = filesUnder(join(root, "public/immersive/models"), new Set([".glb", ".gltf"]));
const categoryTextures = filesUnder(join(root, "public/catalog/categories"), new Set([".avif", ".webp"]));
const audio = filesUnder(join(root, "public/immersive/sounds"), new Set([".ogg", ".wav"]));
const maps = filesUnder(join(root, "public/maps"), new Set([".json", ".geojson"]));
const modelBytes = new Map(models.map((file) => [file.path.split("/").at(-1)?.replace(/\.(glb|gltf)$/, ""), file.bytes]));
const routeModels = readPublicSceneModelInventory(root);
const routes = Object.fromEntries(Object.entries(routeModels).map(([route, ids]) => [route, {
  models: ids,
  stateCount: ids.length,
  modelBytes: ids.reduce((sum, id) => sum + (modelBytes.get(id) ?? 0), 0),
}]));
const current = {
  buildChunkCount: chunks.length,
  buildChunkBytes: total(chunks),
  largestChunkBytes: Math.max(0, ...chunks.map((file) => file.bytes)),
  modelBytes: total(models),
  categoryTextureBytes: total(categoryTextures),
  audioBytes: total(audio),
  mapBytes: total(maps),
};
const deltas = Object.fromEntries(Object.keys(current).map((key) => [key, current[key] - (baseline[key] ?? 0)]));
const report = { generatedAt: new Date().toISOString(), baseline, current, deltas, routes, chunks, models, categoryTextures, audio, maps };
const output = join(root, "output/reports/immersive-performance.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(root, "output/reports/immersive-performance.md"), [
  "# Immersive World V2 performance evidence",
  "",
  `Baseline: \`${baseline.sourceCommit}\``,
  "",
  "| Measure | Baseline | Current | Delta |",
  "| --- | ---: | ---: | ---: |",
  ...Object.keys(current).map((key) => `| ${key} | ${baseline[key] ?? 0} | ${current[key]} | ${deltas[key]} |`),
  "",
  "## Model bytes by public route",
  "",
  ...Object.entries(routes).map(([route, value]) => `- \`${route}\`: ${value.modelBytes} bytes (${value.models.join(", ")})`),
  "",
].join("\n"));

if (current.buildChunkBytes > baseline.buildChunkBytes * 1.05 || current.largestChunkBytes > baseline.largestChunkBytes * 1.05) {
  throw new Error("The repaired build exceeds the audited V2 JavaScript budget by more than five percent.");
}
console.log(`Recorded ${chunks.length} chunks, ${models.length} models, ${categoryTextures.length} category textures, and ${audio.length} audio files.`);

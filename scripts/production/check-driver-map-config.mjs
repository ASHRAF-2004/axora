#!/usr/bin/env node
import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOCAL_CONTEXT_PATTERN = /(?:^|[-_.])(road|roads|street|streets|transport|transportation|highway|highways|motorway|motorways)(?:$|[-_.])/i;
const LABEL_CONTEXT_PATTERN = /(?:^|[-_.])(label|labels|place|places|poi|pois|settlement|settlements|road|roads|street|streets)(?:$|[-_.])/i;

function required(env, name, maximum = 300) {
  const value = String(env[name] ?? "").trim();
  if (!value || value.length > maximum || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`${name} is missing or malformed.`);
  return value;
}

export function isSafePublicMapPath(value) {
  return value.startsWith("/maps/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !value.includes("..")
    && !/[\x00-\x20\x7f]/.test(value);
}

function safeAttributionUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function styleAssetPaths(style) {
  const values = [];
  for (const key of ["glyphs", "sprite"]) if (typeof style[key] === "string") values.push(style[key]);
  for (const source of Object.values(style.sources ?? {})) {
    if (!source || typeof source !== "object") continue;
    if (typeof source.url === "string") values.push(source.url);
    if (typeof source.data === "string") values.push(source.data);
    if (Array.isArray(source.tiles)) values.push(...source.tiles.filter((item) => typeof item === "string"));
  }
  return values;
}

export function assertOperationalStyle(style) {
  if (!style || typeof style !== "object" || style.version !== 8 || !style.sources || !Object.keys(style.sources).length || !Array.isArray(style.layers)) {
    throw new Error("The configured map style is not a usable MapLibre v8 style.");
  }
  if (style.metadata?.["axora:map-purpose"] === "regional-overview-only") {
    throw new Error("The Natural Earth regional overview cannot satisfy operational street-map readiness.");
  }
  if (style.metadata?.["axora:map-purpose"] !== "operational-street") {
    throw new Error("The configured style must declare axora:map-purpose=operational-street after provider review.");
  }
  const unsafeAsset = styleAssetPaths(style).find((asset) => !isSafePublicMapPath(asset));
  if (unsafeAsset) throw new Error("Map styles and sources must be self-hosted under /maps; remote hotlinks are not allowed.");
  const rasterContext = style.layers.some((layer) => layer?.type === "raster" && style.sources[layer.source]?.type === "raster");
  const roadContext = style.layers.some((layer) => layer?.type === "line" && LOCAL_CONTEXT_PATTERN.test(`${layer.id ?? ""} ${layer["source-layer"] ?? ""}`));
  const labelContext = style.layers.some((layer) => layer?.type === "symbol" && LABEL_CONTEXT_PATTERN.test(`${layer.id ?? ""} ${layer["source-layer"] ?? ""}`));
  if (!rasterContext && (!roadContext || !labelContext)) {
    throw new Error("The configured map style lacks road and local-label context.");
  }
  return true;
}

export function buildDriverMapConfig(env = process.env) {
  if (env.AXORA_DRIVER_MAP_OPERATIONAL_READY !== "true") {
    throw new Error("AXORA_DRIVER_MAP_OPERATIONAL_READY must be true only after a provider and local-context dataset are approved.");
  }
  const providerId = required(env, "NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID", 64);
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(providerId)) throw new Error("NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID must be a lowercase slug.");
  const providerName = required(env, "NEXT_PUBLIC_AXORA_MAP_PROVIDER_NAME", 100);
  const styleUrl = required(env, "NEXT_PUBLIC_AXORA_MAP_STYLE_URL", 500);
  if (!isSafePublicMapPath(styleUrl)) throw new Error("NEXT_PUBLIC_AXORA_MAP_STYLE_URL must be a same-origin path under /maps without credentials or traversal.");
  const attributionLabel = required(env, "NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION", 300);
  const attributionUrl = required(env, "NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL", 500);
  if (!safeAttributionUrl(attributionUrl)) throw new Error("NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL must be a credential-free HTTPS URL.");
  return {
    version: 1,
    status: "configured",
    providerId,
    providerName,
    styleUrl,
    attribution: { label: attributionLabel, url: attributionUrl },
  };
}

export async function renderDriverMapConfig(env, outputPath, publicRoot) {
  const config = buildDriverMapConfig(env);
  const stylePath = path.join(publicRoot, config.styleUrl.slice(1));
  const style = JSON.parse(await readFile(stylePath, "utf8"));
  assertOperationalStyle(style);
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
    await chmod(temporaryPath, 0o644);
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return config;
}

async function main() {
  const [mode, outputPath, publicRoot] = process.argv.slice(2);
  if (mode === "--check" && !outputPath && !publicRoot) {
    buildDriverMapConfig(process.env);
    process.stdout.write("Driver map configuration is structurally ready.\n");
    return;
  }
  if (mode === "--render" && outputPath && publicRoot) {
    await renderDriverMapConfig(process.env, path.resolve(outputPath), path.resolve(publicRoot));
    process.stdout.write("Driver map browser configuration generated.\n");
    return;
  }
  throw new Error("Usage: check-driver-map-config.mjs --check | --render OUTPUT_PATH PUBLIC_ROOT");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Driver map readiness failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}

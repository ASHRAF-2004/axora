import type { StyleSpecification } from "maplibre-gl";

export type OperationalMapRuntimeConfig = {
  version: 1;
  status: "configured";
  providerId: string;
  providerName: string;
  styleUrl: string;
  attribution: { label: string; url: string };
  coverage: { bounds: [number, number, number, number]; label: string };
};

export const OPERATIONAL_MAP_CONFIG_URL = "/maps/driver-map-config.json";
export const REGIONAL_OVERVIEW_STYLE = "/maps/axora-operational-style.json";

const LOCAL_CONTEXT_PATTERN = /(?:^|[-_.])(road|roads|street|streets|transport|transportation|highway|highways|motorway|motorways)(?:$|[-_.])/i;
const LABEL_CONTEXT_PATTERN = /(?:^|[-_.])(label|labels|place|places|poi|pois|settlement|settlements|road|roads|street|streets)(?:$|[-_.])/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function usableOperationalMapStyle(value: unknown): value is StyleSpecification {
  const style = asRecord(value);
  const sources = asRecord(style?.sources);
  const layers = Array.isArray(style?.layers) ? style.layers : [];
  return style?.version === 8
    && Boolean(sources && Object.keys(sources).length)
    && layers.some((layer) => {
      const candidate = asRecord(layer);
      return typeof candidate?.source === "string" && Boolean(sources?.[candidate.source]);
    });
}

export function isSameOriginMapAsset(value: string, origin = "https://axora.management") {
  if (/[^\x20-\x7e]/.test(value) || value.includes("\\") || value.includes("..")) return false;
  if (value.startsWith("/maps/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.origin === origin && url.pathname.startsWith("/maps/") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function styleAssetUrls(style: StyleSpecification) {
  const urls: string[] = [];
  const topLevel = style as unknown as Record<string, unknown>;
  for (const key of ["glyphs", "sprite"]) {
    if (typeof topLevel[key] === "string") urls.push(topLevel[key]);
  }
  for (const source of Object.values(style.sources) as Array<Record<string, unknown>>) {
    if (typeof source.url === "string") urls.push(source.url);
    if (typeof source.data === "string") urls.push(source.data);
    if (Array.isArray(source.tiles)) {
      urls.push(...source.tiles.filter((tile): tile is string => typeof tile === "string"));
    }
  }
  return urls;
}

export function operationalStyleAssessment(value: unknown, origin = "https://axora.management") {
  if (!usableOperationalMapStyle(value)) return { usable: false as const, reason: "invalid-style" };
  const style = value;
  const metadata = asRecord((style as unknown as Record<string, unknown>).metadata);
  if (metadata?.["axora:map-purpose"] === "regional-overview-only") {
    return { usable: false as const, reason: "overview-only" };
  }
  if (metadata?.["axora:map-purpose"] !== "operational-street") {
    return { usable: false as const, reason: "operational-purpose-missing" };
  }
  if (styleAssetUrls(style).some((asset) => !isSameOriginMapAsset(asset, origin))) {
    return { usable: false as const, reason: "remote-or-unsafe-source" };
  }
  const sourceRecords = style.sources as unknown as Record<string, Record<string, unknown>>;
  const layers = style.layers.map((layer) => layer as unknown as Record<string, unknown>);
  const rasterContext = layers.some((layer) => {
    const source = typeof layer.source === "string" ? sourceRecords[layer.source] : undefined;
    return layer.type === "raster" && source?.type === "raster";
  });
  const roadContext = layers.some((layer) => {
    const semanticId = `${String(layer.id ?? "")} ${String(layer["source-layer"] ?? "")}`;
    return layer.type === "line" && LOCAL_CONTEXT_PATTERN.test(semanticId);
  });
  const labelContext = layers.some((layer) => {
    const semanticId = `${String(layer.id ?? "")} ${String(layer["source-layer"] ?? "")}`;
    return layer.type === "symbol" && LABEL_CONTEXT_PATTERN.test(semanticId);
  });
  if (!rasterContext && (!roadContext || !labelContext)) {
    return { usable: false as const, reason: "local-context-missing" };
  }
  return { usable: true as const, reason: "operational-context" };
}

export function parseOperationalMapRuntimeConfig(value: unknown):
  | { state: "configured"; config: OperationalMapRuntimeConfig }
  | { state: "unconfigured" | "failed" } {
  const config = asRecord(value);
  if (config?.version !== 1) return { state: "failed" };
  if (config.status === "unconfigured") return { state: "unconfigured" };
  const attribution = asRecord(config.attribution);
  const coverage = asRecord(config.coverage);
  const bounds = Array.isArray(coverage?.bounds) ? coverage.bounds : [];
  if (config.status !== "configured"
    || typeof config.providerId !== "string"
    || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(config.providerId)
    || typeof config.providerName !== "string"
    || !config.providerName.trim()
    || typeof config.styleUrl !== "string"
    || !isSameOriginMapAsset(config.styleUrl)
    || typeof attribution?.label !== "string"
    || !attribution.label.trim()
    || typeof attribution.url !== "string"
    || bounds.length !== 4
    || bounds.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
    || bounds[0] >= bounds[2]
    || bounds[1] >= bounds[3]
    || typeof coverage?.label !== "string"
    || !coverage.label.trim()) return { state: "failed" };
  try {
    const attributionUrl = new URL(attribution.url);
    if (attributionUrl.protocol !== "https:" || attributionUrl.username || attributionUrl.password) {
      return { state: "failed" };
    }
  } catch {
    return { state: "failed" };
  }
  return { state: "configured", config: config as OperationalMapRuntimeConfig };
}

export function operationalMapContainsCoordinate(
  coverage: OperationalMapRuntimeConfig["coverage"],
  coordinate: { latitude: number; longitude: number },
) {
  const [west, south, east, north] = coverage.bounds;
  return coordinate.longitude >= west
    && coordinate.longitude <= east
    && coordinate.latitude >= south
    && coordinate.latitude <= north;
}

export function operationalMapCoverageCenter(coverage: OperationalMapRuntimeConfig["coverage"]): [number, number] {
  const [west, south, east, north] = coverage.bounds;
  return [(west + east) / 2, (south + north) / 2];
}

export function escapeOperationalMapHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }
  )[character]!);
}

export function semanticMapColor(
  container: HTMLElement,
  property: "--axora-map-route" | "--axora-map-marker",
  fallback: string,
) {
  const scope = container.closest<HTMLElement>(".app-shell") ?? document.documentElement;
  return window.getComputedStyle(scope).getPropertyValue(property).trim() || fallback;
}

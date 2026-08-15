"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import type { DriverDetailWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";
import { driverManagementMessages } from "@/lib/driver-management-i18n";

type LocationPoint = { latitude: number; longitude: number; accuracy: number; capturedAt: string };
type RuntimeMapConfig = {
  version: 1;
  status: "configured";
  providerId: string;
  providerName: string;
  styleUrl: string;
  attribution: { label: string; url: string };
  coverage: { bounds: [number, number, number, number]; label: string };
};
type ConfigState = "checking" | "configured" | "unconfigured" | "failed";
type MapState = "idle" | "loading" | "ready" | "missing" | "outside" | "failed";

const ROUTE_SOURCE_ID = "driver-route";
const ROUTE_LAYER_ID = "driver-route-line";
const RUNTIME_CONFIG_URL = "/maps/driver-map-config.json";
const REGIONAL_OVERVIEW_STYLE = "/maps/axora-operational-style.json";
const LOCAL_CONTEXT_PATTERN = /(?:^|[-_.])(road|roads|street|streets|transport|transportation|highway|highways|motorway|motorways)(?:$|[-_.])/i;
const LABEL_CONTEXT_PATTERN = /(?:^|[-_.])(label|labels|place|places|poi|pois|settlement|settlements|road|roads|street|streets)(?:$|[-_.])/i;

function routeFeature(points: LocationPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates = points.map((point) => [point.longitude, point.latitude]);
  if (coordinates.length === 1) coordinates.push([...coordinates[0]]);
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function usableStyle(value: unknown): value is StyleSpecification {
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

function isSameOriginMapAsset(value: string, origin = "https://axora.management") {
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

function operationalStyleAssessment(value: unknown, origin = "https://axora.management") {
  if (!usableStyle(value)) return { usable: false as const, reason: "invalid-style" };
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

function parseRuntimeConfig(value: unknown): { state: "configured"; config: RuntimeMapConfig } | { state: "unconfigured" | "failed" } {
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
    if (attributionUrl.protocol !== "https:" || attributionUrl.username || attributionUrl.password) return { state: "failed" };
  } catch {
    return { state: "failed" };
  }
  return { state: "configured", config: config as RuntimeMapConfig };
}

function coverageContainsPoints(coverage: RuntimeMapConfig["coverage"], points: LocationPoint[]) {
  const [west, south, east, north] = coverage.bounds;
  return points.every(({ longitude, latitude }) => longitude >= west && longitude <= east && latitude >= south && latitude <= north);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function fitRoute(map: MapLibreMap, points: LocationPoint[]) {
  if (!points.length) return;
  if (points.length === 1) {
    map.jumpTo({ center: [points[0].longitude, points[0].latitude], zoom: 14 });
    return;
  }
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  map.fitBounds(
    [[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]],
    { duration: 0, maxZoom: 16, padding: map.getContainer().clientWidth < 600 ? 36 : 64 },
  );
}

export function DriverLiveMap({ driverId, points, locale = "en" }: { driverId: string; points: LocationPoint[]; locale?: SupportedLocale }) {
  const copy = driverManagementMessages(locale);
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestPointsRef = useRef(points);
  const sequence = useRef(0);
  const [livePoints, setLivePoints] = useState(points);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeMapConfig | null>(null);
  const [configState, setConfigState] = useState<ConfigState>("checking");
  const [mapState, setMapState] = useState<MapState>(points.length ? "idle" : "missing");
  const [clock, setClock] = useState(() => Date.now());
  const latestPoint = livePoints.at(-1);
  const pointsInCoverage = !runtimeConfig || coverageContainsPoints(runtimeConfig.coverage, livePoints);
  const locationStale = !latestPoint || clock - new Date(latestPoint.capturedAt).getTime() > 120_000;
  const presentedState = configState === "unconfigured"
    ? "unconfigured"
    : configState === "failed"
      ? "failed"
      : configState === "configured" && !pointsInCoverage
        ? "outside"
      : configState === "configured" && !livePoints.length
        ? "missing"
        : configState === "configured" && (mapState === "idle" || mapState === "missing")
          ? "loading"
          : mapState;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    latestPointsRef.current = livePoints;
  }, [livePoints]);

  useEffect(() => {
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const response = await fetch(RUNTIME_CONFIG_URL, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) {
          setConfigState(response.status === 404 ? "unconfigured" : "failed");
          return;
        }
        const parsed = parseRuntimeConfig(await response.json());
        setConfigState(parsed.state);
        setRuntimeConfig(parsed.state === "configured" ? parsed.config : null);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setConfigState("failed");
      }
    };
    void loadConfig();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    let request: AbortController | undefined;
    let disposed = false;
    let connecting = false;
    let generation = 0;
    const apply = (driver: DriverDetailWorkspace) => setLivePoints(driver.locations);
    const load = async (expectedGeneration: number) => {
      request?.abort();
      request = new AbortController();
      try {
        const response = await fetch(`/api/drivers/${encodeURIComponent(driverId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: request.signal,
        });
        if (!response.ok || disposed || expectedGeneration !== generation) return false;
        apply(await response.json() as DriverDetailWorkspace);
        return !disposed && expectedGeneration === generation;
      } catch (error) {
        // Keep the last authoritative route visible during a transient snapshot
        // failure. Map-source failures are reported separately by the renderer.
        void error;
        return false;
      }
    };
    const connect = async () => {
      if (document.hidden || source || fallback !== undefined || connecting || disposed) return;
      connecting = true;
      const expectedGeneration = ++generation;
      const authorized = await load(expectedGeneration);
      connecting = false;
      if (!authorized || document.hidden || source || fallback !== undefined || disposed
        || expectedGeneration !== generation) return;
      if (typeof globalThis.EventSource !== "function") {
        fallback = window.setInterval(() => void load(expectedGeneration), 15_000);
        return;
      }
      sequence.current = 0;
      source = new EventSource(`/api/drivers/${encodeURIComponent(driverId)}/live`, { withCredentials: true });
      source.addEventListener("snapshot", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as { sequence: number; version: string; snapshot: DriverDetailWorkspace };
          if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence.current
            || typeof message.version !== "string" || !/^[0-9a-f]{64}$/.test(message.version)) return;
          sequence.current = message.sequence;
          apply(message.snapshot);
        } catch { /* A later authoritative snapshot recovers malformed transport data. */ }
      });
    };
    const pause = () => {
      generation += 1;
      request?.abort();
      request = undefined;
      source?.close();
      source = null;
      if (fallback !== undefined) window.clearInterval(fallback);
      fallback = undefined;
    };
    const visibility = () => document.hidden ? pause() : void connect();
    document.addEventListener("visibilitychange", visibility);
    const online = () => void connect();
    const offline = () => pause();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void connect();
    return () => {
      disposed = true;
      generation += 1;
      request?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      source?.close();
      if (fallback !== undefined) window.clearInterval(fallback);
    };
  }, [driverId]);

  useEffect(() => {
    if (!runtimeConfig || configState !== "configured") return;
    if (!livePoints.length) return;
    if (!coverageContainsPoints(runtimeConfig.coverage, livePoints)) return;
    let disposed = false;
    const controller = new AbortController();
    const start = async () => {
      try {
        setMapState("loading");
        const styleResponse = await fetch(runtimeConfig.styleUrl, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!styleResponse.ok) {
          setMapState("failed");
          return;
        }
        const style = await styleResponse.json() as unknown;
        if (!operationalStyleAssessment(style, window.location.origin).usable) {
          setMapState("failed");
          return;
        }
        const { default: maplibregl } = await import("maplibre-gl");
        if (disposed || !host.current) return;
        const map = new maplibregl.Map({
          container: host.current,
          style: style as StyleSpecification,
          center: [latestPointsRef.current.at(-1)!.longitude, latestPointsRef.current.at(-1)!.latitude],
          zoom: 14,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({
          compact: false,
          customAttribution: `<a href="${escapeHtml(runtimeConfig.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(runtimeConfig.attribution.label)}</a>`,
        }));
        map.on("error", () => { if (!disposed) setMapState("failed"); });
        map.once("load", () => {
          if (disposed) return;
          map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeFeature(latestPointsRef.current) });
          map.addLayer({
            id: ROUTE_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            paint: { "line-color": "#0284c7", "line-width": 4, "line-opacity": 0.82 },
          });
          const latest = latestPointsRef.current.at(-1)!;
          markerRef.current = new maplibregl.Marker({ color: "#0ea5e9" })
            .setLngLat([latest.longitude, latest.latitude])
            .addTo(map);
          fitRoute(map, latestPointsRef.current);
          map.once("idle", () => { if (!disposed) setMapState("ready"); });
        });
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") setMapState("failed");
      }
    };
    void start();
    return () => {
      disposed = true;
      controller.abort();
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // Recreate only when the driver, reviewed style, or presence of route data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, runtimeConfig, configState, Boolean(livePoints.length), pointsInCoverage]);

  useEffect(() => {
    const map = mapRef.current;
    const latest = livePoints.at(-1);
    if (!map || !latest || !runtimeConfig || !coverageContainsPoints(runtimeConfig.coverage, livePoints) || !map.isStyleLoaded()) return;
    markerRef.current?.setLngLat([latest.longitude, latest.latitude]);
    (map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(routeFeature(livePoints));
    fitRoute(map, livePoints);
  }, [livePoints, mapState, runtimeConfig]);

  const mapHostVisible = configState === "configured" && Boolean(runtimeConfig) && livePoints.length > 0 && mapState !== "failed" && pointsInCoverage;

  return <section className="panel" aria-labelledby="driver-live-map-title">
    <div className="panel-header"><div><h2 id="driver-live-map-title">{copy.map}</h2><p>{copy.mapHelp}</p></div></div>
    <div
      ref={host}
      data-map-state={presentedState}
      data-map-provider={runtimeConfig?.providerId ?? "unconfigured"}
      data-route-point-count={livePoints.length}
      data-latest-coordinate={latestPoint ? `${latestPoint.latitude.toFixed(6)},${latestPoint.longitude.toFixed(6)}` : undefined}
      style={{ blockSize: mapHostVisible ? 420 : 0, borderRadius: 16, overflow: "hidden", display: mapHostVisible ? "block" : "none" }}
      aria-label={copy.routeMap}
    />
    <p className={locationStale ? "callout" : "subtle"} aria-live="polite">
      {!latestPoint ? copy.noLocation : locationStale ? copy.stale : `±${Math.round(latestPoint.accuracy)} m · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestPoint.capturedAt))}`}
    </p>
    {configState === "checking" || presentedState === "loading" ? <p className="subtle">{copy.loading}</p> : null}
    {configState === "unconfigured" ? <p className="callout" role="alert">{copy.mapUnconfigured}</p> : null}
    {configState === "failed" ? <p className="callout" role="alert">{copy.mapConfigurationInvalid}</p> : null}
    {configState === "configured" && presentedState === "missing" ? <p className="callout">{copy.mapMissing}</p> : null}
    {configState === "configured" && presentedState === "outside" && runtimeConfig ? <p className="callout" role="alert">{copy.mapOutsideCoverage} {runtimeConfig.coverage.label}.</p> : null}
    {configState === "configured" && mapState === "failed" ? <p className="callout" role="alert">{copy.mapFailed}</p> : null}
    {configState === "configured" && mapState === "ready" && runtimeConfig ? <p className="subtle" data-map-attribution>
      {copy.mapAttribution}: <a href={runtimeConfig.attribution.url} target="_blank" rel="noreferrer">{runtimeConfig.attribution.label}</a>
    </p> : null}
  </section>;
}

export const driverLiveMapInternals = {
  REGIONAL_OVERVIEW_STYLE,
  ROUTE_LAYER_ID,
  ROUTE_SOURCE_ID,
  RUNTIME_CONFIG_URL,
  fitRoute,
  isSameOriginMapAsset,
  operationalStyleAssessment,
  coverageContainsPoints,
  parseRuntimeConfig,
  routeFeature,
  usableStyle,
};

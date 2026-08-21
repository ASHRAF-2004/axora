"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import type { DriverDetailWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";
import { driverManagementMessages } from "@/lib/driver-management-i18n";
import {
  escapeOperationalMapHtml as escapeHtml,
  isSameOriginMapAsset,
  OPERATIONAL_MAP_CONFIG_URL as RUNTIME_CONFIG_URL,
  operationalMapContainsCoordinate,
  operationalStyleAssessment,
  parseOperationalMapRuntimeConfig as parseRuntimeConfig,
  REGIONAL_OVERVIEW_STYLE,
  semanticMapColor,
  type OperationalMapRuntimeConfig as RuntimeMapConfig,
  usableOperationalMapStyle as usableStyle,
} from "@/lib/operational-map";

type LocationPoint = { latitude: number; longitude: number; accuracy: number; capturedAt: string };
type ConfigState = "checking" | "configured" | "unconfigured" | "failed";
type MapState = "idle" | "loading" | "ready" | "missing" | "outside" | "failed";

const ROUTE_SOURCE_ID = "driver-route";
const ROUTE_LAYER_ID = "driver-route-line";

function routeFeature(points: LocationPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates = points.map((point) => [point.longitude, point.latitude]);
  if (coordinates.length === 1) coordinates.push([...coordinates[0]]);
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

function coverageContainsPoints(coverage: RuntimeMapConfig["coverage"], points: LocationPoint[]) {
  return points.every((point) => operationalMapContainsCoordinate(coverage, point));
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
    let appearanceObserver: MutationObserver | null = null;
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
        const mapHost = host.current;
        const map = new maplibregl.Map({
          container: mapHost,
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
            paint: {
              "line-color": semanticMapColor(mapHost, "--axora-map-route", "#0B568F"),
              "line-width": 4,
              "line-opacity": 0.82,
            },
          });
          const latest = latestPointsRef.current.at(-1)!;
          const markerElement = document.createElement("div");
          markerElement.className = "axora-map-marker";
          markerElement.setAttribute("aria-hidden", "true");
          markerRef.current = new maplibregl.Marker({ element: markerElement, anchor: "center" })
            .setLngLat([latest.longitude, latest.latitude])
            .addTo(map);
          const appearanceScope = mapHost.closest<HTMLElement>(".app-shell") ?? document.documentElement;
          appearanceObserver = new MutationObserver(() => {
            if (!map.isStyleLoaded() || !map.getLayer(ROUTE_LAYER_ID)) return;
            map.setPaintProperty(
              ROUTE_LAYER_ID,
              "line-color",
              semanticMapColor(mapHost, "--axora-map-route", "#0B568F"),
            );
          });
          appearanceObserver.observe(appearanceScope, { attributes: true, attributeFilter: ["data-appearance"] });
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
      appearanceObserver?.disconnect();
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
  semanticMapColor,
  usableStyle,
};

"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import type { DriverDetailWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";
import { driverManagementMessages } from "@/lib/driver-management-i18n";

type LocationPoint = { latitude: number; longitude: number; accuracy: number; capturedAt: string };

const ROUTE_SOURCE_ID = "driver-route";
const ROUTE_LAYER_ID = "driver-route-line";
const SELF_HOSTED_STYLE = "/maps/axora-operational-style.json";

function routeFeature(points: LocationPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => [point.longitude, point.latitude]),
    },
  };
}

function usableStyle(value: unknown): value is StyleSpecification {
  if (!value || typeof value !== "object") return false;
  const style = value as Partial<StyleSpecification>;
  return style.version === 8
    && Boolean(style.sources && Object.keys(style.sources).length)
    && Boolean(style.layers?.some((layer) => "source" in layer && typeof layer.source === "string"));
}

export function DriverLiveMap({ driverId, points, locale = "en" }: { driverId: string; points: LocationPoint[]; locale?: SupportedLocale }) {
  const copy = driverManagementMessages(locale);
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const latestPointsRef = useRef(points);
  const sequence = useRef(0);
  const [livePoints, setLivePoints] = useState(points);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">(points.length ? "loading" : "missing");
  const [clock, setClock] = useState(() => Date.now());
  const configuredStyle = process.env.NEXT_PUBLIC_AXORA_MAP_STYLE_URL?.trim();
  const styleUrl = configuredStyle || SELF_HOSTED_STYLE;
  const latestPoint = livePoints.at(-1);
  const locationStale = !latestPoint || clock - new Date(latestPoint.capturedAt).getTime() > 120_000;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    latestPointsRef.current = livePoints;
  }, [livePoints]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    let disposed = false;
    let connecting = false;
    const apply = (driver: DriverDetailWorkspace) => setLivePoints(driver.locations);
    const load = async () => {
      const response = await fetch(`/api/drivers/${encodeURIComponent(driverId)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return;
      apply(await response.json() as DriverDetailWorkspace);
    };
    const connect = async () => {
      if (document.hidden || source || connecting || disposed) return;
      connecting = true;
      await load();
      connecting = false;
      if (document.hidden || source || disposed) return;
      if (typeof globalThis.EventSource !== "function") {
        fallback = window.setInterval(() => void load(), 15_000);
        return;
      }
      source = new EventSource(`/api/drivers/${encodeURIComponent(driverId)}/live`, { withCredentials: true });
      source.addEventListener("snapshot", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as { sequence: number; snapshot: DriverDetailWorkspace };
          if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence.current) return;
          sequence.current = message.sequence;
          apply(message.snapshot);
        } catch { /* A later authoritative snapshot recovers malformed transport data. */ }
      });
    };
    const visibility = () => {
      if (document.hidden) {
        source?.close();
        source = null;
        if (fallback) window.clearInterval(fallback);
        fallback = undefined;
      } else void connect();
    };
    document.addEventListener("visibilitychange", visibility);
    const online = () => void connect();
    window.addEventListener("online", online);
    void connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      source?.close();
      if (fallback) window.clearInterval(fallback);
    };
  }, [driverId]);

  useEffect(() => {
    if (!host.current || !livePoints.length) {
      setState("missing");
      return;
    }
    let disposed = false;
    const start = async () => {
      try {
        const styleResponse = await fetch(styleUrl, { cache: "force-cache" });
        if (!styleResponse.ok || !usableStyle(await styleResponse.json())) {
          setState("failed");
          return;
        }
        const { default: maplibregl } = await import("maplibre-gl");
        if (disposed || !host.current) return;
        const latest = latestPointsRef.current.at(-1)!;
        const map = new maplibregl.Map({
          container: host.current,
          style: styleUrl,
          center: [latest.longitude, latest.latitude],
          zoom: 14,
          attributionControl: false,
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new maplibregl.AttributionControl({
          compact: false,
          customAttribution: '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · public domain',
        }));
        markerRef.current = new maplibregl.Marker({ color: "#0ea5e9" })
          .setLngLat([latest.longitude, latest.latitude])
          .addTo(map);
        map.once("load", () => {
          if (disposed) return;
          map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeFeature(latestPointsRef.current) });
          map.addLayer({
            id: ROUTE_LAYER_ID,
            type: "line",
            source: ROUTE_SOURCE_ID,
            paint: { "line-color": "#0284c7", "line-width": 4, "line-opacity": 0.82 },
          });
          setState("ready");
        });
        map.on("error", () => { if (!disposed) setState("failed"); });
      } catch {
        if (!disposed) setState("failed");
      }
    };
    void start();
    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  // The map is initialized once per driver/style; live coordinates update below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, styleUrl, Boolean(livePoints.length)]);

  useEffect(() => {
    const map = mapRef.current;
    const latest = livePoints.at(-1);
    if (!map || !latest || !map.isStyleLoaded()) return;
    markerRef.current?.setLngLat([latest.longitude, latest.latitude]);
    (map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined)?.setData(routeFeature(livePoints));
  }, [livePoints, state]);

  return <section className="panel" aria-labelledby="driver-live-map-title">
    <div className="panel-header"><div><h2 id="driver-live-map-title">{copy.map}</h2><p>{copy.mapHelp}</p></div></div>
    <div
      ref={host}
      data-map-state={state}
      data-map-provider="natural-earth-self-hosted"
      data-route-point-count={livePoints.length}
      data-latest-coordinate={latestPoint ? `${latestPoint.latitude.toFixed(6)},${latestPoint.longitude.toFixed(6)}` : undefined}
      style={{ blockSize: 420, borderRadius: 16, overflow: "hidden", display: livePoints.length ? "block" : "none" }}
      aria-label={copy.routeMap}
    />
    <p className={locationStale ? "callout" : "subtle"} aria-live="polite">
      {!latestPoint ? copy.noLocation : locationStale ? copy.stale : `±${Math.round(latestPoint.accuracy)} m · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestPoint.capturedAt))}`}
    </p>
    {state === "loading" ? <p className="subtle">{copy.loading}</p> : null}
    {state === "missing" ? <p className="callout">{copy.mapMissing}</p> : null}
    {state === "failed" ? <p className="callout" role="alert">{copy.mapFailed}</p> : null}
  </section>;
}

export const driverLiveMapInternals = { ROUTE_LAYER_ID, ROUTE_SOURCE_ID, SELF_HOSTED_STYLE, routeFeature, usableStyle };

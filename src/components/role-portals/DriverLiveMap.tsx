"use client";

import { useEffect, useRef, useState } from "react";

import type { DriverDetailWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";
import { driverManagementMessages } from "@/lib/driver-management-i18n";

type LocationPoint = { latitude: number; longitude: number; accuracy: number; capturedAt: string };

export function DriverLiveMap({ driverId, points, locale = "en" }: { driverId: string; points: LocationPoint[]; locale?: SupportedLocale }) {
  const copy = driverManagementMessages(locale);
  const host = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);
  const [livePoints, setLivePoints] = useState(points);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [clock, setClock] = useState(() => Date.now());
  const styleUrl = process.env.NEXT_PUBLIC_AXORA_MAP_STYLE_URL || "/maps/axora-operational-style.json";
  const latestPoint = livePoints.at(-1);
  const locationStale = !latestPoint || clock - new Date(latestPoint.capturedAt).getTime() > 120_000;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    const apply = (driver: DriverDetailWorkspace) => setLivePoints(driver.locations);
    const load = async () => {
      const response = await fetch(`/api/drivers/${encodeURIComponent(driverId)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return;
      apply(await response.json() as DriverDetailWorkspace);
    };
    const connect = () => {
      if (document.hidden || source) return;
      void load();
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
        } catch { /* The next authoritative snapshot can recover. */ }
      });
      source.onerror = () => { /* Native EventSource reconnects automatically. */ };
    };
    const visibility = () => {
      if (document.hidden) {
        source?.close(); source = null;
        if (fallback) window.clearInterval(fallback);
        fallback = undefined;
      } else connect();
    };
    const online = () => connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    connect();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      source?.close();
      if (fallback) window.clearInterval(fallback);
    };
  }, [driverId]);

  useEffect(() => {
    if (!host.current || !styleUrl || !livePoints.length) {
      setState("missing");
      return;
    }
    let disposed = false;
    let removeMap: (() => void) | undefined;
    void import("maplibre-gl").then(({ default: maplibregl }) => {
      if (disposed || !host.current) return;
      const latest = livePoints.at(-1)!;
      const map = new maplibregl.Map({
        container: host.current,
        style: styleUrl,
        center: [latest.longitude, latest.latitude],
        zoom: 14,
        attributionControl: { customAttribution: "Axora operational route" },
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      const marker = new maplibregl.Marker({ color: "#0ea5e9" })
        .setLngLat([latest.longitude, latest.latitude])
        .addTo(map);
      map.once("load", () => {
        if (disposed) return;
        const coordinates = livePoints.map((point) => [point.longitude, point.latitude]);
        if (coordinates.length > 1) {
          map.addSource("driver-route", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } },
          });
          map.addLayer({
            id: "driver-route", type: "line", source: "driver-route",
            paint: { "line-color": "#0284c7", "line-width": 4, "line-opacity": 0.82 },
          });
        }
        setState("ready");
      });
      map.on("error", () => { if (!disposed) setState("failed"); });
      removeMap = () => { marker.remove(); map.remove(); };
    }).catch(() => setState("failed"));
    return () => { disposed = true; removeMap?.(); };
  }, [livePoints, styleUrl]);

  return <section className="panel" aria-labelledby="driver-live-map-title">
    <div className="panel-header"><div><h2 id="driver-live-map-title">{copy.map}</h2><p>{copy.mapHelp}</p></div></div>
    <div ref={host} style={{ blockSize: 420, borderRadius: 16, overflow: "hidden" }} aria-label={copy.routeMap} />
    <p className={locationStale ? "callout" : "subtle"} aria-live="polite">
      {!latestPoint ? copy.noLocation : locationStale ? copy.stale : `±${Math.round(latestPoint.accuracy)} m · ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(latestPoint.capturedAt))}`}
    </p>
    {state === "loading" ? <p className="subtle">{copy.loading}</p> : null}
    {state === "missing" ? <p className="callout">{copy.mapMissing}</p> : null}
    {state === "failed" ? <p className="callout" role="alert">{copy.mapFailed}</p> : null}
  </section>;
}

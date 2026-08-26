"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import { buildDeliveryNavigationLinks, deliveryCoordinatesSchema } from "@/lib/delivery-navigation";
import { deliveryWorkflowMessages, type DeliveryWorkflowLocale } from "@/lib/delivery-workflow-i18n";
import {
  escapeOperationalMapHtml,
  OPERATIONAL_MAP_CONFIG_URL,
  operationalMapContainsCoordinate,
  operationalStyleAssessment,
  parseOperationalMapRuntimeConfig,
  semanticMapColor,
} from "@/lib/operational-map";
import styles from "./DeliveryDestinationMap.module.css";

type State = "loading" | "ready" | "unavailable" | "outside" | "failed";

function formatDistance(value: number | null | undefined, locale: DeliveryWorkflowLocale) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value < 1_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
}

function formatEta(value: number | null | undefined, locale: DeliveryWorkflowLocale) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const minutes = Math.max(1, Math.ceil(value / 60));
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(minutes, "minute");
}

export function DeliveryDestinationMap({
  address,
  currentLatitude,
  currentLongitude,
  etaSeconds,
  latitude,
  locale = "en",
  longitude,
  remainingMeters,
  showNavigationLinks = true,
  trackingStatus,
}: {
  address: string;
  currentLatitude?: number | null;
  currentLongitude?: number | null;
  etaSeconds?: number | null;
  latitude: number;
  locale?: DeliveryWorkflowLocale;
  longitude: number;
  remainingMeters?: number | null;
  showNavigationLinks?: boolean;
  trackingStatus?: string;
}) {
  const copy = deliveryWorkflowMessages(locale);
  const titleId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const destinationMarkerRef = useRef<MapLibreMarker | null>(null);
  const currentMarkerRef = useRef<MapLibreMarker | null>(null);
  const updateContextRef = useRef<(() => void) | null>(null);
  const destination = useMemo(() => {
    const parsed = deliveryCoordinatesSchema.safeParse({ latitude, longitude });
    return parsed.success ? parsed.data : null;
  }, [latitude, longitude]);
  const current = useMemo(() => {
    const parsed = deliveryCoordinatesSchema.safeParse({
      latitude: currentLatitude,
      longitude: currentLongitude,
    });
    return parsed.success ? parsed.data : null;
  }, [currentLatitude, currentLongitude]);
  const currentRef = useRef(current);
  const links = destination ? buildDeliveryNavigationLinks(destination) : null;
  const [state, setState] = useState<State>(destination ? "loading" : "unavailable");
  const [currentOutsideCoverage, setCurrentOutsideCoverage] = useState(false);

  useEffect(() => {
    if (!destination) return;
    let disposed = false;
    const controller = new AbortController();
    const start = async () => {
      try {
        setState("loading");
        const configResponse = await fetch(OPERATIONAL_MAP_CONFIG_URL, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!configResponse.ok) { setState("unavailable"); return; }
        const parsedConfig = parseOperationalMapRuntimeConfig(await configResponse.json());
        if (parsedConfig.state !== "configured") { setState("unavailable"); return; }
        if (!operationalMapContainsCoordinate(parsedConfig.config.coverage, destination)) {
          setState("outside");
          return;
        }
        const styleResponse = await fetch(parsedConfig.config.styleUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!styleResponse.ok) { setState("failed"); return; }
        const style = await styleResponse.json() as unknown;
        if (!operationalStyleAssessment(style, window.location.origin).usable) {
          setState("failed");
          return;
        }
        const { default: mapLibrary } = await import("maplibre-gl");
        if (disposed || !hostRef.current) return;
        const mapHost = hostRef.current;
        const map = new mapLibrary.Map({
          attributionControl: false,
          center: [destination.longitude, destination.latitude],
          container: mapHost,
          maxBounds: [
            [parsedConfig.config.coverage.bounds[0], parsedConfig.config.coverage.bounds[1]],
            [parsedConfig.config.coverage.bounds[2], parsedConfig.config.coverage.bounds[3]],
          ],
          style: style as StyleSpecification,
          zoom: 15,
        });
        mapRef.current = map;
        map.addControl(new mapLibrary.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new mapLibrary.AttributionControl({
          compact: true,
          customAttribution: `<a href="${escapeOperationalMapHtml(parsedConfig.config.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeOperationalMapHtml(parsedConfig.config.attribution.label)}</a>`,
        }));
        map.on("error", () => { if (!disposed) setState("failed"); });
        map.once("load", () => {
          if (disposed) return;
          map.getCanvas().setAttribute("aria-label", copy.destinationMap);
          const destinationElement = document.createElement("div");
          destinationElement.className = styles.destinationMarker;
          destinationElement.setAttribute("aria-hidden", "true");
          destinationMarkerRef.current = new mapLibrary.Marker({
            anchor: "center",
            element: destinationElement,
          }).setLngLat([destination.longitude, destination.latitude]).addTo(map);
          map.addSource("delivery-direct-estimate", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "delivery-direct-estimate",
            type: "line",
            source: "delivery-direct-estimate",
            paint: {
              "line-color": semanticMapColor(mapHost, "--axora-map-route", "#0B568F"),
              "line-dasharray": [1.5, 1.5],
              "line-opacity": .8,
              "line-width": 4,
            },
          });

          const renderContext = () => {
            currentMarkerRef.current?.remove();
            currentMarkerRef.current = null;
            const currentPosition = currentRef.current;
            const inCoverage = !currentPosition
              || operationalMapContainsCoordinate(parsedConfig.config.coverage, currentPosition);
            setCurrentOutsideCoverage(!inCoverage);
            const source = map.getSource("delivery-direct-estimate") as GeoJSONSource | undefined;
            if (!currentPosition || !inCoverage) {
              source?.setData({ type: "FeatureCollection", features: [] });
              map.jumpTo({ center: [destination.longitude, destination.latitude], zoom: 15 });
              return;
            }
            const currentElement = document.createElement("div");
            currentElement.className = styles.currentMarker;
            currentElement.setAttribute("aria-hidden", "true");
            currentMarkerRef.current = new mapLibrary.Marker({
              anchor: "center",
              element: currentElement,
            }).setLngLat([currentPosition.longitude, currentPosition.latitude]).addTo(map);
            source?.setData({
              type: "Feature",
              properties: { semantics: "direct-estimate" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [currentPosition.longitude, currentPosition.latitude],
                  [destination.longitude, destination.latitude],
                ],
              },
            });
            if (Math.abs(currentPosition.latitude - destination.latitude) < .00001
              && Math.abs(currentPosition.longitude - destination.longitude) < .00001) {
              map.jumpTo({ center: [destination.longitude, destination.latitude], zoom: 17 });
            } else {
              const bounds = new mapLibrary.LngLatBounds(
                [destination.longitude, destination.latitude],
                [destination.longitude, destination.latitude],
              ).extend([currentPosition.longitude, currentPosition.latitude]);
              map.fitBounds(bounds, { duration: 0, maxZoom: 16, padding: 64 });
            }
          };
          updateContextRef.current = renderContext;
          renderContext();
          map.once("idle", () => { if (!disposed) setState("ready"); });
        });
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") setState("failed");
      }
    };
    void start();
    return () => {
      disposed = true;
      controller.abort();
      updateContextRef.current = null;
      currentMarkerRef.current?.remove();
      currentMarkerRef.current = null;
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [copy.destinationMap, destination]);

  useEffect(() => {
    currentRef.current = current;
    updateContextRef.current?.();
  }, [current]);

  if (!destination || !links) {
    return <p className={styles.warning} role="alert">{copy.navigationUnavailable}</p>;
  }

  return <section className={styles.shell} aria-labelledby={titleId}>
    <div className={styles.heading}><h3 id={titleId}>{copy.destination}</h3><p>{address}</p></div>
    <div className={styles.mapFrame} hidden={state !== "loading" && state !== "ready"} aria-busy={state === "loading"}>
      <div ref={hostRef} className={styles.map} role="group" aria-label={copy.destinationMap} />
      {state === "loading" ? <p className={styles.overlay} aria-live="polite">{copy.mapLoading}</p> : null}
    </div>
    {state === "outside" ? <p className={styles.warning} role="status">{copy.mapOutsideCoverage}</p> : null}
    {currentOutsideCoverage ? <p className={styles.warning} role="status">{copy.mapCurrentOutsideCoverage}</p> : null}
    {state === "unavailable" || state === "failed" ? <p className={styles.warning} role="status">{copy.mapUnavailable}</p> : null}
    {current ? <div className={styles.liveSummary} role="status">
      <span className={styles.legend}><i data-marker="agent" aria-hidden="true" />{copy.currentLocation}</span>
      <span className={styles.legend}><i data-marker="destination" aria-hidden="true" />{copy.destinationMarker}</span>
      <strong>{copy.directEstimate}: {formatDistance(remainingMeters, locale)}</strong>
      <span>{copy.etaEstimate}: {formatEta(etaSeconds, locale)}</span>
      {trackingStatus ? <span>{trackingStatus}</span> : null}
    </div> : null}
    {showNavigationLinks ? <div className={styles.actions} aria-label={copy.destination}>
      <a href={links.waze} target="_blank" rel="noopener noreferrer">{copy.navigateWaze}</a>
      <a href={links.googleMaps} target="_blank" rel="noopener noreferrer">{copy.navigateGoogleMaps}</a>
    </div> : null}
  </section>;
}

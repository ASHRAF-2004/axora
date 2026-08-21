"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import {
  buildDeliveryNavigationLinks,
  deliveryCoordinatesSchema,
} from "@/lib/delivery-navigation";
import {
  deliveryWorkflowMessages,
  type DeliveryWorkflowLocale,
} from "@/lib/delivery-workflow-i18n";
import {
  escapeOperationalMapHtml,
  OPERATIONAL_MAP_CONFIG_URL,
  operationalMapContainsCoordinate,
  operationalStyleAssessment,
  parseOperationalMapRuntimeConfig,
} from "@/lib/operational-map";
import styles from "./DeliveryDestinationMap.module.css";

type State = "loading" | "ready" | "unavailable" | "outside" | "failed";

export function DeliveryDestinationMap({
  address,
  latitude,
  locale = "en",
  longitude,
}: {
  address: string;
  latitude: number;
  locale?: DeliveryWorkflowLocale;
  longitude: number;
}) {
  const copy = deliveryWorkflowMessages(locale);
  const titleId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const coordinates = useMemo(() => {
    const parsedCoordinates = deliveryCoordinatesSchema.safeParse({ latitude, longitude });
    return parsedCoordinates.success ? parsedCoordinates.data : null;
  }, [latitude, longitude]);
  const links = coordinates ? buildDeliveryNavigationLinks(coordinates) : null;
  const [state, setState] = useState<State>(coordinates ? "loading" : "unavailable");

  useEffect(() => {
    if (!coordinates) return;
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
        if (!configResponse.ok) {
          setState("unavailable");
          return;
        }
        const parsedConfig = parseOperationalMapRuntimeConfig(await configResponse.json());
        if (parsedConfig.state !== "configured") {
          setState("unavailable");
          return;
        }
        if (!operationalMapContainsCoordinate(parsedConfig.config.coverage, coordinates)) {
          setState("outside");
          return;
        }
        const styleResponse = await fetch(parsedConfig.config.styleUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!styleResponse.ok) {
          setState("failed");
          return;
        }
        const style = await styleResponse.json() as unknown;
        if (!operationalStyleAssessment(style, window.location.origin).usable) {
          setState("failed");
          return;
        }
        const { default: mapLibrary } = await import("maplibre-gl");
        if (disposed || !hostRef.current) return;
        const map = new mapLibrary.Map({
          attributionControl: false,
          center: [coordinates.longitude, coordinates.latitude],
          container: hostRef.current,
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
        map.on("error", () => {
          if (!disposed) setState("failed");
        });
        map.once("load", () => {
          if (disposed) return;
          map.getCanvas().setAttribute("aria-label", copy.destinationMap);
          const markerElement = document.createElement("div");
          markerElement.className = styles.marker;
          markerElement.setAttribute("aria-hidden", "true");
          markerRef.current = new mapLibrary.Marker({
            anchor: "center",
            element: markerElement,
          }).setLngLat([coordinates.longitude, coordinates.latitude]).addTo(map);
          map.once("idle", () => {
            if (!disposed) setState("ready");
          });
        });
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") setState("failed");
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
  }, [coordinates, copy.destinationMap]);

  if (!coordinates || !links) {
    return <p className={styles.warning} role="alert">{copy.navigationUnavailable}</p>;
  }

  return <section className={styles.shell} aria-labelledby={titleId}>
    <div className={styles.heading}>
      <h3 id={titleId}>{copy.destination}</h3>
      <p>{address}</p>
    </div>
    <div className={styles.mapFrame} hidden={state !== "loading" && state !== "ready"} aria-busy={state === "loading"}>
      <div ref={hostRef} className={styles.map} role="group" aria-label={copy.destinationMap} />
      {state === "loading" ? <p className={styles.overlay} aria-live="polite">{copy.mapLoading}</p> : null}
    </div>
    {state === "outside" ? <p className={styles.warning} role="status">{copy.mapOutsideCoverage}</p> : null}
    {state === "unavailable" || state === "failed" ? <p className={styles.warning} role="status">{copy.mapUnavailable}</p> : null}
    <div className={styles.actions} aria-label={copy.destination}>
      <a href={links.waze} target="_blank" rel="noopener noreferrer">{copy.navigateWaze}</a>
      <a href={links.googleMaps} target="_blank" rel="noopener noreferrer">{copy.navigateGoogleMaps}</a>
    </div>
  </section>;
}

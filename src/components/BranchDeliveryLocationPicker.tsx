"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import styles from "@/components/BranchDeliveryLocationPicker.module.css";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import {
  deliveryCoordinatesSchema,
  type DeliveryCoordinates,
} from "@/lib/delivery-navigation";
import type { SupportedLocale } from "@/lib/i18n";
import {
  escapeOperationalMapHtml,
  OPERATIONAL_MAP_CONFIG_URL,
  operationalMapContainsCoordinate,
  operationalMapCoverageCenter,
  operationalStyleAssessment,
  parseOperationalMapRuntimeConfig,
  type OperationalMapRuntimeConfig,
} from "@/lib/operational-map";

type MarkerConstructor = typeof import("maplibre-gl")["Marker"];
type ConfigState = "checking" | "configured" | "unconfigured" | "failed";
type MapState = "idle" | "loading" | "ready" | "failed";
type CoordinateField = "latitude" | "longitude";
const DECIMAL_COORDINATE_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

export type BranchDeliveryLocationPickerProps = {
  disabled?: boolean;
  initialCoordinates?: DeliveryCoordinates | null;
  locale?: SupportedLocale;
  onConfirm: (coordinates: DeliveryCoordinates) => void;
  onDraftChange?: (coordinates: DeliveryCoordinates | null) => void;
};

function formattedCoordinate(value: number) {
  return value.toFixed(6);
}

function parsedCoordinateText(latitude: string, longitude: string) {
  if (!DECIMAL_COORDINATE_PATTERN.test(latitude.trim())
    || !DECIMAL_COORDINATE_PATTERN.test(longitude.trim())) return null;
  const parsed = deliveryCoordinatesSchema.safeParse({
    latitude: Number(latitude),
    longitude: Number(longitude),
  });
  return parsed.success ? Object.freeze(parsed.data) : null;
}

function fieldIsValid(field: CoordinateField, value: string) {
  if (!DECIMAL_COORDINATE_PATTERN.test(value.trim())) return false;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate)) return false;
  return field === "latitude"
    ? coordinate >= -90 && coordinate <= 90
    : coordinate >= -180 && coordinate <= 180;
}

function sameCoordinates(left: DeliveryCoordinates | null, right: DeliveryCoordinates | null) {
  return Boolean(left && right
    && left.latitude === right.latitude
    && left.longitude === right.longitude);
}

function safeInitialCoordinates(value: unknown) {
  if (value === null || value === undefined) return { coordinates: null, invalid: false } as const;
  const parsed = deliveryCoordinatesSchema.safeParse(value);
  return parsed.success
    ? { coordinates: Object.freeze(parsed.data), invalid: false } as const
    : { coordinates: null, invalid: true } as const;
}

export function BranchDeliveryLocationPicker({
  disabled = false,
  initialCoordinates = null,
  locale = "en",
  onConfirm,
  onDraftChange,
}: BranchDeliveryLocationPickerProps) {
  const copy = branchDeliveryLocationMessages(locale);
  const initial = safeInitialCoordinates(initialCoordinates);
  const baseId = useId();
  const latitudeId = `${baseId}-latitude`;
  const longitudeId = `${baseId}-longitude`;
  const helpId = `${baseId}-help`;
  const latitudeErrorId = `${baseId}-latitude-error`;
  const longitudeErrorId = `${baseId}-longitude-error`;
  const mapHelpId = `${baseId}-map-help`;
  const latitudeRef = useRef<HTMLInputElement>(null);
  const longitudeRef = useRef<HTMLInputElement>(null);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const markerConstructorRef = useRef<MarkerConstructor | null>(null);
  const disabledRef = useRef(disabled);
  const candidateRef = useRef<DeliveryCoordinates | null>(initial.coordinates);
  const [latitude, setLatitude] = useState(initial.coordinates ? formattedCoordinate(initial.coordinates.latitude) : "");
  const [longitude, setLongitude] = useState(initial.coordinates ? formattedCoordinate(initial.coordinates.longitude) : "");
  const [candidate, setCandidate] = useState<DeliveryCoordinates | null>(initial.coordinates);
  const [confirmed, setConfirmed] = useState<DeliveryCoordinates | null>(initial.coordinates);
  const [invalidInitial, setInvalidInitial] = useState(initial.invalid);
  const [touched, setTouched] = useState<Record<CoordinateField, boolean>>({ latitude: false, longitude: false });
  const [runtimeConfig, setRuntimeConfig] = useState<OperationalMapRuntimeConfig | null>(null);
  const [configState, setConfigState] = useState<ConfigState>("checking");
  const [mapState, setMapState] = useState<MapState>("idle");

  useEffect(() => {
    disabledRef.current = disabled;
    markerRef.current?.setDraggable(!disabled);
  }, [disabled]);

  useEffect(() => {
    candidateRef.current = candidate;
  }, [candidate]);

  const applyMapCoordinate = useCallback((coordinates: DeliveryCoordinates) => {
    setLatitude(formattedCoordinate(coordinates.latitude));
    setLongitude(formattedCoordinate(coordinates.longitude));
    setCandidate(coordinates);
    setInvalidInitial(false);
    setTouched({ latitude: true, longitude: true });
    onDraftChange?.(coordinates);
  }, [onDraftChange, setCandidate, setInvalidInitial, setLatitude, setLongitude, setTouched]);

  const ensureMarker = useCallback((coordinates: DeliveryCoordinates) => {
    const map = mapRef.current;
    const Marker = markerConstructorRef.current;
    if (!map || !Marker || !map.isStyleLoaded()) return;
    if (!markerRef.current) {
      const markerElement = document.createElement("div");
      markerElement.className = styles.marker;
      markerElement.setAttribute("aria-hidden", "true");
      const marker = new Marker({
        anchor: "center",
        draggable: !disabledRef.current,
        element: markerElement,
      }).setLngLat([coordinates.longitude, coordinates.latitude]).addTo(map);
      marker.on("dragend", () => {
        if (disabledRef.current) return;
        const position = marker.getLngLat();
        const parsed = deliveryCoordinatesSchema.safeParse({
          latitude: position.lat,
          longitude: position.lng,
        });
        if (parsed.success) applyMapCoordinate(Object.freeze(parsed.data));
      });
      markerRef.current = marker;
      return;
    }
    markerRef.current.setLngLat([coordinates.longitude, coordinates.latitude]);
  }, [applyMapCoordinate]);

  useEffect(() => {
    const controller = new AbortController();
    const loadConfig = async () => {
      try {
        const response = await fetch(OPERATIONAL_MAP_CONFIG_URL, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          setConfigState(response.status === 404 ? "unconfigured" : "failed");
          return;
        }
        const parsed = parseOperationalMapRuntimeConfig(await response.json());
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
    if (configState !== "configured" || !runtimeConfig) return;
    let disposed = false;
    const controller = new AbortController();
    const start = async () => {
      try {
        setMapState("loading");
        const styleResponse = await fetch(runtimeConfig.styleUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!styleResponse.ok) {
          setMapState("failed");
          return;
        }
        const style = await styleResponse.json() as unknown;
        if (!operationalStyleAssessment(style, window.location.origin).usable) {
          setMapState("failed");
          return;
        }
        const { default: mapLibrary } = await import("maplibre-gl");
        if (disposed || !mapHostRef.current) return;
        markerConstructorRef.current = mapLibrary.Marker;
        const selected = candidateRef.current;
        const selectedInCoverage = selected
          ? operationalMapContainsCoordinate(runtimeConfig.coverage, selected)
          : false;
        const map = new mapLibrary.Map({
          attributionControl: false,
          center: selected && selectedInCoverage
            ? [selected.longitude, selected.latitude]
            : operationalMapCoverageCenter(runtimeConfig.coverage),
          container: mapHostRef.current,
          maxBounds: [
            [runtimeConfig.coverage.bounds[0], runtimeConfig.coverage.bounds[1]],
            [runtimeConfig.coverage.bounds[2], runtimeConfig.coverage.bounds[3]],
          ],
          style: style as StyleSpecification,
          zoom: selectedInCoverage ? 15 : 10,
        });
        mapRef.current = map;
        map.addControl(new mapLibrary.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new mapLibrary.AttributionControl({
          compact: true,
          customAttribution: `<a href="${escapeOperationalMapHtml(runtimeConfig.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeOperationalMapHtml(runtimeConfig.attribution.label)}</a>`,
        }));
        map.on("click", (event) => {
          if (disabledRef.current) return;
          const parsed = deliveryCoordinatesSchema.safeParse({
            latitude: event.lngLat.lat,
            longitude: event.lngLat.lng,
          });
          if (parsed.success) applyMapCoordinate(Object.freeze(parsed.data));
        });
        map.on("error", () => {
          if (!disposed) setMapState("failed");
        });
        map.once("load", () => {
          if (disposed) return;
          map.getCanvas().setAttribute("aria-label", copy.mapLabel);
          const current = candidateRef.current;
          if (current && operationalMapContainsCoordinate(runtimeConfig.coverage, current)) {
            ensureMarker(current);
          }
          map.once("idle", () => {
            if (!disposed) setMapState("ready");
          });
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
      markerConstructorRef.current = null;
    };
  }, [applyMapCoordinate, configState, copy.mapLabel, ensureMarker, runtimeConfig]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !runtimeConfig || mapState !== "ready") return;
    if (!candidate || !operationalMapContainsCoordinate(runtimeConfig.coverage, candidate)) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    ensureMarker(candidate);
    map.easeTo({ center: [candidate.longitude, candidate.latitude], duration: 0 });
  }, [candidate, ensureMarker, mapState, runtimeConfig]);

  const updateText = (field: CoordinateField, value: string) => {
    const nextLatitude = field === "latitude" ? value : latitude;
    const nextLongitude = field === "longitude" ? value : longitude;
    if (field === "latitude") setLatitude(value);
    else setLongitude(value);
    const parsed = parsedCoordinateText(nextLatitude, nextLongitude);
    setCandidate(parsed);
    setInvalidInitial(false);
    onDraftChange?.(parsed);
  };

  const latitudeInvalid = touched.latitude && !fieldIsValid("latitude", latitude);
  const longitudeInvalid = touched.longitude && !fieldIsValid("longitude", longitude);
  const candidateOutsideCoverage = Boolean(candidate && runtimeConfig
    && !operationalMapContainsCoordinate(runtimeConfig.coverage, candidate));
  const isConfirmed = sameCoordinates(candidate, confirmed);

  const confirmCoordinates = () => {
    setTouched({ latitude: true, longitude: true });
    const parsed = parsedCoordinateText(latitude, longitude);
    if (!parsed) {
      if (!fieldIsValid("latitude", latitude)) latitudeRef.current?.focus();
      else longitudeRef.current?.focus();
      return;
    }
    onConfirm(parsed);
    setCandidate(parsed);
    setConfirmed(parsed);
    setInvalidInitial(false);
  };

  const mapAvailable = configState === "configured" && mapState !== "failed";
  const status = isConfirmed
    ? copy.confirmed
    : candidate
      ? copy.draftReady
      : copy.noSelection;

  return <section className={styles.shell} dir={locale === "ar" ? "rtl" : "ltr"} aria-labelledby={`${baseId}-title`}>
    <header className={styles.header}>
      <div>
        <h2 id={`${baseId}-title`}>{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
    </header>

    <div className={styles.mapFrame} hidden={!mapAvailable} aria-busy={mapState === "loading"}>
      <div
        ref={mapHostRef}
        className={styles.map}
        role="group"
        aria-label={copy.mapLabel}
        aria-describedby={mapHelpId}
        aria-disabled={disabled}
      />
      {mapState === "loading" ? <p className={styles.mapOverlay} aria-live="polite">{copy.loadingMap}</p> : null}
    </div>
    <p id={mapHelpId} className={styles.help}>{copy.mapHelp}</p>
    {configState === "checking"
      ? <p className={styles.help} aria-live="polite">{copy.loadingMap}</p>
      : null}
    {configState === "unconfigured" || configState === "failed" || mapState === "failed"
      ? <p className={styles.warning} role="status">{copy.mapUnavailable}</p>
      : null}
    {candidateOutsideCoverage
      ? <p className={styles.warning} role="status">{copy.outsideCoverage}</p>
      : null}
    {invalidInitial ? <p className={styles.error} role="alert">{copy.invalidSaved}</p> : null}

    <div className={styles.fields} aria-describedby={helpId}>
      <label className={styles.field} htmlFor={latitudeId}>
        <span>{copy.latitude}</span>
        <input
          ref={latitudeRef}
          id={latitudeId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={latitude}
          disabled={disabled}
          aria-invalid={latitudeInvalid}
          aria-describedby={`${helpId}${latitudeInvalid ? ` ${latitudeErrorId}` : ""}`}
          onBlur={() => setTouched((current) => ({ ...current, latitude: true }))}
          onChange={(event) => updateText("latitude", event.target.value)}
        />
        {latitudeInvalid ? <span className={styles.fieldError} id={latitudeErrorId}>{copy.latitudeError}</span> : null}
      </label>
      <label className={styles.field} htmlFor={longitudeId}>
        <span>{copy.longitude}</span>
        <input
          ref={longitudeRef}
          id={longitudeId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={longitude}
          disabled={disabled}
          aria-invalid={longitudeInvalid}
          aria-describedby={`${helpId}${longitudeInvalid ? ` ${longitudeErrorId}` : ""}`}
          onBlur={() => setTouched((current) => ({ ...current, longitude: true }))}
          onChange={(event) => updateText("longitude", event.target.value)}
        />
        {longitudeInvalid ? <span className={styles.fieldError} id={longitudeErrorId}>{copy.longitudeError}</span> : null}
      </label>
    </div>
    <p id={helpId} className={styles.help}>{copy.coordinateHelp}</p>

    <div className={styles.actions}>
      <button type="button" disabled={disabled} onClick={confirmCoordinates}>
        {copy.confirm}
      </button>
      <p className={isConfirmed ? styles.success : styles.status} aria-live="polite">{status}</p>
    </div>

    {runtimeConfig && configState === "configured" ? <p className={styles.attribution}>
      {copy.mapAttribution}: <a href={runtimeConfig.attribution.url} target="_blank" rel="noopener noreferrer">{runtimeConfig.attribution.label}</a>
    </p> : null}
  </section>;
}

export const branchDeliveryLocationPickerInternals = {
  fieldIsValid,
  formattedCoordinate,
  parsedCoordinateText,
  sameCoordinates,
};

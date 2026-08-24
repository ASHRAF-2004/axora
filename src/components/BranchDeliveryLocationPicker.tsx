"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker, StyleSpecification } from "maplibre-gl";

import styles from "@/components/BranchDeliveryLocationPicker.module.css";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import { deliveryCoordinatesSchema, type DeliveryCoordinates } from "@/lib/delivery-navigation";
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
type MapState = "checking" | "loading" | "ready" | "failed";

export type DeliveryLocationSelection = DeliveryCoordinates & {
  addressLabel: string;
  providerId: string;
  providerPlaceId?: string;
  providerAttribution?: string;
};

type SearchResult = DeliveryLocationSelection & { name: string };

export type BranchDeliveryLocationPickerProps = {
  disabled?: boolean;
  initialSelection?: DeliveryLocationSelection | null;
  locale?: SupportedLocale;
  onConfirm: (selection: DeliveryLocationSelection) => void;
  onDraftChange?: (selection: DeliveryLocationSelection | null) => void;
};

function sameSelection(left: DeliveryLocationSelection | null, right: DeliveryLocationSelection | null) {
  return Boolean(left && right
    && left.latitude === right.latitude
    && left.longitude === right.longitude
    && left.addressLabel === right.addressLabel);
}

function formattedCoordinate(value: number) { return value.toFixed(6); }
function parsedCoordinateText(latitude: string, longitude: string) {
  const decimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (!decimal.test(latitude.trim()) || !decimal.test(longitude.trim())) return null;
  const parsed = deliveryCoordinatesSchema.safeParse({ latitude: Number(latitude), longitude: Number(longitude) });
  return parsed.success && latitude.trim() !== "" && longitude.trim() !== "" ? parsed.data : null;
}
function fieldIsValid(field: "latitude" | "longitude", value: string) {
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) || !Number.isFinite(Number(value))) return false;
  const number = Number(value);
  return field === "latitude" ? number >= -90 && number <= 90 : number >= -180 && number <= 180;
}
function sameCoordinates(left: DeliveryCoordinates | null, right: DeliveryCoordinates | null) {
  return Boolean(left && right && left.latitude === right.latitude && left.longitude === right.longitude);
}

export function BranchDeliveryLocationPicker({ disabled = false, initialSelection = null, locale = "en", onConfirm, onDraftChange }: BranchDeliveryLocationPickerProps) {
  const copy = branchDeliveryLocationMessages(locale);
  const baseId = useId();
  const inputId = `${baseId}-search`;
  const listId = `${baseId}-results`;
  const statusId = `${baseId}-status`;
  const mapHelpId = `${baseId}-map-help`;
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const markerConstructorRef = useRef<MarkerConstructor | null>(null);
  const disabledRef = useRef(disabled);
  const onConfirmRef = useRef(onConfirm);
  const onDraftChangeRef = useRef(onDraftChange);
  const requestSequenceRef = useRef(0);
  const draftRef = useRef<DeliveryLocationSelection | null>(initialSelection);
  const queryRef = useRef(initialSelection?.addressLabel ?? "");
  const [runtimeConfig, setRuntimeConfig] = useState<OperationalMapRuntimeConfig | null>(null);
  const [mapState, setMapState] = useState<MapState>("checking");
  const [query, setQuery] = useState(initialSelection?.addressLabel ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState<DeliveryLocationSelection | null>(initialSelection);
  const [confirmed, setConfirmed] = useState<DeliveryLocationSelection | null>(initialSelection);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");

  useEffect(() => {
    disabledRef.current = disabled;
    markerRef.current?.setDraggable(!disabled);
  }, [disabled]);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
    onDraftChangeRef.current = onDraftChange;
  }, [onConfirm, onDraftChange]);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  const setDraftSelection = useCallback((selection: DeliveryLocationSelection) => {
    setDraft(selection);
    queryRef.current = selection.addressLabel;
    setQuery(selection.addressLabel);
    setResults([]);
    setActiveIndex(-1);
    onDraftChangeRef.current?.(selection);
  }, []);

  const reverseGeocode = useCallback(async (coordinates: DeliveryCoordinates) => {
    const sequence = ++requestSequenceRef.current;
    setLocationMessage(copy.reverseSearching);
    try {
      const params = new URLSearchParams({ latitude: String(coordinates.latitude), longitude: String(coordinates.longitude), locale });
      const response = await fetch(`/api/geocoding/reverse?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("reverse-geocoder-unavailable");
      const payload = await response.json() as { result?: SearchResult };
      if (sequence !== requestSequenceRef.current) return;
      setDraftSelection(payload.result ?? {
        ...coordinates,
        addressLabel: queryRef.current.trim() || draftRef.current?.addressLabel || copy.manualPendingAddress,
        providerId: "manual-map",
      });
      setLocationMessage(payload.result ? "" : copy.reverseUnavailable);
    } catch {
      if (sequence !== requestSequenceRef.current) return;
      setDraftSelection({
        ...coordinates,
        addressLabel: queryRef.current.trim() || draftRef.current?.addressLabel || copy.manualPendingAddress,
        providerId: "manual-map",
      });
      setLocationMessage(copy.reverseUnavailable);
    }
  }, [copy.manualPendingAddress, copy.reverseSearching, copy.reverseUnavailable, locale, setDraftSelection]);

  const applyCoordinates = useCallback((coordinates: DeliveryCoordinates) => {
    setConfirmed(null);
    void reverseGeocode(coordinates);
  }, [reverseGeocode]);

  const ensureMarker = useCallback((selection: DeliveryCoordinates) => {
    const map = mapRef.current;
    const Marker = markerConstructorRef.current;
    if (!map || !Marker) return;
    if (!markerRef.current) {
      const element = document.createElement("div");
      element.className = styles.marker;
      element.setAttribute("aria-hidden", "true");
      const marker = new Marker({ anchor: "center", draggable: !disabledRef.current, element })
        .setLngLat([selection.longitude, selection.latitude]).addTo(map);
      marker.on("dragend", () => {
        if (disabledRef.current) return;
        const point = marker.getLngLat();
        const parsed = deliveryCoordinatesSchema.safeParse({ latitude: point.lat, longitude: point.lng });
        if (parsed.success) applyCoordinates(parsed.data);
      });
      markerRef.current = marker;
    } else markerRef.current.setLngLat([selection.longitude, selection.latitude]);
  }, [applyCoordinates]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(OPERATIONAL_MAP_CONFIG_URL, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw new Error("map-config-unavailable");
        const parsed = parseOperationalMapRuntimeConfig(await response.json());
        if (parsed.state !== "configured") throw new Error("map-not-configured");
        setRuntimeConfig(parsed.config);
        setMapState("loading");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMapState("failed");
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!runtimeConfig || mapRef.current) return;
    let disposed = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const styleResponse = await fetch(runtimeConfig.styleUrl, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        const style = await styleResponse.json() as unknown;
        if (!styleResponse.ok || !operationalStyleAssessment(style, window.location.origin).usable) throw new Error("map-style-unavailable");
        const { default: mapLibrary } = await import("maplibre-gl");
        if (disposed || !mapHostRef.current) return;
        markerConstructorRef.current = mapLibrary.Marker;
        const selected = draftRef.current;
        const inCoverage = Boolean(selected && operationalMapContainsCoordinate(runtimeConfig.coverage, selected));
        const map = new mapLibrary.Map({
          attributionControl: false,
          center: selected && inCoverage ? [selected.longitude, selected.latitude] : operationalMapCoverageCenter(runtimeConfig.coverage),
          container: mapHostRef.current,
          maxBounds: [[runtimeConfig.coverage.bounds[0], runtimeConfig.coverage.bounds[1]], [runtimeConfig.coverage.bounds[2], runtimeConfig.coverage.bounds[3]]],
          style: style as StyleSpecification,
          zoom: inCoverage ? 16 : 10,
        });
        mapRef.current = map;
        map.addControl(new mapLibrary.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(new mapLibrary.AttributionControl({ compact: true, customAttribution: `<a href="${escapeOperationalMapHtml(runtimeConfig.attribution.url)}" target="_blank" rel="noopener noreferrer">${escapeOperationalMapHtml(runtimeConfig.attribution.label)}</a>` }));
        map.on("click", (event) => {
          if (!disabledRef.current) applyCoordinates({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });
        map.on("error", () => { if (!disposed) setMapState("failed"); });
        map.once("load", () => {
          if (disposed) return;
          map.getCanvas().setAttribute("aria-label", copy.mapLabel);
          if (selected && inCoverage) ensureMarker(selected);
          setMapState("ready");
        });
      } catch (error) {
        if (!disposed && (error as Error).name !== "AbortError") setMapState("failed");
      }
    })();
    return () => {
      disposed = true; controller.abort();
      markerRef.current?.remove(); markerRef.current = null;
      mapRef.current?.remove(); mapRef.current = null;
      markerConstructorRef.current = null;
    };
  }, [applyCoordinates, copy.mapLabel, ensureMarker, runtimeConfig]);

  useEffect(() => {
    if (!draft || !runtimeConfig || mapState !== "ready") return;
    if (!operationalMapContainsCoordinate(runtimeConfig.coverage, draft)) {
      markerRef.current?.remove(); markerRef.current = null;
      return;
    }
    ensureMarker(draft);
    mapRef.current?.easeTo({ center: [draft.longitude, draft.latitude], zoom: 16, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350 });
  }, [copy.outsideCoverage, draft, ensureMarker, mapState, runtimeConfig]);

  useEffect(() => {
    const trimmed = query.trim();
    if (manual || trimmed.length < 2 || trimmed === draft?.addressLabel) {
      return;
    }
    const controller = new AbortController();
    const sequence = ++requestSequenceRef.current;
    const timer = window.setTimeout(() => {
      setSearching(true); setSearchMessage(copy.searching);
      const params = new URLSearchParams({ q: trimmed, locale });
      void fetch(`/api/geocoding/autocomplete?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("geocoder-unavailable");
          return response.json() as Promise<{ results?: SearchResult[] }>;
        })
        .then((payload) => {
          if (sequence !== requestSequenceRef.current) return;
          const next = payload.results ?? [];
          setResults(next); setActiveIndex(next.length ? 0 : -1);
          setSearchMessage(next.length ? copy.resultsAvailable(next.length) : copy.noResults);
        })
        .catch((error: Error) => {
          if (error.name === "AbortError" || sequence !== requestSequenceRef.current) return;
          setResults([]); setSearchMessage(copy.geocoderUnavailable);
        })
        .finally(() => { if (sequence === requestSequenceRef.current) setSearching(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [copy, draft?.addressLabel, locale, manual, query]);

  const selectResult = (result: SearchResult) => {
    setConfirmed(null); setDraftSelection(result); setSearchMessage(copy.locationDraft);
  };

  const useCurrentLocation = () => {
    setLocationMessage("");
    if (!("geolocation" in navigator)) { setLocationMessage(copy.geolocationUnavailable); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocating(false); applyCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude }); },
      (error) => {
        setLocating(false);
        setLocationMessage(error.code === error.PERMISSION_DENIED ? copy.geolocationDenied : error.code === error.TIMEOUT ? copy.geolocationTimeout : copy.geolocationUnavailable);
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 12_000 },
    );
  };

  const confirmedReady = sameSelection(draft, confirmed);
  const draftInCoverage = Boolean(draft && runtimeConfig
    && operationalMapContainsCoordinate(runtimeConfig.coverage, draft));
  return <section className={styles.shell} dir={locale === "ar" ? "rtl" : "ltr"} aria-labelledby={`${baseId}-title`}>
    <header className={styles.header}><h2 id={`${baseId}-title`}>{copy.title}</h2><p>{copy.description}</p></header>
    <div className={styles.searchGroup}>
      <label className={styles.field} htmlFor={inputId}>{copy.searchLabel}</label>
      <div className={styles.searchControl}>
        <span aria-hidden="true">⌕</span>
        <input id={inputId} role="combobox" aria-autocomplete="list" aria-controls={listId} aria-expanded={results.length > 0}
          aria-activedescendant={activeIndex >= 0 ? `${baseId}-result-${activeIndex}` : undefined} aria-describedby={statusId}
          autoComplete="off" disabled={disabled} placeholder={copy.searchPlaceholder} value={query}
          onChange={(event) => { queryRef.current = event.target.value; setManual(false); setQuery(event.target.value); setConfirmed(null); setResults([]); setSearching(false); setSearchMessage(""); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
            else if (event.key === "ArrowUp" && results.length) { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
            else if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); selectResult(results[activeIndex]); }
            else if (event.key === "Escape") { setResults([]); setActiveIndex(-1); }
          }} />
        {query ? <button type="button" className={styles.iconButton} disabled={disabled} aria-label={copy.clearSearch}
          onClick={() => { queryRef.current = ""; setQuery(""); setResults([]); setDraft(null); setConfirmed(null); onDraftChangeRef.current?.(null); }}>×</button> : null}
      </div>
      <p id={statusId} className={styles.srStatus} aria-live="polite">{searching ? copy.searching : searchMessage}</p>
      {results.length ? <ul id={listId} className={styles.results} role="listbox" aria-label={copy.suggestionsLabel}>
        {results.map((result, index) => <li key={`${result.providerId}-${result.providerPlaceId ?? index}`} id={`${baseId}-result-${index}`} role="option" aria-selected={index === activeIndex}>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectResult(result)}>
            <span aria-hidden="true">📍</span><span><strong>{result.name}</strong><small>{result.addressLabel}</small></span>
          </button>
        </li>)}
      </ul> : null}
      {!searching && searchMessage ? <p className={searchMessage === copy.geocoderUnavailable ? styles.warning : styles.help}>{searchMessage}</p> : null}
    </div>
    <div className={styles.secondaryActions}>
      <button type="button" className="button button-secondary" disabled={disabled || locating} onClick={useCurrentLocation}>{locating ? copy.locating : copy.useCurrentLocation}</button>
      <button type="button" className="button button-secondary" disabled={disabled} onClick={() => { setManual(true); setResults([]); setSearching(false); setSearchMessage(""); }}>{copy.manualToggle}</button>
    </div>
    {manual ? <label className={styles.manualField}><span>{copy.manualLabel}</span>
      <textarea value={query} minLength={3} maxLength={5_000} disabled={disabled}
        onChange={(event) => {
          const addressLabel = event.target.value; queryRef.current = addressLabel; setQuery(addressLabel); setConfirmed(null);
          if (draft) setDraftSelection({ ...draft, addressLabel, providerId: "manual-map" });
        }} />
      <small>{copy.manualHelp}</small></label> : null}
    {locationMessage ? <p className={styles.warning} role="status">{locationMessage}</p> : null}
    {draft && runtimeConfig && !operationalMapContainsCoordinate(runtimeConfig.coverage, draft)
      ? <p className={styles.warning} role="status">{copy.outsideCoverage}</p> : null}
    <div className={styles.mapFrame} hidden={mapState === "failed"} aria-busy={mapState !== "ready"}>
      <div ref={mapHostRef} className={styles.map} role="group" aria-label={copy.mapLabel} aria-describedby={mapHelpId} aria-disabled={disabled} />
      {mapState !== "ready" ? <p className={styles.mapOverlay} aria-live="polite">{copy.loadingMap}</p> : null}
    </div>
    <p id={mapHelpId} className={styles.help}>{copy.mapHelp}</p>
    {mapState === "failed" ? <p className={styles.warning} role="status">{copy.mapUnavailable}</p> : null}
    {draft ? <div className={styles.selectedAddress}><strong>{copy.selectedAddress}</strong><p>{draft.addressLabel}</p></div> : <p className={styles.help}>{copy.noSelection}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={disabled || !draftInCoverage || !draft || draft.addressLabel.trim().length < 3} onClick={() => { if (draft && draftInCoverage) { setConfirmed(draft); onConfirmRef.current(draft); } }}>{copy.confirmLocation}</button>
      <p className={confirmedReady ? styles.success : styles.status} aria-live="polite">{confirmedReady ? copy.locationConfirmed : copy.locationDraft}</p>
    </div>
    <p className={styles.attribution}>{copy.mapAttribution}: OpenStreetMap contributors (ODbL)</p>
  </section>;
}

export const branchDeliveryLocationPickerInternals = {
  fieldIsValid, formattedCoordinate, parsedCoordinateText, sameCoordinates, sameSelection,
};

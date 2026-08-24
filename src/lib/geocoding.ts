import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { SupportedLocale } from "@/lib/i18n";
import { operationalMapContainsCoordinate } from "@/lib/operational-map";

export const GEOCODER_PROVIDER = Object.freeze({
  id: "axora-osm-klang-valley",
  name: "Axora self-hosted OpenStreetMap search",
  attributionLabel: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
});

const coverage = Object.freeze({
  bounds: [101.35, 2.7, 102, 3.45] as [number, number, number, number],
  label: "Klang Valley, Putrajaya and Cyberjaya pilot region",
});

const curatedSchema = z.object({
  places: z.array(z.object({
    id: z.string().min(3).max(120),
    name: z.string().min(2).max(300),
    formattedAddress: z.string().min(3).max(1_000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    kind: z.string().min(2).max(160),
  })),
});

const osmPlacesSchema = z.object({
  features: z.array(z.object({
    properties: z.object({
      name: z.string().min(1).max(300),
      class: z.string().min(1).max(80),
      osm_id: z.union([z.string(), z.number()]),
    }).passthrough(),
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
  })),
});

export type GeocodingPlace = {
  id: string;
  name: string;
  formattedAddress: string;
  context: string;
  latitude: number;
  longitude: number;
  kind: string;
  providerId: string;
  providerPlaceId: string;
  attribution: string;
};

let placesPromise: Promise<readonly GeocodingPlace[]> | undefined;

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("en").trim();
}

function localizedRegion(locale: SupportedLocale) {
  if (locale === "ar") return "وادي كلانغ، ماليزيا";
  if (locale === "ms") return "Lembah Klang, Malaysia";
  return "Klang Valley, Malaysia";
}

async function loadPlaces() {
  const mapsDirectory = path.join(process.cwd(), "public", "maps");
  const [curatedRaw, osmRaw] = await Promise.all([
    readFile(path.join(mapsDirectory, "axora-mvp-delivery-places.json"), "utf8"),
    readFile(path.join(mapsDirectory, "mvp-klang-valley-places.geojson"), "utf8"),
  ]);
  const curated = curatedSchema.parse(JSON.parse(curatedRaw));
  const osm = osmPlacesSchema.parse(JSON.parse(osmRaw));
  const curatedPlaces: GeocodingPlace[] = curated.places.map((place) => ({
    ...place,
    context: place.formattedAddress.replace(`${place.name}, `, ""),
    providerId: GEOCODER_PROVIDER.id,
    providerPlaceId: place.id,
    attribution: GEOCODER_PROVIDER.attributionLabel,
  }));
  const genericPlaces: GeocodingPlace[] = osm.features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;
    return {
      id: `osm-${feature.properties.class}-${feature.properties.osm_id}`,
      name: feature.properties.name,
      formattedAddress: `${feature.properties.name}, Klang Valley, Malaysia`,
      context: "Klang Valley, Malaysia",
      latitude,
      longitude,
      kind: feature.properties.class.replaceAll("_", " "),
      providerId: GEOCODER_PROVIDER.id,
      providerPlaceId: `osm-${feature.properties.class}-${feature.properties.osm_id}`,
      attribution: GEOCODER_PROVIDER.attributionLabel,
    };
  }).filter((place) => operationalMapContainsCoordinate(coverage, place));
  return Object.freeze([...curatedPlaces, ...genericPlaces]);
}

function allPlaces() {
  placesPromise ??= loadPlaces();
  return placesPromise;
}

export async function autocompletePlaces(
  input: string,
  locale: SupportedLocale,
  limit = 7,
) {
  const query = normalize(input);
  if (query.length < 2) return [];
  const places = await allPlaces();
  return places
    .map((place) => {
      const name = normalize(place.name);
      const address = normalize(place.formattedAddress);
      const score = name === query ? 0
        : name.startsWith(query) ? 1
          : name.includes(query) ? 2
            : address.includes(query) ? 3 : 99;
      return { place, score };
    })
    .filter((candidate) => candidate.score < 99)
    .sort((left, right) => left.score - right.score
      || left.place.name.localeCompare(right.place.name, locale))
    .slice(0, Math.min(Math.max(limit, 1), 10))
    .map(({ place }) => ({
      ...place,
      context: place.context === "Klang Valley, Malaysia"
        ? localizedRegion(locale)
        : place.context,
    }));
}

function distanceKilometres(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export async function reverseGeocodePlace(
  coordinate: { latitude: number; longitude: number },
  locale: SupportedLocale,
) {
  if (!operationalMapContainsCoordinate(coverage, coordinate)) return null;
  const places = await allPlaces();
  const nearest = places
    .map((place) => ({ place, distance: distanceKilometres(coordinate, place) }))
    .sort((left, right) => left.distance - right.distance)[0];
  if (!nearest || nearest.distance > 5) return null;
  if (nearest.distance < 0.12) return nearest.place;
  const near = locale === "ar" ? "بالقرب من" : locale === "ms" ? "Berhampiran" : "Near";
  return {
    ...nearest.place,
    id: `reverse-${coordinate.latitude.toFixed(6)}-${coordinate.longitude.toFixed(6)}`,
    formattedAddress: `${near} ${nearest.place.name}, ${localizedRegion(locale)}`,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
    kind: "Approximate map position",
    providerPlaceId: `reverse:${nearest.place.providerPlaceId}`,
  } satisfies GeocodingPlace;
}

export const geocodingInternals = { distanceKilometres, normalize };

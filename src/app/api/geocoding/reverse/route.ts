import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth";
import { GEOCODER_PROVIDER, reverseGeocodePlace } from "@/lib/geocoding";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

const querySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  locale: z.enum(SUPPORTED_LOCALES).default("en"),
});

export async function GET(request: Request) {
  await requireSession();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    latitude: url.searchParams.get("latitude"),
    longitude: url.searchParams.get("longitude"),
    locale: url.searchParams.get("locale") ?? "en",
  });
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_COORDINATES", result: null }, { status: 400 });
  }
  try {
    const place = await reverseGeocodePlace(parsed.data, parsed.data.locale);
    const result = place ? {
      name: place.name,
      addressLabel: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      providerId: place.providerId,
      providerPlaceId: place.providerPlaceId,
      providerAttribution: place.attribution,
    } : null;
    return NextResponse.json({ provider: GEOCODER_PROVIDER, result });
  } catch {
    return NextResponse.json({ code: "GEOCODER_UNAVAILABLE", result: null }, { status: 503 });
  }
}

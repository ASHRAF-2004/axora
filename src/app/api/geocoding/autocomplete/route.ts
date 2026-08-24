import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth";
import { autocompletePlaces, GEOCODER_PROVIDER } from "@/lib/geocoding";
import { SUPPORTED_LOCALES } from "@/lib/i18n";

const querySchema = z.object({
  q: z.string().trim().min(2).max(160),
  locale: z.enum(SUPPORTED_LOCALES).default("en"),
});

export async function GET(request: Request) {
  await requireSession();
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    locale: url.searchParams.get("locale") ?? "en",
  });
  if (!parsed.success) {
    return NextResponse.json({ code: "INVALID_SEARCH", results: [] }, { status: 400 });
  }
  try {
    const places = await autocompletePlaces(parsed.data.q, parsed.data.locale);
    const results = places.map((place) => ({
      name: place.name,
      addressLabel: place.formattedAddress,
      latitude: place.latitude,
      longitude: place.longitude,
      providerId: place.providerId,
      providerPlaceId: place.providerPlaceId,
      providerAttribution: place.attribution,
    }));
    return NextResponse.json({ provider: GEOCODER_PROVIDER, results });
  } catch {
    return NextResponse.json({ code: "GEOCODER_UNAVAILABLE", results: [] }, { status: 503 });
  }
}

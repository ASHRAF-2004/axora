import { z } from "zod";

export const deliveryCoordinatesSchema = z.strictObject({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export type DeliveryCoordinates = Readonly<z.infer<typeof deliveryCoordinatesSchema>>;

export type DeliveryNavigationLinks = Readonly<{
  googleMaps: string;
  waze: string;
}>;

export function validateDeliveryCoordinates(value: unknown): DeliveryCoordinates {
  return Object.freeze(deliveryCoordinatesSchema.parse(value));
}

function coordinatePair({ latitude, longitude }: DeliveryCoordinates) {
  return `${latitude},${longitude}`;
}

export function buildDeliveryNavigationLinks(value: unknown): DeliveryNavigationLinks {
  const coordinates = validateDeliveryCoordinates(value);
  const destination = coordinatePair(coordinates);

  const googleMaps = new URL("https://www.google.com/maps/dir/");
  googleMaps.searchParams.set("api", "1");
  googleMaps.searchParams.set("destination", destination);
  googleMaps.searchParams.set("travelmode", "driving");

  const waze = new URL("https://www.waze.com/ul");
  waze.searchParams.set("ll", destination);
  waze.searchParams.set("navigate", "yes");

  return Object.freeze({
    googleMaps: googleMaps.toString(),
    waze: waze.toString(),
  });
}

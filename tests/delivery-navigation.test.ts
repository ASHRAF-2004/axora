import { describe, expect, it } from "vitest";

import {
  buildDeliveryNavigationLinks,
  validateDeliveryCoordinates,
} from "@/lib/delivery-navigation";

describe("delivery navigation links", () => {
  it("builds official HTTPS coordinate navigation URLs", () => {
    const links = buildDeliveryNavigationLinks({
      latitude: 3.139,
      longitude: 101.6869,
    });

    const googleMaps = new URL(links.googleMaps);
    expect(googleMaps.protocol).toBe("https:");
    expect(googleMaps.hostname).toBe("www.google.com");
    expect(googleMaps.pathname).toBe("/maps/dir/");
    expect(googleMaps.searchParams.get("api")).toBe("1");
    expect(googleMaps.searchParams.get("destination")).toBe("3.139,101.6869");
    expect(googleMaps.searchParams.get("travelmode")).toBe("driving");

    const waze = new URL(links.waze);
    expect(waze.protocol).toBe("https:");
    expect(waze.hostname).toBe("www.waze.com");
    expect(waze.pathname).toBe("/ul");
    expect(waze.searchParams.get("ll")).toBe("3.139,101.6869");
    expect(waze.searchParams.get("navigate")).toBe("yes");
  });

  it("accepts exact coordinate boundaries without address interpolation", () => {
    expect(validateDeliveryCoordinates({ latitude: -90, longitude: -180 }))
      .toEqual({ latitude: -90, longitude: -180 });
    expect(validateDeliveryCoordinates({ latitude: 90, longitude: 180 }))
      .toEqual({ latitude: 90, longitude: 180 });

    const links = buildDeliveryNavigationLinks({ latitude: -0, longitude: 0 });
    expect(new URL(links.googleMaps).searchParams.get("destination")).toBe("0,0");
    expect(new URL(links.waze).searchParams.get("ll")).toBe("0,0");
  });

  it.each([
    { latitude: 90.000001, longitude: 0 },
    { latitude: -90.000001, longitude: 0 },
    { latitude: 0, longitude: 180.000001 },
    { latitude: 0, longitude: -180.000001 },
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
    { latitude: "3.139", longitude: 101.6869 },
    { latitude: 3.139, longitude: "101.6869<script>" },
    { latitude: 3.139 },
    null,
  ])("rejects impossible or non-numeric destination %#", (destination) => {
    expect(() => buildDeliveryNavigationLinks(destination)).toThrow();
  });
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { driverLiveMapInternals } from "@/components/role-portals/DriverLiveMap";

const operationalStyle = {
  version: 8,
  metadata: { "axora:map-purpose": "operational-street" },
  sources: {
    streets: {
      type: "raster",
      tiles: ["/maps/provider/tiles/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "Licensed fixture map data",
    },
  },
  layers: [
    { id: "background", type: "background" },
    { id: "street-context", type: "raster", source: "streets" },
  ],
} as const;

describe("driver operational map configuration", () => {
  it("rejects the Natural Earth overview as operational street context", async () => {
    const style = JSON.parse(await readFile(path.join(process.cwd(), "public/maps/axora-operational-style.json"), "utf8"));
    expect(driverLiveMapInternals.usableStyle(style)).toBe(true);
    expect(driverLiveMapInternals.operationalStyleAssessment(style)).toEqual({ usable: false, reason: "overview-only" });
  });

  it("accepts a same-origin local-context style and rejects remote source hotlinks", () => {
    expect(driverLiveMapInternals.operationalStyleAssessment(operationalStyle)).toEqual({ usable: true, reason: "operational-context" });
    expect(driverLiveMapInternals.operationalStyleAssessment({
      ...operationalStyle,
      sources: { streets: { ...operationalStyle.sources.streets, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"] } },
    })).toEqual({ usable: false, reason: "remote-or-unsafe-source" });
    expect(driverLiveMapInternals.operationalStyleAssessment({ version: 8, sources: {}, layers: [{ id: "background", type: "background" }] }))
      .toEqual({ usable: false, reason: "invalid-style" });
    expect(driverLiveMapInternals.operationalStyleAssessment({ ...operationalStyle, metadata: {} }))
      .toEqual({ usable: false, reason: "operational-purpose-missing" });
  });

  it("requires an explicit configured provider and declared HTTPS attribution", () => {
    expect(driverLiveMapInternals.parseRuntimeConfig({ version: 1, status: "unconfigured" })).toEqual({ state: "unconfigured" });
    const config = {
      version: 1,
      status: "configured",
      providerId: "reviewed-streets",
      providerName: "Reviewed streets",
      styleUrl: "/maps/provider/style.json",
      attribution: { label: "Licensed map data", url: "https://maps.example.test/licence" },
      coverage: { bounds: [101.35, 2.7, 102, 3.45], label: "Controlled pilot coverage" },
    };
    expect(driverLiveMapInternals.parseRuntimeConfig(config)).toEqual({ state: "configured", config });
    expect(driverLiveMapInternals.parseRuntimeConfig({ ...config, styleUrl: "https://tile.openstreetmap.org/style.json" })).toEqual({ state: "failed" });
    expect(driverLiveMapInternals.parseRuntimeConfig({ ...config, attribution: { label: "Map", url: "http://maps.example.test" } })).toEqual({ state: "failed" });
  });

  it("creates an ordered route and a valid line for a single location", () => {
    const points = [
      { latitude: 3.139, longitude: 101.6869, accuracy: 8, capturedAt: "2026-08-15T00:00:00Z" },
      { latitude: 3.1412, longitude: 101.69, accuracy: 7, capturedAt: "2026-08-15T00:01:00Z" },
    ];
    expect(driverLiveMapInternals.routeFeature(points).geometry.coordinates).toEqual([[101.6869, 3.139], [101.69, 3.1412]]);
    expect(driverLiveMapInternals.routeFeature(points.slice(0, 1)).geometry.coordinates).toEqual([[101.6869, 3.139], [101.6869, 3.139]]);
    expect(driverLiveMapInternals.coverageContainsPoints({ bounds: [101.35, 2.7, 102, 3.45], label: "MVP" }, points)).toBe(true);
    expect(driverLiveMapInternals.coverageContainsPoints({ bounds: [102.1, 2.7, 103, 3.45], label: "Elsewhere" }, points)).toBe(false);
  });
});

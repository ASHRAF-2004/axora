import { mkdtemp, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertOperationalStyle,
  buildDriverMapConfig,
  renderDriverMapConfig,
} from "../scripts/production/check-driver-map-config.mjs";

const environment = {
  AXORA_DRIVER_MAP_OPERATIONAL_READY: "true",
  NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID: "approved-local-map",
  NEXT_PUBLIC_AXORA_MAP_PROVIDER_NAME: "Approved local map",
  NEXT_PUBLIC_AXORA_MAP_STYLE_URL: "/maps/provider/style.json",
  NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION: "Licensed map data",
  NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL: "https://maps.example.test/licence",
  NEXT_PUBLIC_AXORA_MAP_COVERAGE_BOUNDS: "101.35,2.70,102.00,3.45",
  NEXT_PUBLIC_AXORA_MAP_COVERAGE_LABEL: "Controlled pilot coverage",
};

const style = {
  version: 8,
  metadata: { "axora:map-purpose": "operational-street", "axora:provider-id": "approved-local-map", "axora:coverage": [101.35, 2.7, 102, 3.45], "axora:coverage-label": "Controlled pilot coverage" },
  sources: { streets: { type: "raster", tiles: ["/maps/provider/tiles/{z}/{x}/{y}.png"] } },
  layers: [{ id: "streets", type: "raster", source: "streets" }],
};

describe("production driver map readiness", () => {
  it("includes the build-time map checker in the otherwise restricted Docker context", async () => {
    const dockerIgnore = await readFile(new URL("../.dockerignore", import.meta.url), "utf8");
    expect(dockerIgnore).toContain("scripts/*\n!scripts/production/\nscripts/production/*\n!scripts/production/check-driver-map-config.mjs");
    expect(dockerIgnore).not.toMatch(/^scripts$/m);
  });

  it("remains a release blocker until an approved provider is declared", () => {
    expect(() => buildDriverMapConfig({})).toThrow(/release|approved|ready/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_STYLE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" })).toThrow(/same-origin/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL: "http://maps.example.test" })).toThrow(/HTTPS/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_PROVIDER_ID: "e2e-fixture" })).toThrow(/fixture/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_COVERAGE_BOUNDS: "101,3,100,4" })).toThrow(/bounds/i);
  });

  it("rejects overview-only and source-less styles", () => {
    expect(() => assertOperationalStyle({ version: 8, sources: {}, layers: [] })).toThrow(/usable/i);
    expect(() => assertOperationalStyle({ ...style, metadata: { "axora:map-purpose": "regional-overview-only" } })).toThrow(/overview/i);
    expect(() => assertOperationalStyle({ ...style, metadata: {} })).toThrow(/operational-street/i);
  });

  it("atomically renders a public, non-secret provider contract only for local context", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "axora-driver-map-"));
    const publicRoot = path.join(root, "public");
    const stylePath = path.join(publicRoot, "maps/provider/style.json");
    const outputPath = path.join(publicRoot, "maps/driver-map-config.json");
    await mkdir(path.dirname(stylePath), { recursive: true });
    expect(JSON.parse(await readFile(new URL("../public/maps/driver-map-config.json", import.meta.url), "utf8")))
      .toMatchObject({ version: 1, status: "configured", providerId: "axora-mvp-klang-valley" });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(stylePath, JSON.stringify(style)));
    await renderDriverMapConfig(environment, outputPath, publicRoot);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(buildDriverMapConfig(environment));
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);
  });

  it("ships a real same-origin MVP style with buildings, roads, labels, glyphs and matching coverage", async () => {
    const config = JSON.parse(await readFile(new URL("../public/maps/driver-map-config.json", import.meta.url), "utf8"));
    const shippedStyle = JSON.parse(await readFile(new URL("../public/maps/axora-mvp-operational-style.json", import.meta.url), "utf8"));
    expect(() => assertOperationalStyle(shippedStyle)).not.toThrow();
    expect(shippedStyle.metadata["axora:provider-id"]).toBe(config.providerId);
    expect(shippedStyle.metadata["axora:coverage"]).toEqual(config.coverage.bounds);
    expect(shippedStyle.sources["mvp-roads"].data).toBe("/maps/mvp-klang-valley-roads.geojson");
    expect(shippedStyle.sources["mvp-places"].data).toBe("/maps/mvp-klang-valley-places.geojson");
    expect(shippedStyle.sources["mvp-buildings"].data).toBe("/maps/mvp-cyberjaya-buildings.geojson");
    expect(shippedStyle.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mvp-building-fill", type: "fill", minzoom: 15 }),
      expect.objectContaining({ id: "mvp-building-outline", type: "line", minzoom: 16 }),
      expect.objectContaining({ id: "mvp-building-labels", type: "symbol", minzoom: 17 }),
    ]));
    expect(shippedStyle.glyphs).toBe("/maps/fonts/{fontstack}/{range}.pbf");
  });
});

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
};

const style = {
  version: 8,
  metadata: { "axora:map-purpose": "operational-street" },
  sources: { streets: { type: "raster", tiles: ["/maps/provider/tiles/{z}/{x}/{y}.png"] } },
  layers: [{ id: "streets", type: "raster", source: "streets" }],
};

describe("production driver map readiness", () => {
  it("remains a release blocker until an approved provider is declared", () => {
    expect(() => buildDriverMapConfig({})).toThrow(/release|approved|ready/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_STYLE_URL: "https://tile.openstreetmap.org/{z}/{x}/{y}.png" })).toThrow(/same-origin/i);
    expect(() => buildDriverMapConfig({ ...environment, NEXT_PUBLIC_AXORA_MAP_ATTRIBUTION_URL: "http://maps.example.test" })).toThrow(/HTTPS/i);
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
      .toEqual({ version: 1, status: "unconfigured" });
    await import("node:fs/promises").then(({ writeFile }) => writeFile(stylePath, JSON.stringify(style)));
    await renderDriverMapConfig(environment, outputPath, publicRoot);
    expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(buildDriverMapConfig(environment));
    expect((await stat(outputPath)).mode & 0o777).toBe(0o644);
  });
});

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("self-hosted delivery place search", () => {
  let geocoding: typeof import("@/lib/geocoding");

  beforeAll(async () => { geocoding = await import("@/lib/geocoding"); });

  it.each(["ver", "verdi", "cyberjaya", "kenwingston"])("finds a useful partial match for %s", async (query) => {
    const results = await geocoding.autocompletePlaces(query, "en");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      providerId: "axora-osm-klang-valley",
      attribution: "© OpenStreetMap contributors",
    });
    expect(Number.isFinite(results[0]!.latitude)).toBe(true);
    expect(Number.isFinite(results[0]!.longitude)).toBe(true);
  });

  it("returns a localized nearby address and rejects positions outside coverage", async () => {
    const nearby = await geocoding.reverseGeocodePlace({ latitude: 2.9189, longitude: 101.6412 }, "ms");
    expect(nearby?.formattedAddress).toContain("Verdi");
    await expect(geocoding.reverseGeocodePlace({ latitude: 40.7128, longitude: -74.006 }, "en")).resolves.toBeNull();
  });
});

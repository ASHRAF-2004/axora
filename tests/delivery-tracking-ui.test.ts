import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("delivery tracking interfaces", () => {
  it("keeps geolocation private, bounded, retryable and visibly active", async () => {
    const [panel, trackingService, styles, copy, nextConfig, caddy, productionCaddy] = await Promise.all([
      readFile(new URL(
        "../src/components/role-portals/DeliveryTrackingPanels.tsx",
        import.meta.url,
      ), "utf8"),
      readFile(new URL("../src/lib/delivery-tracking.ts", import.meta.url), "utf8"),
      readFile(new URL(
        "../src/components/role-portals/DeliveryTracking.module.css",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/lib/delivery-tracking-i18n.ts",
        import.meta.url,
      ), "utf8"),
      readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
      readFile(new URL("../caddy/Caddyfile", import.meta.url), "utf8"),
      readFile(new URL("../caddy/Caddyfile.production", import.meta.url), "utf8"),
    ]);
    expect(panel).toContain("navigator.geolocation.watchPosition");
    expect(panel).toContain("navigator.geolocation.clearWatch");
    expect(panel).toContain("MAX_BUFFERED_POINTS = 100");
    expect(panel).toContain("MAX_BUFFER_BYTES = 256 * 1024");
    expect(panel).toContain("PERMISSION_DENIED");
    expect(copy).toContain("Delivery status was not changed");
    expect(panel).toContain("REFRESH_INTERVAL_MS = 15_000");
    expect(panel).toContain('role="img"');
    expect(panel).toContain("latitudeDelta");
    expect(panel).toContain("longitudeDelta");
    expect(panel).not.toContain('M74 122 C190 18 370 164 526 54');
    expect(trackingService).toContain("latitude: session.latitude");
    expect(trackingService).toContain("destinationLatitude: session.destinationLatitude");
    expect(panel).not.toMatch(/mapbox|googleapis|leaflet/i);
    expect(styles).toContain("border-inline-start");
    expect(styles).toContain("@media (max-width: 560px)");
    expect(styles).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(copy).toContain("ar:");
    expect(copy).toContain("ms:");
    for (const headers of [nextConfig, caddy, productionCaddy]) {
      expect(headers).toContain("camera=(), microphone=(), geolocation=(self)");
      expect(headers).not.toContain("geolocation=()");
    }
  });

  it("integrates tracking only into established driver, owner-detail and receiving surfaces", async () => {
    const [driver, ownerMap, receiver] = await Promise.all([
      readFile(new URL(
        "../src/components/role-portals/DeliveryExecutionPanel.tsx",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/components/role-portals/DriverLiveMap.tsx",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/components/role-portals/ReceivingOtpPanel.tsx",
        import.meta.url,
      ), "utf8"),
    ]);
    expect(driver).toContain("<DriverTrackingPanel");
    expect(ownerMap).toContain("/api/drivers/");
    expect(ownerMap).toContain("EventSource");
    expect(receiver).toContain("<DeliveryTrackingBoard");
    expect(receiver).not.toContain("audience=");
  });
});

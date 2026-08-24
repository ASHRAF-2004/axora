import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

import { branchDeliveryLocationPickerInternals } from "@/components/BranchDeliveryLocationPicker";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";

describe("branch delivery location picker coordinate fallback", () => {
  it("zooms selected delivery places closely enough to show building footprints", () => {
    expect(branchDeliveryLocationPickerInternals.DELIVERY_LOCATION_SELECTED_ZOOM).toBeGreaterThanOrEqual(18);
  });

  it("accepts bounded decimal coordinate text without geocoding", () => {
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("3.139000", "101.686900"))
      .toEqual({ latitude: 3.139, longitude: 101.6869 });
    expect(branchDeliveryLocationPickerInternals.formattedCoordinate(3.139))
      .toBe("3.139000");
  });

  it("rejects missing, non-numeric, and out-of-range manual values", () => {
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("", "101.6869")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("3.139", "not-a-coordinate")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("0x10", "101.6869")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("3.139", "1e2")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("91", "101.6869")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.parsedCoordinateText("3.139", "181")).toBeNull();
    expect(branchDeliveryLocationPickerInternals.fieldIsValid("latitude", "-90")).toBe(true);
    expect(branchDeliveryLocationPickerInternals.fieldIsValid("longitude", "180")).toBe(true);
  });

  it("distinguishes an edited draft from the last confirmed coordinates", () => {
    const confirmed = { latitude: 3.139, longitude: 101.6869 };
    expect(branchDeliveryLocationPickerInternals.sameCoordinates(confirmed, { ...confirmed })).toBe(true);
    expect(branchDeliveryLocationPickerInternals.sameCoordinates(confirmed, { ...confirmed, latitude: 3.14 })).toBe(false);
    expect(branchDeliveryLocationPickerInternals.sameCoordinates(null, null)).toBe(false);
  });

  it("ships complete English, Arabic, and Malay picker copy", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = branchDeliveryLocationMessages(locale);
      expect(copy.title).toBeTruthy();
      expect(copy.mapUnavailable).toBeTruthy();
      expect(copy.latitudeError).toBeTruthy();
      expect(copy.longitudeError).toBeTruthy();
      expect(copy.confirmed).toBeTruthy();
      expect(copy.pageTitle).toBeTruthy();
      expect(copy.addressLabel).toBeTruthy();
      expect("reason" in copy).toBe(false);
      expect(copy.confirmationRequired).toBeTruthy();
    }
  });

  it("retires the text-only organization form in favor of the canonical map workspace", async () => {
    const [page, action] = await Promise.all([
      readFile(new URL(
        "../src/app/(portal)/branches/organization/page.tsx",
        import.meta.url,
      ), "utf8"),
      readFile(new URL(
        "../src/app/(portal)/branches/organization/actions.ts",
        import.meta.url,
      ), "utf8"),
    ]);
    expect(page).not.toContain('name="nodeType" value="DELIVERY_LOCATION"');
    expect(action).not.toContain('nodeType: z.enum(ORGANIZATION_NODE_TYPES)');
    expect(action).toContain('"BRANCH", "DEPARTMENT", "BUSINESS_UNIT", "COST_CENTRE"');
  });
});

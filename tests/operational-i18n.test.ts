import { describe, expect, it } from "vitest";

import {
  notificationEventKeys,
  operationalDictionaryKeys,
  operationalEventLabel,
  operationalMessage,
  operationalMissingKeys,
  operationalNumber,
  operationalStatus,
} from "@/lib/operational-i18n";

describe("operational portal localization", () => {
  it("keeps Arabic and Malay complete against the English key catalog", () => {
    expect(operationalDictionaryKeys().length).toBeGreaterThan(150);
    expect(operationalMissingKeys("ar")).toEqual([]);
    expect(operationalMissingKeys("ms")).toEqual([]);
  });

  it("localizes representative operational screens and interpolates values", () => {
    expect(operationalMessage("ar", "companies.title")).toBe("الشركات العميلة");
    expect(operationalMessage("ms", "finance.platformTitle")).toBe("Invois dan bayaran");
    expect(operationalMessage("ar", "notifications.unread", { count: 3 })).toContain("3");
    expect(operationalMessage("ms", "settings.updated")).toBe("Tetapan harga disimpan.");
  });

  it("localizes every supported workflow notification event", () => {
    for (const eventKey of notificationEventKeys) {
      expect(operationalEventLabel("ar", eventKey)).not.toBe(eventKey);
      expect(operationalEventLabel("ms", eventKey)).not.toBe(eventKey);
    }
  });

  it("uses locale-aware statuses and numbers", () => {
    expect(operationalStatus("ar", "Approved")).toBe("معتمد");
    expect(operationalStatus("ms", "Delivered")).toBe("Dihantar");
    expect(operationalNumber("ar", 12_345)).toBe(new Intl.NumberFormat("ar-MY").format(12_345));
    expect(operationalNumber("ms", 12_345)).toBe(new Intl.NumberFormat("ms-MY").format(12_345));
  });
});

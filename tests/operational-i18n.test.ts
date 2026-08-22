import { describe, expect, it } from "vitest";

import {
  operationalMessage,
  operationalNumber,
  operationalStatus,
} from "@/lib/operational-i18n";

describe("operational portal localization", () => {
  it("localizes the retained finance and access screens", () => {
    expect(operationalMessage("ms", "finance.platformTitle")).toBe("Invois dan bayaran");
    expect(operationalMessage("ar", "finance.invoiceCount", { count: 3 })).toContain("3");
    expect(operationalMessage("ms", "access.dashboard")).toBe("Kembali ke papan pemuka");
  });

  it("uses locale-aware statuses and numbers", () => {
    expect(operationalStatus("ar", "Approved")).toBe("معتمد");
    expect(operationalStatus("ms", "Delivered")).toBe("Dihantar");
    expect(operationalNumber("ar", 12_345)).toBe(new Intl.NumberFormat("ar-MY").format(12_345));
    expect(operationalNumber("ms", 12_345)).toBe(new Intl.NumberFormat("ms-MY").format(12_345));
  });
});

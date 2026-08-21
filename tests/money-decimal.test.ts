import { describe, expect, it } from "vitest";
import {
  MoneyDecimalValidationError,
  parseMoneyDecimal,
  parsePositiveMoneyDecimal,
  formatMoneyDecimal,
  moneyDecimalFromMinorUnits,
  moneyDecimalIsPositive,
  moneyDecimalToMinorUnits,
  safeParseMoneyDecimal,
} from "@/lib/money-decimal";

describe("strict monetary decimal validation", () => {
  it("canonicalizes accepted numeric(18,2) strings without floating point", () => {
    expect(parseMoneyDecimal("0")).toBe("0.00");
    expect(parseMoneyDecimal("0001.2")).toBe("1.20");
    expect(parseMoneyDecimal("9007199254740993.01")).toBe("9007199254740993.01");
    expect(parseMoneyDecimal("9999999999999999.99")).toBe("9999999999999999.99");
  });

  it("rejects non-string and ambiguous decimal representations", () => {
    expect(safeParseMoneyDecimal(12.34)).toEqual({ success: false, error: "NOT_A_STRING" });
    expect(safeParseMoneyDecimal("")).toEqual({ success: false, error: "EMPTY" });
    for (const input of [" 1.00", "1.00 ", "+1.00", ".50", "1.", "1e2", "1,000.00", "RM 1.00", "١٫٠٠"]) {
      expect(safeParseMoneyDecimal(input)).toEqual({ success: false, error: "INVALID_FORMAT" });
    }
  });

  it("enforces the database scale and precision", () => {
    expect(safeParseMoneyDecimal("1.001")).toEqual({
      success: false,
      error: "TOO_MANY_DECIMAL_PLACES",
    });
    expect(safeParseMoneyDecimal("10000000000000000.00")).toEqual({
      success: false,
      error: "OUT_OF_RANGE",
    });
  });

  it("requires positive values for financial commands", () => {
    expect(parsePositiveMoneyDecimal("0.01")).toBe("0.01");
    expect(() => parsePositiveMoneyDecimal("0.00")).toThrowError(
      expect.objectContaining({ code: "ZERO_NOT_ALLOWED" }),
    );
    expect(() => parsePositiveMoneyDecimal("-1.00")).toThrowError(
      expect.objectContaining({ code: "NEGATIVE_NOT_ALLOWED" }),
    );
  });

  it("allows exact signed ledger deltas only when explicitly requested", () => {
    expect(parseMoneyDecimal("-12.3", { allowNegative: true })).toBe("-12.30");
    expect(parseMoneyDecimal("-0.00", { allowNegative: true })).toBe("0.00");
  });

  it("throws a typed validation error from the asserting parser", () => {
    expect.assertions(2);
    try {
      parseMoneyDecimal("1.234");
    } catch (error) {
      expect(error).toBeInstanceOf(MoneyDecimalValidationError);
      expect((error as MoneyDecimalValidationError).code).toBe("TOO_MANY_DECIMAL_PLACES");
    }
  });

  it("compares and formats values beyond Number safe precision exactly", () => {
    const value = parseMoneyDecimal("9007199254740993.01");
    expect(moneyDecimalToMinorUnits(value)).toBe(900719925474099301n);
    expect(moneyDecimalFromMinorUnits(900719925474099301n)).toBe(value);
    expect(moneyDecimalIsPositive(value)).toBe(true);
    expect(moneyDecimalIsPositive("0.00")).toBe(false);
    expect(formatMoneyDecimal(value, "MYR", "en-MY")).toContain("9,007,199,254,740,993.01");
    expect(formatMoneyDecimal("-0.01", "MYR", "en-MY")).toContain("-RM");
  });
});

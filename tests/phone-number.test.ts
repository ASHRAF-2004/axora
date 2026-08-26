import { describe, expect, it } from "vitest";

import {
  normalizePhoneDigits,
  normalizePhoneNumber,
  optionalPhoneNumberSchema,
  PhoneNumberError,
  requiredPhoneNumberSchema,
} from "@/lib/phone-number";

describe("international phone normalization", () => {
  it("normalizes Malaysian national, international paste, 00 prefix and Arabic digits", () => {
    expect(normalizePhoneNumber("012-345 6789")).toBe("+60123456789");
    expect(normalizePhoneNumber("+1 (202) 555-0123")).toBe("+12025550123");
    expect(normalizePhoneNumber("00 44 20 7946 0018")).toBe("+442079460018");
    expect(normalizePhoneNumber("٠١٢ ٣٤٥ ٦٧٨٩")).toBe("+60123456789");
    expect(normalizePhoneDigits("۱۲۳٤٥٦")).toBe("123456");
  });

  it("rejects letters, duplicate calling codes and implausible numbers", () => {
    for (const value of ["abc +60", "+60 +60 12 345 6789", "+60300000000", "+12"]) {
      expect(() => normalizePhoneNumber(value)).toThrow(PhoneNumberError);
    }
    try {
      normalizePhoneNumber("+60 +60 12 345 6789");
    } catch (error) {
      expect(error).toMatchObject({ code: "DUPLICATE_COUNTRY_CODE" });
    }
  });

  it("keeps optional values empty and transforms every accepted write to E.164", () => {
    expect(optionalPhoneNumberSchema.parse("  ")).toBe("");
    expect(optionalPhoneNumberSchema.parse("012 345 6789")).toBe("+60123456789");
    expect(requiredPhoneNumberSchema.parse("+1 202 555 0123")).toBe("+12025550123");
    expect(requiredPhoneNumberSchema.safeParse("").success).toBe(false);
    expect(optionalPhoneNumberSchema.safeParse("phone me").success).toBe(false);
  });
});

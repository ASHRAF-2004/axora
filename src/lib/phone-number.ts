import {
  parsePhoneNumberWithError,
  type CountryCode,
} from "libphonenumber-js/max";
import { z } from "zod";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "MY";

export type PhoneNumberErrorCode =
  | "EMPTY"
  | "INVALID_CHARACTERS"
  | "DUPLICATE_COUNTRY_CODE"
  | "INVALID_NUMBER";

export class PhoneNumberError extends Error {
  constructor(public readonly code: PhoneNumberErrorCode) {
    super(code);
    this.name = "PhoneNumberError";
  }
}

export function normalizePhoneDigits(value: string) {
  return value.normalize("NFKC")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function normalizePhoneNumber(
  value: string,
  defaultCountry: CountryCode = DEFAULT_PHONE_COUNTRY,
) {
  const normalized = normalizePhoneDigits(value).trim();
  if (!normalized) throw new PhoneNumberError("EMPTY");
  if (normalized.length > 80 || !/^[+()0-9.\-\s]+$/.test(normalized)) {
    throw new PhoneNumberError("INVALID_CHARACTERS");
  }
  const plusCount = (normalized.match(/\+/g) ?? []).length;
  if (plusCount > 1 || (plusCount === 1 && !normalized.startsWith("+"))) {
    throw new PhoneNumberError("DUPLICATE_COUNTRY_CODE");
  }
  const international = normalized.startsWith("00")
    ? `+${normalized.slice(2)}`
    : normalized;
  try {
    const phone = parsePhoneNumberWithError(international, international.startsWith("+")
      ? { extract: false }
      : { defaultCountry, extract: false });
    if (!phone.isValid() || phone.ext) throw new PhoneNumberError("INVALID_NUMBER");
    return String(phone.number);
  } catch (error) {
    if (error instanceof PhoneNumberError) throw error;
    throw new PhoneNumberError("INVALID_NUMBER");
  }
}

function phoneSchema(required: boolean) {
  return z.string().trim().max(80).transform((value, context) => {
    if (!value) {
      if (!required) return "";
      context.addIssue({ code: "custom", message: "A phone number is required." });
      return z.NEVER;
    }
    try {
      return normalizePhoneNumber(value);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a valid international phone number." });
      return z.NEVER;
    }
  });
}

export const optionalPhoneNumberSchema = phoneSchema(false);
export const requiredPhoneNumberSchema = phoneSchema(true);

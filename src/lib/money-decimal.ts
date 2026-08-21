const MONEY_DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

export const MONEY_DECIMAL_PRECISION = 18;
export const MONEY_DECIMAL_SCALE = 2;
export const MONEY_DECIMAL_INTEGER_DIGITS = MONEY_DECIMAL_PRECISION - MONEY_DECIMAL_SCALE;

declare const moneyDecimalBrand: unique symbol;

/** A canonical PostgreSQL numeric(18,2) value. Never convert it to number. */
export type MoneyDecimalString = string & {
  readonly [moneyDecimalBrand]: "MoneyDecimalString";
};

export const MONEY_DECIMAL_ERROR_CODES = [
  "NOT_A_STRING",
  "EMPTY",
  "INVALID_FORMAT",
  "TOO_MANY_DECIMAL_PLACES",
  "OUT_OF_RANGE",
  "NEGATIVE_NOT_ALLOWED",
  "ZERO_NOT_ALLOWED",
] as const;

export type MoneyDecimalErrorCode = (typeof MONEY_DECIMAL_ERROR_CODES)[number];

export interface MoneyDecimalOptions {
  /** Ledger deltas may opt in. User-entered credits and payments must not. */
  allowNegative?: boolean;
  /** Balance-like values may be zero. Transaction amounts should opt out. */
  allowZero?: boolean;
}

export type MoneyDecimalParseResult =
  | { readonly success: true; readonly value: MoneyDecimalString }
  | { readonly success: false; readonly error: MoneyDecimalErrorCode };

export class MoneyDecimalValidationError extends Error {
  readonly code: MoneyDecimalErrorCode;

  constructor(code: MoneyDecimalErrorCode) {
    super(`Invalid monetary amount: ${code}`);
    this.name = "MoneyDecimalValidationError";
    this.code = code;
  }
}

function failed(error: MoneyDecimalErrorCode): MoneyDecimalParseResult {
  return { success: false, error };
}

/**
 * Validates an ASCII decimal without ever passing through JavaScript floating
 * point. Accepted values are canonicalized for PostgreSQL numeric(18,2).
 */
export function safeParseMoneyDecimal(
  input: unknown,
  options: MoneyDecimalOptions = {},
): MoneyDecimalParseResult {
  if (typeof input !== "string") return failed("NOT_A_STRING");
  if (input.length === 0) return failed("EMPTY");

  const match = MONEY_DECIMAL_PATTERN.exec(input);
  if (!match) return failed("INVALID_FORMAT");

  const [, sign, rawInteger = "", rawFraction = ""] = match;
  if (rawFraction.length > MONEY_DECIMAL_SCALE) {
    return failed("TOO_MANY_DECIMAL_PLACES");
  }
  if (sign === "-" && !options.allowNegative) {
    return failed("NEGATIVE_NOT_ALLOWED");
  }

  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  if (integer.length > MONEY_DECIMAL_INTEGER_DIGITS) {
    return failed("OUT_OF_RANGE");
  }

  const fraction = rawFraction.padEnd(MONEY_DECIMAL_SCALE, "0");
  const zero = /^0+$/.test(integer) && /^0+$/.test(fraction);
  if (zero && options.allowZero === false) return failed("ZERO_NOT_ALLOWED");

  const canonicalSign = sign === "-" && !zero ? "-" : "";
  return {
    success: true,
    value: `${canonicalSign}${integer}.${fraction}` as MoneyDecimalString,
  };
}

export function parseMoneyDecimal(
  input: unknown,
  options: MoneyDecimalOptions = {},
): MoneyDecimalString {
  const parsed = safeParseMoneyDecimal(input, options);
  if (!parsed.success) throw new MoneyDecimalValidationError(parsed.error);
  return parsed.value;
}

/** Use for top-ups, allocations, and payment amounts that must exceed zero. */
export function parsePositiveMoneyDecimal(input: unknown): MoneyDecimalString {
  return parseMoneyDecimal(input, { allowNegative: false, allowZero: false });
}

/** Exact minor-unit conversion for comparisons and demo-only bookkeeping. */
export function moneyDecimalToMinorUnits(input: MoneyDecimalString): bigint {
  const canonical = parseMoneyDecimal(input, { allowNegative: true });
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integer, fraction] = unsigned.split(".") as [string, string];
  const units = BigInt(`${integer}${fraction}`);
  return negative ? -units : units;
}

export function moneyDecimalFromMinorUnits(input: bigint): MoneyDecimalString {
  const negative = input < 0n;
  const absolute = negative ? -input : input;
  const integer = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(MONEY_DECIMAL_SCALE, "0");
  return parseMoneyDecimal(`${negative ? "-" : ""}${integer}.${fraction}`, {
    allowNegative: true,
  });
}

export function moneyDecimalIsPositive(input: unknown): boolean {
  const parsed = safeParseMoneyDecimal(input, { allowNegative: true });
  return parsed.success && moneyDecimalToMinorUnits(parsed.value) > 0n;
}

/**
 * Formats a validated decimal exactly. The currency layout comes from Intl,
 * while the amount itself stays in string/BigInt space.
 */
export function formatMoneyDecimal(
  input: unknown,
  currency: string,
  locale: string,
): string {
  const canonical = parseMoneyDecimal(input, { allowNegative: true });
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const [integer, fraction] = unsigned.split(".") as [string, string];
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: MONEY_DECIMAL_SCALE,
    maximumFractionDigits: MONEY_DECIMAL_SCALE,
  });
  const positiveParts = formatter.formatToParts(BigInt(integer));
  const numericParts = positiveParts
    .filter((part) => ["integer", "group", "decimal", "fraction"].includes(part.type))
    .map((part) => part.type === "fraction"
      ? { ...part, value: new Intl.NumberFormat(locale, {
        useGrouping: false,
        minimumIntegerDigits: MONEY_DECIMAL_SCALE,
      }).format(BigInt(fraction)) }
      : part);
  const template = negative
    ? formatter.formatToParts(-1n)
    : positiveParts;
  let insertedAmount = false;
  const result: Intl.NumberFormatPart[] = [];
  for (const part of template) {
    if (["integer", "group", "decimal", "fraction"].includes(part.type)) {
      if (!insertedAmount) {
        result.push(...numericParts);
        insertedAmount = true;
      }
      continue;
    }
    result.push(part);
  }
  return result.map((part) => part.value).join("");
}

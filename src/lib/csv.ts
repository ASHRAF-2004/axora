const FORMULA_PREFIX = /^(?:[\u0000-\u0020]*[=+\-@]|[\t\r])/;
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CSV_SPECIAL_CHARACTER = /[",\n\r\t]/;

/**
 * Encodes one CSV field and neutralizes spreadsheet formula prefixes.
 *
 * Quoting alone does not stop Excel or LibreOffice from evaluating values such
 * as "=SUM(1,1)". A leading apostrophe makes the value explicit text while
 * preserving what a person sees in the spreadsheet.
 */
export function encodeCsvCell(value: unknown) {
  let text = String(value ?? "");
  if (FORMULA_PREFIX.test(text) && !PLAIN_NUMBER.test(text)) text = `'${text}`;
  return CSV_SPECIAL_CHARACTER.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

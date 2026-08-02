/** Password length is measured in Unicode code points, not UTF-16 code units. */
export const MIN_PASSWORD_CODE_POINTS = 15;
export const MAX_PASSWORD_CODE_POINTS = 128;

export function passwordCodePointLength(password: string) {
  return Array.from(password).length;
}

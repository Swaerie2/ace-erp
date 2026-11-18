/**
 * Turns a South African phone number into +27XXXXXXXXX, or null if it is not one.
 * Accepts "082 123 4567", "+27 82 123 4567", "0027...", "(011) 123-4567".
 */
export function normalisePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? `+${digits}` : null;
}

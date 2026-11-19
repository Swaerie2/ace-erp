/**
 * Turns a South African phone number into +27XXXXXXXXX, or null if it is not one.
 * Accepts "082 123 4567", "+27 82 123 4567", "+27 (0)82 123 4567", "0027...", "(011) 123-4567".
 * Anything with letters in it is refused ("call 082...", "0821234567abc") rather than guessed at.
 */
export function normalisePhone(input: string): string | null {
  if (/\p{L}/u.test(input)) return null;
  // "+27 (0)82 ...": the (0) is the trunk prefix written out; it is not part of the number.
  const withoutTrunk = input.replace(/^(\s*(?:\+|00)?\s*27[\s.-]*)\(0\)/, "$1");
  let digits = withoutTrunk.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `27${digits.slice(1)}`;
  return /^27\d{9}$/.test(digits) ? `+${digits}` : null;
}

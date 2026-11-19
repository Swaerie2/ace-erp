export function formatCustomerNumber(n: number): string {
  return `C-${String(n).padStart(4, "0")}`;
}

/** "C-0012" or "c0012" -> 12. Anything else -> null. */
export function parseCustomerNumber(input: string): number | null {
  const match = /^C-?(\d{1,9})$/i.exec(input.trim());
  return match?.[1] ? Number(match[1]) : null;
}

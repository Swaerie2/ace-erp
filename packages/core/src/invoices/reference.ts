/** "INV-2026-0001". Null for a draft (no number yet). */
export function formatInvoiceReference(i: {
  numberYear: number | null;
  numberSeq: number | null;
}): string | null {
  if (i.numberYear === null || i.numberSeq === null) return null;
  return `INV-${i.numberYear}-${String(i.numberSeq).padStart(4, "0")}`;
}

/** "INV-2026-0104", "2026-104" or "104" -> the number parts. Anything else -> null. */
export function parseInvoiceSearch(
  term: string,
): { numberYear?: number; numberSeq: number } | null {
  const m = /^(?:inv-)?(?:(\d{4})-)?(\d{1,6})$/i.exec(term.trim());
  if (!m?.[2]) return null;
  return { ...(m[1] ? { numberYear: Number(m[1]) } : {}), numberSeq: Number(m[2]) };
}

const safe = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, "-");

export function invoicePdfFilename(reference: string): string {
  return `${safe(reference)}.pdf`;
}

export function statementPdfFilename(customerNumber: string, to: string): string {
  return `Statement-${safe(customerNumber)}-${safe(to)}.pdf`;
}

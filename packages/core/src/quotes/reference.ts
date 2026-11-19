export type QuoteStatusValue =
  "DRAFT" | "ISSUED" | "ACCEPTED" | "DECLINED" | "REPLACED" | "WITHDRAWN";
export type QuoteDisplayStatus = QuoteStatusValue | "EXPIRED";

const ZONE = "Africa/Johannesburg";
// The "en-CA" locale formats a date as YYYY-MM-DD.
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in South Africa as "YYYY-MM-DD", wherever the server happens to run. */
export function todaySA(now: Date = new Date()): string {
  return dayFormat.format(now);
}

export function yearSA(now: Date = new Date()): number {
  return Number(todaySA(now).slice(0, 4));
}

/** A date column (stored as midnight UTC) as "YYYY-MM-DD". */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromDateString(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromDateString(value);
  return !Number.isNaN(date.getTime()) && toDateString(date) === value;
}

export function addDays(value: string, days: number): string {
  const date = fromDateString(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

/** "QUO-2026-0104", with " R2" from the second revision on. Null for a draft (no number yet). */
export function formatQuoteReference(q: {
  numberYear: number | null;
  numberSeq: number | null;
  revision: number;
}): string | null {
  if (q.numberYear === null || q.numberSeq === null) return null;
  const base = `QUO-${q.numberYear}-${String(q.numberSeq).padStart(4, "0")}`;
  return q.revision > 1 ? `${base} R${q.revision}` : base;
}

/** ISSUED quotes whose valid-until day has passed show as EXPIRED. Nothing is stored for this. */
export function displayStatus(
  q: { status: QuoteStatusValue; validUntil: Date },
  today: string = todaySA(),
): QuoteDisplayStatus {
  if (q.status === "ISSUED" && toDateString(q.validUntil) < today) return "EXPIRED";
  return q.status;
}

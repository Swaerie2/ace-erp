import { isValidDateString, todaySA } from "../quotes/reference";
import type { BillingTiming } from "./labels";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" with a year from 2000 to 2999. */
export function isMonthString(value: string): boolean {
  const m = MONTH.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  return year >= 2000 && year <= 2999;
}

function parts(month: string): { year: number; month: number } {
  return { year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) };
}

/** The current month in South Africa as "YYYY-MM". */
export function currentMonthSA(now: Date = new Date()): string {
  return todaySA(now).slice(0, 7);
}

export function addMonths(month: string, n: number): string {
  const p = parts(month);
  const total = p.year * 12 + (p.month - 1) + n;
  const year = Math.floor(total / 12);
  const m = total - year * 12 + 1;
  return `${year}-${String(m).padStart(2, "0")}`;
}

export function daysInMonth(month: string): number {
  const p = parts(month);
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

export const firstDayOf = (month: string): string => `${month}-01`;
export const lastDayOf = (month: string): string =>
  `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
export const monthOf = (date: string): string => date.slice(0, 7);

/** Pre: the run in month M bills month M+1. Post: it bills month M. */
export function serviceMonthFor(runMonth: string, timing: BillingTiming): string {
  return timing === "PRE" ? addMonths(runMonth, 1) : runMonth;
}

/** Pre: due the last day of the run month. Post: due the 25th of the run month. */
export function dueDateFor(runMonth: string, timing: BillingTiming): string {
  return timing === "PRE" ? lastDayOf(runMonth) : `${runMonth}-25`;
}

/**
 * The part-month amount when a service starts inside the service month after the 1st: the days from the
 * start date to the month end, over the days in the month, rounded to the cent. A positive amount never
 * rounds down to 0 cents (at least 1 cent is charged).
 *
 * Returns null for the "full month" cases: the start is on or before the 1st of the service month, or before
 * the service month. The CALLER must skip the agreement altogether when the start date is after the service
 * month (null does not mean "charge in full" then).
 */
export function proRata(
  amountCents: number,
  startDate: string,
  serviceMonth: string,
): { amountCents: number; days: number; daysInMonth: number } | null {
  if (!isValidDateString(startDate) || monthOf(startDate) !== serviceMonth) return null;
  const startDay = Number(startDate.slice(8, 10));
  if (startDay <= 1) return null;
  const dim = daysInMonth(serviceMonth);
  const days = dim - startDay + 1;
  const rounded = Math.round((amountCents * days) / dim);
  return {
    amountCents: amountCents > 0 ? Math.max(1, rounded) : rounded,
    days,
    daysInMonth: dim,
  };
}

/** A run month from 12 months before the current month up to next month. */
export function runMonthAllowed(runMonth: string, today: string): boolean {
  if (!isMonthString(runMonth)) return false;
  const current = monthOf(today);
  return runMonth >= addMonths(current, -12) && runMonth <= addMonths(current, 1);
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-12" -> "December 2026". */
export function formatMonthLabel(month: string): string {
  const p = parts(month);
  return `${MONTH_NAMES[p.month - 1] ?? ""} ${p.year}`;
}

/** "2026-12-10" -> "10 Dec". */
export function formatDayMonth(date: string): string {
  const name = MONTH_NAMES[Number(date.slice(5, 7)) - 1] ?? "";
  return `${Number(date.slice(8, 10))} ${name.slice(0, 3)}`;
}

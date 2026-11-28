import { addDays, isValidDateString, todaySA } from "../quotes/reference";
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

/**
 * The date the normal monthly run bills this service month (the 20th of its run month): Pre, the 20th of the
 * month before; Post, the 20th of the month itself.
 */
export function runDateFor(serviceMonth: string, timing: BillingTiming): string {
  return `${timing === "PRE" ? addMonths(serviceMonth, -1) : serviceMonth}-20`;
}

/**
 * The date part of the start-month catch-up rule: a first agreement starting in `serviceMonth` needs a
 * part-month invoice of its own when that month is this month or last month (South African date `today`) and
 * the normal run for it was already due, so that run could not have billed it. Older months are left alone,
 * so old history never floods the list. The other conditions (no live monthly invoice for that month, an
 * active customer, a first agreement with something priced) are checked against the database.
 */
export function startMonthCatchUpNeeded(
  serviceMonth: string,
  timing: BillingTiming,
  today: string,
): boolean {
  if (!isMonthString(serviceMonth)) return false;
  const current = monthOf(today);
  if (serviceMonth !== current && serviceMonth !== addMonths(current, -1)) return false;
  return today >= runDateFor(serviceMonth, timing);
}

/**
 * The due date of a catch-up draft: the later of the normal due date for that month's run and a week from
 * today, but never later than a week after the service month ends, and never before today (a draft's due date
 * must be from today on).
 */
export function catchUpDueDate(serviceMonth: string, timing: BillingTiming, today: string): string {
  const normal = dueDateFor(monthOf(runDateFor(serviceMonth, timing)), timing);
  const weekOn = addDays(today, 7);
  const latest = addDays(lastDayOf(serviceMonth), 7);
  const due = normal > weekOn ? normal : weekOn;
  const capped = due < latest ? due : latest;
  return capped < today ? today : capped;
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

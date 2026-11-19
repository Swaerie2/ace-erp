type Param = string | string[] | undefined;

/** One value from the address bar. A repeated key (?q=a&q=b) arrives as an array: treated as absent. */
export function first(value: Param): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A whole number of at least 1, capped at `max`. Anything else (words, Infinity, 1e999) is undefined. */
export function positiveInt(value: Param, max: number): number | undefined {
  const text = first(value);
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 1) return undefined;
  return Math.min(n, max);
}

/** A whole number of 0 or more. Anything else is undefined. */
export function nonNegativeInt(value: Param): number | undefined {
  const text = first(value);
  if (text === undefined || !/^\d+$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : undefined;
}

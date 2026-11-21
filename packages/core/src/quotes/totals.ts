export type TotalsLine = {
  lineKind: "PRICED" | "OPTIONAL" | "INCLUDED";
  billing: "MONTHLY" | "ONCE_OFF" | null;
  amountCents: number | null;
  chosen?: boolean;
};

export type QuoteTotals = {
  monthly: number;
  onceOff: number;
  optionalMonthly: number;
  optionalOnceOff: number;
  monthlyWithOptions: number;
  onceOffWithOptions: number;
};

function sum(lines: readonly TotalsLine[], kind: TotalsLine["lineKind"], billing: string): number {
  return lines
    .filter((l) => l.lineKind === kind && l.billing === billing)
    .reduce((total, l) => total + (l.amountCents ?? 0), 0);
}

/** Everything is whole cents. Optional add-ons are never part of `monthly` or `onceOff`. */
export function quoteTotals(lines: readonly TotalsLine[]): QuoteTotals {
  const monthly = sum(lines, "PRICED", "MONTHLY");
  const onceOff = sum(lines, "PRICED", "ONCE_OFF");
  const optionalMonthly = sum(lines, "OPTIONAL", "MONTHLY");
  const optionalOnceOff = sum(lines, "OPTIONAL", "ONCE_OFF");
  return {
    monthly,
    onceOff,
    optionalMonthly,
    optionalOnceOff,
    monthlyWithOptions: monthly + optionalMonthly,
    onceOffWithOptions: onceOff + optionalOnceOff,
  };
}

/** After acceptance: the priced lines plus the optional add-ons the client actually chose. */
export function acceptedTotals(lines: readonly TotalsLine[]): { monthly: number; onceOff: number } {
  const counted = lines.map((l) =>
    l.lineKind === "OPTIONAL" ? (l.chosen ? { ...l, lineKind: "PRICED" as const } : l) : l,
  );
  const totals = quoteTotals(counted);
  return { monthly: totals.monthly, onceOff: totals.onceOff };
}

/**
 * Money is always whole cents (an integer). Never store or calculate with decimals:
 * 0.1 + 0.2 is not 0.3 in a computer, and invoices must add up exactly.
 */
export type Cents = number;

function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Money must be whole cents, got ${value}`);
  }
}

/**
 * Turns "1234.56", "1,234.56" or "R1,234.56" into 123456 cents.
 * Rejects anything with more than two decimals instead of silently rounding it.
 */
export function randToCents(input: string): Cents {
  const cleaned = input.trim().replace(/^R\s*/i, "").replace(/,/g, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new Error(`"${input}" is not a valid amount in rand`);
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  assertCents(cents);
  return sign === "-" ? -cents : cents;
}

/** 123456 becomes "R1,234.56" (South African house style used across ACE documents). */
export function formatZAR(cents: Cents): string {
  assertCents(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R${whole}.${fraction}`;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce<Cents>((total, value) => {
    assertCents(value);
    return total + value;
  }, 0);
}

export type VatSettings = {
  vatEnabled: boolean;
  /** Basis points: 1500 = 15%. Ignored while vatEnabled is false. */
  vatRateBps: number;
};

export type Totals = { subtotal: Cents; vat: Cents; total: Cents };

/**
 * Totals for a document. ACE is not VAT registered, so with vatEnabled false the VAT is
 * always exactly zero and total equals subtotal. The VAT path exists so that registering
 * later is a settings change, not a rebuild.
 */
export function computeTotals(lineAmounts: readonly Cents[], settings: VatSettings): Totals {
  const subtotal = sumCents(lineAmounts);
  if (!settings.vatEnabled) {
    return { subtotal, vat: 0, total: subtotal };
  }
  if (!Number.isInteger(settings.vatRateBps) || settings.vatRateBps < 0) {
    throw new Error("vatRateBps must be a non-negative whole number of basis points");
  }
  const vat = Math.round((subtotal * settings.vatRateBps) / 10_000);
  return { subtotal, vat, total: subtotal + vat };
}

"use client";

import {
  BILLING_LABELS,
  FREQUENCY_LABELS,
  LINE_KIND_LABELS,
  LINE_KINDS,
  LINE_BILLINGS,
  MAX_LINES,
  bulletLines,
  formatZAR,
  quoteTotals,
} from "@ace/core/client";
import { inputClass } from "@/components/auth-card";
import {
  amountProblem,
  blankLine,
  parseAmount,
  withBilling,
  withKind,
  type Billing,
  type BuilderLine,
  type BuilderScope,
  type Frequency,
  type LineKind,
} from "./builder-types";

const buttonSmall =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-forest/30 px-3 text-sm font-semibold text-forest transition-colors hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest";

export function Chips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 rounded-full px-4 text-sm font-semibold ring-1 transition-colors ${
            value === o.value
              ? "bg-forest text-cream ring-forest"
              : "bg-white text-forest ring-charcoal/20 hover:bg-cream"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- step 1: scope ------------------------------------------------------------------------------

export function ScopeStep({
  scope,
  onToggle,
}: {
  scope: BuilderScope[];
  onToggle: (serviceId: string) => void;
}) {
  return (
    <div>
      <p className="text-sm text-charcoal/70">
        Switch on every service the client asked for. Anything left off prints as &quot;Not
        included, quoted separately on request&quot;.
      </p>
      <ul className="mt-4 space-y-3">
        {scope.map((s) => (
          <li
            key={s.serviceId}
            className={`rounded-2xl p-4 ring-1 ${
              s.included ? "bg-forest/5 ring-forest/30" : "bg-white/70 ring-charcoal/10"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold text-forest">
                  {s.name}
                  {s.kind === "OPTIONAL_EXTRA" ? (
                    <span className="ml-2 rounded-full bg-ochre/15 px-2.5 py-1 text-xs font-semibold text-ochre">
                      Optional extra
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-charcoal/60">
                  {s.included ? "Included" : "Not included, quoted separately on request"}
                </p>
                {bulletLines(s.description).length > 0 ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-charcoal/80">
                    {bulletLines(s.description).map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={s.included}
                aria-label={`${s.name}: ${s.included ? "included" : "not included"}`}
                onClick={() => onToggle(s.serviceId)}
                className={`relative h-10 w-16 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
                  s.included ? "bg-forest" : "bg-charcoal/25"
                }`}
              >
                <span
                  className={`absolute top-1 h-8 w-8 rounded-full bg-white shadow transition-all ${
                    s.included ? "left-9" : "left-1"
                  }`}
                />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- step 2: price lines ------------------------------------------------------------------------

const KIND_OPTIONS = LINE_KINDS.map((k) => ({ value: k, label: LINE_KIND_LABELS[k] }));
const BILLING_OPTIONS = LINE_BILLINGS.map((b) => ({ value: b, label: BILLING_LABELS[b] }));

function frequencyOptions(line: BuilderLine): { value: Frequency; label: string }[] {
  const all: Frequency[] =
    line.lineKind === "OPTIONAL"
      ? ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "AS_REQUIRED"]
      : ["WEEKLY", "FORTNIGHTLY", "MONTHLY"];
  return all.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] }));
}

export function LinesStep({
  lines,
  suggestMonthly,
  onChange,
}: {
  lines: BuilderLine[];
  suggestMonthly: boolean;
  onChange: (lines: BuilderLine[]) => void;
}) {
  const update = (index: number, next: BuilderLine) =>
    onChange(lines.map((l, i) => (i === index ? next : l)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= lines.length) return;
    const copy = [...lines];
    const a = copy[index];
    const b = copy[target];
    if (!a || !b) return;
    copy[index] = b;
    copy[target] = a;
    onChange(copy);
  };

  return (
    <div>
      <p className="text-sm text-charcoal/70">
        One combined price for the standard services, and a separate line for anything optional,
        such as weed treatment.
      </p>

      {suggestMonthly && lines.length < MAX_LINES ? (
        <div className="mt-4 rounded-xl bg-ochre/10 p-4 ring-1 ring-ochre/30">
          <p className="text-sm text-charcoal">
            You have services switched on but no monthly price yet.
          </p>
          <button
            type="button"
            className={`${buttonSmall} mt-2`}
            onClick={() =>
              onChange([
                ...lines,
                blankLine({ description: "Garden maintenance, as per scope", frequency: "WEEKLY" }),
              ])
            }
          >
            Add the monthly line
          </button>
        </div>
      ) : null}

      <ul className="mt-4 space-y-4">
        {lines.map((l, index) => {
          const problem = amountProblem(l.amountText);
          return (
            <li
              key={l.key}
              className="space-y-3 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-charcoal/50">
                Line {index + 1}
              </p>
              <Chips<LineKind>
                label={`Line ${index + 1} type`}
                value={l.lineKind}
                options={KIND_OPTIONS}
                onChange={(k) => update(index, withKind(l, k))}
              />
              {l.lineKind !== "INCLUDED" ? (
                <Chips<Billing>
                  label={`Line ${index + 1} billing`}
                  value={l.billing}
                  options={BILLING_OPTIONS}
                  onChange={(b) => update(index, withBilling(l, b))}
                />
              ) : null}
              {l.lineKind !== "INCLUDED" && l.billing === "MONTHLY" ? (
                <Chips<Frequency>
                  label={`Line ${index + 1} how often`}
                  value={l.frequency}
                  options={frequencyOptions(l)}
                  onChange={(f) => update(index, { ...l, frequency: f })}
                />
              ) : null}
              <div>
                <label className="block text-sm font-medium text-charcoal">
                  Description
                  <input
                    value={l.description}
                    maxLength={300}
                    aria-describedby={`line-description-hint-${l.key}`}
                    onChange={(e) => update(index, { ...l, description: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <p id={`line-description-hint-${l.key}`} className="mt-1 text-xs text-charcoal/60">
                  No personal details here (names, phone numbers, addresses).
                </p>
              </div>
              {l.lineKind !== "INCLUDED" ? (
                <label className="block text-sm font-medium text-charcoal">
                  Amount (R)
                  <input
                    value={l.amountText}
                    inputMode="decimal"
                    onChange={(e) => update(index, { ...l, amountText: e.target.value })}
                    aria-invalid={problem ? true : undefined}
                    className={inputClass}
                  />
                  {problem ? (
                    <span role="alert" className="mt-1 block text-xs font-normal text-red-700">
                      {problem}
                    </span>
                  ) : (
                    <span className="mt-1 block text-xs font-normal text-charcoal/60">
                      {l.billing === "MONTHLY" ? "Per month. " : ""}e.g. 850 or 1150.50
                    </span>
                  )}
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonSmall}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`Move line ${index + 1} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={buttonSmall}
                  disabled={index === lines.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`Move line ${index + 1} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={buttonSmall}
                  onClick={() => onChange(lines.filter((_, i) => i !== index))}
                  aria-label={`Remove line ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className={`${buttonSmall} mt-4`}
        disabled={lines.length >= MAX_LINES}
        onClick={() => onChange([...lines, blankLine()])}
      >
        Add price line
      </button>
      {lines.length >= MAX_LINES ? (
        <p className="mt-2 text-sm text-charcoal/70">You can add up to {MAX_LINES} price lines.</p>
      ) : null}
    </div>
  );
}

// --- step 3: details ----------------------------------------------------------------------------

export function DetailsStep({
  validUntil,
  internalNote,
  today,
  onValidUntil,
  onNote,
}: {
  validUntil: string;
  internalNote: string;
  today: string;
  onValidUntil: (value: string) => void;
  onNote: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-charcoal">
        Valid until
        <input
          type="date"
          value={validUntil}
          min={today}
          onChange={(e) => onValidUntil(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className="block text-sm font-medium text-charcoal">
        Internal note
        <textarea
          value={internalNote}
          rows={4}
          maxLength={2000}
          onChange={(e) => onNote(e.target.value)}
          className={inputClass}
        />
        <span className="mt-1 block text-xs font-normal text-charcoal/60">
          For staff only. The client never sees this.
        </span>
      </label>
    </div>
  );
}

// --- step 4 helper: the totals line -------------------------------------------------------------

export function TotalsSummary({ lines }: { lines: BuilderLine[] }) {
  const totals = quoteTotals(
    lines.map((l) => ({
      lineKind: l.lineKind,
      billing: l.billing,
      amountCents: parseAmount(l.amountText),
    })),
  );
  return (
    <dl className="grid gap-2 rounded-xl bg-forest/5 p-4 text-sm ring-1 ring-forest/15 sm:grid-cols-2">
      <div>
        <dt className="text-charcoal/60">Monthly total</dt>
        <dd className="font-semibold text-forest">{formatZAR(totals.monthly)}</dd>
      </div>
      <div>
        <dt className="text-charcoal/60">Once-off total</dt>
        <dd className="font-semibold text-forest">{formatZAR(totals.onceOff)}</dd>
      </div>
      {totals.optionalMonthly > 0 ? (
        <div>
          <dt className="text-charcoal/60">Monthly with optional add-ons</dt>
          <dd className="font-semibold text-forest">{formatZAR(totals.monthlyWithOptions)}</dd>
        </div>
      ) : null}
      {totals.optionalOnceOff > 0 ? (
        <div>
          <dt className="text-charcoal/60">Once-off with optional add-ons</dt>
          <dd className="font-semibold text-forest">{formatZAR(totals.onceOffWithOptions)}</dd>
        </div>
      ) : null}
    </dl>
  );
}

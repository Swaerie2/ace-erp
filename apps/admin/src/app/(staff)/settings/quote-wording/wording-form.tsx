"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { FormMessage } from "@/components/form";
import { saveWordingAction } from "./actions";

type Clause = { heading: string; body: string };
export type WordingValues = {
  tagline: string;
  standardExclusions: string[];
  monthlyTerms: Clause[];
  onceOffTerms: Clause[];
  commonTerms: Clause[];
  everyVisitPoints: string[];
  defaultValidityDays: number;
  registrationNumber: string;
  phone: string;
  email: string;
  website: string;
};

const small =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-forest/30 px-3 text-sm font-semibold text-forest hover:bg-forest hover:text-cream disabled:opacity-40";

function ClauseEditor({
  title,
  hint,
  clauses,
  onChange,
}: {
  title: string;
  hint: string;
  clauses: Clause[];
  onChange: (next: Clause[]) => void;
}) {
  const move = (i: number, d: number) => {
    const t = i + d;
    const a = clauses[i];
    const b = clauses[t];
    if (!a || !b) return;
    const copy = [...clauses];
    copy[i] = b;
    copy[t] = a;
    onChange(copy);
  };
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-forest">{title}</h2>
      <p className="text-sm text-charcoal/70">{hint}</p>
      <ul className="space-y-3">
        {clauses.map((c, i) => (
          <li key={i} className="space-y-2 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10">
            <p className="text-sm font-semibold text-forest">Item {i + 1}</p>
            <label className="block text-sm font-medium text-charcoal">
              Heading
              <input
                aria-label={`${title} item ${i + 1} heading`}
                value={c.heading}
                maxLength={80}
                onChange={(e) =>
                  onChange(clauses.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)))
                }
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium text-charcoal">
              Wording
              <textarea
                aria-label={`${title} item ${i + 1} wording`}
                value={c.body}
                rows={4}
                maxLength={1500}
                onChange={(e) =>
                  onChange(clauses.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))
                }
                className={inputClass}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={small}
                disabled={i === 0}
                onClick={() => move(i, -1)}
                aria-label={`Move ${title} item ${i + 1} up`}
              >
                ↑
              </button>
              <button
                type="button"
                className={small}
                disabled={i === clauses.length - 1}
                onClick={() => move(i, 1)}
                aria-label={`Move ${title} item ${i + 1} down`}
              >
                ↓
              </button>
              <button
                type="button"
                className={small}
                onClick={() => onChange(clauses.filter((_, j) => j !== i))}
                aria-label={`Remove ${title} item ${i + 1}`}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={small}
        onClick={() => onChange([...clauses, { heading: "", body: "" }])}
      >
        Add clause
      </button>
    </section>
  );
}

export function WordingForm({
  initial,
  saved = false,
}: {
  initial: WordingValues;
  /** The page was opened right after a save. */
  saved?: boolean;
}) {
  const [state, action, pending] = useActionState(saveWordingAction, undefined);
  const [v, setV] = useState({
    ...initial,
    exclusionsText: initial.standardExclusions.join("\n"),
    pointsText: initial.everyVisitPoints.join("\n"),
    validityText: String(initial.defaultValidityDays),
  });
  // "Wording saved." is driven by the address, so it goes once something is edited or refused.
  const [edited, setEdited] = useState(false);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => {
    setEdited(true);
    setV((prev) => ({ ...prev, [key]: value }));
  };

  const payload = useMemo(
    () =>
      JSON.stringify({
        tagline: v.tagline,
        standardExclusions: v.exclusionsText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
        monthlyTerms: v.monthlyTerms,
        onceOffTerms: v.onceOffTerms,
        commonTerms: v.commonTerms,
        everyVisitPoints: v.pointsText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean),
        defaultValidityDays: Number(v.validityText),
        registrationNumber: v.registrationNumber,
        phone: v.phone,
        email: v.email,
        website: v.website,
      }),
    [v],
  );

  const field = (
    label: string,
    key: "tagline" | "registrationNumber" | "phone" | "email" | "website",
    max: number,
  ) => (
    <label className="block text-sm font-medium text-charcoal">
      {label}
      <input
        value={v[key]}
        maxLength={max}
        onChange={(e) => set(key, e.target.value)}
        className={inputClass}
      />
    </label>
  );

  return (
    <form action={action} className="mt-6 space-y-8">
      <input type="hidden" name="payload" value={payload} />
      {saved && !edited && !state?.error ? (
        <p role="status" className="rounded-lg bg-forest/10 px-3 py-2 text-sm text-forest">
          Wording saved.
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold text-forest">Basics</h2>
        {field("Tagline", "tagline", 120)}
        <label className="block text-sm font-medium text-charcoal">
          Default days a quote is valid
          <input
            value={v.validityText}
            inputMode="numeric"
            onChange={(e) => set("validityText", e.target.value)}
            className={inputClass}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("Registration number", "registrationNumber", 60)}
          {field("Phone", "phone", 40)}
          {field("Email", "email", 120)}
          {field("Website", "website", 120)}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-forest">Standard exclusions</h2>
        <p className="text-sm text-charcoal/70">
          One per line. Printed under &quot;Not included&quot; on every quote.
        </p>
        <textarea
          value={v.exclusionsText}
          rows={5}
          onChange={(e) => set("exclusionsText", e.target.value)}
          className={inputClass}
          aria-label="Standard exclusions"
        />
      </section>

      <ClauseEditor
        title="Monthly contract terms"
        hint="Printed when a quote has monthly work."
        clauses={v.monthlyTerms}
        onChange={(c) => set("monthlyTerms", c)}
      />
      <ClauseEditor
        title="Once-off terms"
        hint="Printed when a quote has once-off work."
        clauses={v.onceOffTerms}
        onChange={(c) => set("onceOffTerms", c)}
      />
      <ClauseEditor
        title="General terms"
        hint="Printed on every quote."
        clauses={v.commonTerms}
        onChange={(c) => set("commonTerms", c)}
      />

      <section className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-forest">Every visit on record</h2>
        <p className="text-sm text-charcoal/70">
          One per line. Leave it empty to leave this block off quotes.
        </p>
        <textarea
          value={v.pointsText}
          rows={7}
          onChange={(e) => set("pointsText", e.target.value)}
          className={inputClass}
          aria-label="Every visit on record"
        />
      </section>

      <FormMessage error={state?.error} />
      <div className="flex gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Saving…" : "Save wording"}
        </button>
        <Link
          href="/quotes"
          className="inline-flex min-h-10 items-center self-center text-sm text-forest hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

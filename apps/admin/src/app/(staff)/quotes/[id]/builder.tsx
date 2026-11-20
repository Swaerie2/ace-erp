"use client";

import { buildQuoteDocument, snapshotWording, validateForIssue } from "@ace/core/client";
import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buttonClass } from "@/components/auth-card";
import { formatDate } from "@/lib/format";
import { deleteDraftAction, issueQuoteAction, saveDraftAction } from "../actions";
import {
  blankLine,
  parseAmount,
  toPayload,
  type BuilderInitial,
  type BuilderState,
} from "./builder-types";
import { DetailsStep, LinesStep, ScopeStep, TotalsSummary } from "./builder-parts";
import { QuoteDocumentView } from "./quote-document";

const STEPS = ["Scope", "Prices", "Details", "Review"] as const;

export function QuoteBuilder({ initial }: { initial: BuilderInitial }) {
  const [state, setState] = useState<BuilderState>(initial.state);
  const [step, setStep] = useState(0);
  const [fault, setFault] = useState<null | "error" | "conflict">(null);

  const payload = useMemo(() => toPayload(state), [state]);
  const payloadKey = useMemo(() => JSON.stringify(payload), [payload]);
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(toPayload(initial.state)));
  const dirty = payloadKey !== savedKey;

  // Refs hold what the async save needs to see at the moment it runs.
  const latest = useRef({ key: payloadKey, payload });
  const savedRef = useRef(savedKey);
  const version = useRef(initial.version);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const stopped = useRef(false);
  useEffect(() => {
    latest.current = { key: payloadKey, payload };
  }, [payloadKey, payload]);

  /** Saves the newest draft after any save already in flight. Never two requests at once. */
  const run = useCallback((): Promise<void> => {
    chain.current = chain.current.then(async () => {
      if (stopped.current) return;
      const { key, payload: body } = latest.current;
      if (key === savedRef.current) return;
      try {
        const result = await saveDraftAction(
          initial.id,
          JSON.stringify({ ...body, version: version.current }),
        );
        if (result.ok) {
          version.current = result.version;
          savedRef.current = key;
          setSavedKey(key);
          setFault(null);
        } else if (result.conflict) {
          stopped.current = true;
          setFault("conflict");
        } else {
          setFault("error");
        }
      } catch {
        setFault("error");
      }
    });
    return chain.current;
  }, [initial.id]);

  // Save about 800 ms after the last change (and again if more changes arrived during a save).
  useEffect(() => {
    if (!dirty || fault === "conflict") return;
    const timer = setTimeout(() => void run(), 800);
    return () => clearTimeout(timer);
  }, [dirty, payloadKey, savedKey, fault, run]);

  // After a failed save, try again every 5 seconds.
  useEffect(() => {
    if (fault !== "error") return;
    const timer = setTimeout(() => void run(), 5000);
    return () => clearTimeout(timer);
  }, [fault, run]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty && !fault) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, fault]);

  // --- finishing ---------------------------------------------------------------------------------
  const [issueState, issueAction, issuing] = useActionState(issueQuoteAction, undefined);
  const issueForm = useRef<HTMLFormElement>(null);
  async function finish() {
    await run();
    if (stopped.current) return;
    issueForm.current?.requestSubmit();
  }

  // --- derived values for the screen -------------------------------------------------------------
  const lineInputs = useMemo(
    () =>
      state.lines.map((l) => ({
        id: l.key,
        lineKind: l.lineKind,
        billing: l.billing,
        frequency: l.frequency,
        description: l.description.trim(),
        amountCents: parseAmount(l.amountText),
        chosen: false,
      })),
    [state.lines],
  );
  const problems = useMemo(
    () =>
      validateForIssue(
        { validUntil: state.validUntil, scope: state.scope, lines: lineInputs },
        initial.today,
      ),
    [state.validUntil, state.scope, lineInputs, initial.today],
  );
  const doc = useMemo(() => {
    const date = new Date(`${state.validUntil}T00:00:00Z`);
    return buildQuoteDocument({
      status: "DRAFT",
      reference: null,
      issuedDate: null,
      validUntil: Number.isNaN(date.getTime()) ? "" : formatDate(date),
      preparedFor: initial.preparedFor,
      scope: state.scope.map((s) => ({
        name: s.name,
        description: s.description,
        kind: s.kind,
        included: s.included,
      })),
      lines: lineInputs,
      wording: snapshotWording(initial.wording, lineInputs, initial.org),
    });
  }, [
    state.validUntil,
    state.scope,
    lineInputs,
    initial.preparedFor,
    initial.wording,
    initial.org,
  ]);

  const suggestMonthly =
    state.scope.some((s) => s.included && s.kind === "CORE") &&
    !state.lines.some((l) => l.lineKind === "PRICED" && l.billing === "MONTHLY");

  function toggleService(serviceId: string) {
    setState((prev) => {
      const target = prev.scope.find((s) => s.serviceId === serviceId);
      if (!target) return prev;
      const nowIncluded = !target.included;
      const scope = prev.scope.map((s) =>
        s.serviceId === serviceId ? { ...s, included: nowIncluded } : s,
      );
      // Switching on an optional extra suggests an optional price line for it (once).
      const alreadyThere = prev.lines.some(
        (l) => l.lineKind === "OPTIONAL" && l.description === target.name,
      );
      const lines =
        nowIncluded && target.kind === "OPTIONAL_EXTRA" && !alreadyThere
          ? [
              ...prev.lines,
              blankLine({
                lineKind: "OPTIONAL",
                frequency: "AS_REQUIRED",
                description: target.name,
              }),
            ]
          : prev.lines;
      return { ...prev, scope, lines };
    });
  }

  const status =
    fault === "conflict"
      ? "Changed on another device. Reload the page."
      : fault === "error"
        ? "Could not save, retrying…"
        : dirty
          ? "Saving…"
          : "Saved";

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/quotes"
        className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
      >
        ← Quotes
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Draft quote</h1>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm font-semibold ${fault ? "text-red-700" : "text-charcoal/60"}`}
        >
          {status}
        </p>
      </div>
      <p className="mt-1 text-charcoal">
        {initial.customerName}
        <span className="text-charcoal/60"> · {initial.siteLabel}</span>
      </p>
      {initial.revisionOfReference ? (
        <p className="mt-1 text-sm text-charcoal/60">
          Revision of {initial.revisionOfReference}. It keeps that number when issued.
        </p>
      ) : null}
      {initial.property.lawnSizeSqm || initial.property.accessNotes ? (
        <details className="mt-3 rounded-xl bg-white/70 p-3 text-sm ring-1 ring-charcoal/10">
          <summary className="min-h-10 cursor-pointer py-2 font-semibold text-forest">
            Property notes (staff only)
          </summary>
          <p className="text-charcoal/80">
            {initial.property.lawnSizeSqm ? `Lawn: ${initial.property.lawnSizeSqm} m². ` : ""}
            {initial.property.accessNotes ? `Access: ${initial.property.accessNotes}` : ""}
          </p>
        </details>
      ) : null}

      {fault === "conflict" ? (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
        >
          This quote was changed somewhere else, so saving has stopped to protect that version.{" "}
          <a href="" className="font-semibold underline">
            Reload the page
          </a>{" "}
          to see the latest.
        </p>
      ) : null}

      <nav
        aria-label="Quote steps"
        className="sticky top-0 z-10 -mx-4 mt-4 flex gap-1 overflow-x-auto bg-cream/95 px-4 py-2 backdrop-blur"
      >
        {STEPS.map((name, index) => (
          <button
            key={name}
            type="button"
            onClick={() => setStep(index)}
            aria-current={index === step ? "step" : undefined}
            className={`min-h-10 whitespace-nowrap rounded-full px-4 text-sm font-semibold ring-1 ${
              index === step
                ? "bg-forest text-cream ring-forest"
                : "bg-white text-forest ring-charcoal/20"
            }`}
          >
            {index + 1}. {name}
          </button>
        ))}
      </nav>

      <div className="mt-4">
        {step === 0 ? <ScopeStep scope={state.scope} onToggle={toggleService} /> : null}
        {step === 1 ? (
          <LinesStep
            lines={state.lines}
            suggestMonthly={suggestMonthly}
            onChange={(lines) => setState((prev) => ({ ...prev, lines }))}
          />
        ) : null}
        {step === 2 ? (
          <DetailsStep
            validUntil={state.validUntil}
            internalNote={state.internalNote}
            today={initial.today}
            onValidUntil={(validUntil) => setState((prev) => ({ ...prev, validUntil }))}
            onNote={(internalNote) => setState((prev) => ({ ...prev, internalNote }))}
          />
        ) : null}
        {step === 3 ? (
          <div className="space-y-4">
            <TotalsSummary lines={state.lines} />
            {problems.length > 0 ? (
              <div
                role="status"
                className="rounded-xl bg-ochre/10 p-4 text-sm ring-1 ring-ochre/30"
              >
                <p className="font-semibold text-charcoal">Before this can be issued:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-charcoal/80">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="rounded-xl bg-forest/5 p-4 text-sm font-semibold text-forest ring-1 ring-forest/20">
                Ready to issue.
              </p>
            )}
            <QuoteDocumentView doc={doc} />
            {issueState?.error ? (
              <p
                role="alert"
                className="whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
              >
                {issueState.error}
              </p>
            ) : null}
            <form ref={issueForm} action={issueAction}>
              <input type="hidden" name="id" value={initial.id} />
            </form>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={problems.length > 0 || issuing || fault === "conflict"}
              className={buttonClass}
            >
              {issuing ? "Issuing…" : "Finish and issue"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="min-h-10 rounded-full border border-forest/30 px-5 text-sm font-semibold text-forest disabled:opacity-40"
        >
          Back
        </button>
        <button
          type="button"
          disabled={step === STEPS.length - 1}
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          className="min-h-10 rounded-full bg-forest px-5 text-sm font-semibold text-cream disabled:opacity-40"
        >
          Next
        </button>
      </div>

      <form
        action={deleteDraftAction}
        className="mt-10 border-t border-charcoal/10 pt-4"
        onSubmit={(e) => {
          if (!window.confirm("Delete this draft quote? This cannot be undone."))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={initial.id} />
        <button type="submit" className="min-h-10 text-sm font-semibold text-red-700 underline">
          Delete this draft
        </button>
      </form>
    </div>
  );
}

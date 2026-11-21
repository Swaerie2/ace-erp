"use client";

import { useActionState, useRef } from "react";
import { buttonClass, inputClass } from "@/components/auth-card";
import { FormMessage, secondaryButtonClass } from "@/components/form";
import { useFocusOnFeedback } from "@ace/ui/use-focus-on-feedback";
import { commitImportAction, previewImportAction, type ImportState } from "./actions";

type Preview = NonNullable<NonNullable<ImportState>["preview"]>;

export function ImportForm() {
  const [previewState, previewAction, previewing] = useActionState(previewImportAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, previewState?.nonce);
  const preview = previewState?.preview;

  return (
    <div className="mt-6 space-y-8">
      <form ref={formRef} action={previewAction} className="space-y-4">
        <label className="block text-sm font-medium text-charcoal">
          CSV file
          <input type="file" name="file" accept=".csv,text/csv" required className={inputClass} />
        </label>
        <FormMessage error={previewState?.error} />
        <button type="submit" disabled={previewing} className={secondaryButtonClass}>
          {previewing ? "Checking…" : "Preview"}
        </button>
      </form>

      <div aria-live="polite">
        {preview ? (
          <PreviewResult
            // A fresh preview starts a fresh confirm form (no stale error from the last one).
            key={previewState?.nonce}
            preview={preview}
            fileName={previewState?.fileName ?? ""}
            checking={previewing}
            rowsJson={previewState?.rowsJson ?? ""}
            linesJson={previewState?.linesJson ?? ""}
          />
        ) : null}
      </div>
    </div>
  );
}

function PreviewResult({
  preview,
  fileName,
  checking,
  rowsJson,
  linesJson,
}: {
  preview: Preview;
  fileName: string;
  /** A new preview is being made; this one is about to be replaced. */
  checking: boolean;
  rowsJson: string;
  linesJson: string;
}) {
  const [commitState, commitAction, committing] = useActionState(commitImportAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusOnFeedback(formRef, commitState?.nonce);

  return (
    <section className="space-y-5 rounded-2xl bg-white/70 p-5 ring-1 ring-charcoal/10">
      <div>
        <h2 className="font-display text-lg font-semibold text-forest">Preview</h2>
        {fileName ? (
          <p className="mt-1 break-words text-xs text-charcoal/60">
            Preview of {fileName}. Add imports exactly this preview, not a newly chosen file.
          </p>
        ) : null}
      </div>
      <p className="text-sm">
        <strong>{preview.createCount}</strong> will be added ·{" "}
        <strong>{preview.duplicateCount}</strong> skipped as{" "}
        {preview.duplicateCount === 1 ? "a duplicate" : "duplicates"} ·{" "}
        <strong>{preview.errorCount}</strong>{" "}
        {preview.errorCount === 1 ? "row has an error" : "rows have errors"} and{" "}
        {preview.errorCount === 1 ? "is" : "are"} skipped
      </p>

      {preview.sample.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold">First customers to be added</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
            {preview.sample.map((s) => (
              <li key={s.line}>
                Row {s.line}: {s.displayName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.duplicates.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-ochre">Skipped as duplicates</h3>
          <p className="mt-1 text-xs text-charcoal/60">
            A row is skipped when its email or phone is already on a customer, or its name and
            address match one.
          </p>
          <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
            {preview.duplicates.map((d) => (
              <li key={d.line}>
                Row {d.line}: {d.displayName} ({d.reason})
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.errors.length > 0 ? (
        <div>
          <h3 className="text-sm font-semibold text-red-800">
            Errors (fix in the file to include these)
          </h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-charcoal/80">
            {preview.errors.map((e) => (
              <li key={e.line}>
                Row {e.line}: {e.errors.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.createCount > 0 ? (
        <form ref={formRef} action={commitAction} className="space-y-3">
          <input type="hidden" name="rowsJson" value={rowsJson} />
          <input type="hidden" name="linesJson" value={linesJson} />
          <FormMessage error={commitState?.error} />
          <button type="submit" disabled={committing || checking} className={buttonClass}>
            {committing
              ? "Importing…"
              : `Add ${preview.createCount} ${preview.createCount === 1 ? "customer" : "customers"}`}
          </button>
        </form>
      ) : (
        <p className="text-sm text-charcoal/60">Nothing to add from this file.</p>
      )}
    </section>
  );
}

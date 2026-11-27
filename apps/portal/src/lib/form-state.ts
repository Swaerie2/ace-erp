export type FormState =
  | {
      error?: string;
      /** A page to continue to when the form cannot be used any more (a plain link next to the error). */
      continueHref?: string;
      fieldErrors?: Record<string, string>;
      /** What was typed, so a refused form does not wipe it. `chosen` is a comma-separated list of ids. */
      values?: Record<string, string>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: number;
    }
  | undefined;

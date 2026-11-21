export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /** What was typed, so a refused form does not wipe it. `chosen` is a comma-separated list of ids. */
      values?: Record<string, string>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: number;
    }
  | undefined;

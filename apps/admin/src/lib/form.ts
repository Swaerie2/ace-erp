import "server-only";
import { DomainError, ForbiddenError, type DuplicateMatch } from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";

export type FormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      /** What was typed, so a failed save does not wipe the form. */
      values?: Record<string, string>;
      /** Changes on every response so the form remounts with `values`. */
      nonce?: number;
      duplicates?: DuplicateMatch[];
    }
  | undefined;

export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** { contact_name: "x" } with prefix "contact_" -> { name: "x" } */
export function withPrefix(values: Record<string, string>, prefix: string): Record<string, string> {
  if (!prefix) return values;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

/** First message for each field, keyed with the prefix the form used. */
export function errorsFrom(error: z.ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, messages] of Object.entries(z.flattenError(error).fieldErrors)) {
    const first = (messages as string[] | undefined)?.[0];
    if (first) out[`${prefix}${field}`] = first;
  }
  return out;
}

/** Turns a failed save into something the form can show. Call from a catch block. */
export function failure(error: unknown, values?: Record<string, string>): FormState {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (error instanceof DomainError)
    return { error: error.message, ...(values ? { values } : {}), nonce: Date.now() };
  throw error;
}

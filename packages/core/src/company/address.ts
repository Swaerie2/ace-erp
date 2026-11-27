import { z } from "zod";
import { isPlainText, SPECIAL_CHARACTERS, type FormParse } from "../invoices/schemas";
import type { CompanyAddressParts } from "./format";

const tooLong = (max: number) => `Keep this under ${max} characters.`;
const part = (max: number) =>
  z.string().trim().max(max, tooLong(max)).refine(isPlainText, SPECIAL_CHARACTERS).default("");

/** The company's physical address. Every part may be blank (a blank address is valid: nothing is printed). */
export const companyAddressSchema = z.object({
  line1: part(120),
  line2: part(120),
  suburb: part(120),
  city: part(120),
  postalCode: part(12),
});
export type CompanyAddressInput = CompanyAddressParts;

export const COMPANY_ADDRESS_FIELDS = ["line1", "line2", "suburb", "city", "postalCode"] as const;

/** The Company profile form: fields `line1`, `line2`, `suburb`, `city`, `postalCode`. */
export function companyAddressInputFromForm(
  values: FormData | Record<string, string>,
): FormParse<CompanyAddressInput> {
  const read = (name: string): string => {
    const v = values instanceof FormData ? values.get(name) : values[name];
    return typeof v === "string" ? v : "";
  };
  const parsed = companyAddressSchema.safeParse(
    Object.fromEntries(COMPANY_ADDRESS_FIELDS.map((f) => [f, read(f)])),
  );
  if (parsed.success) return { ok: true, input: parsed.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}

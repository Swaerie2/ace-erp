import { z } from "zod";

export const SERVICE_KINDS = ["CORE", "OPTIONAL_EXTRA"] as const;
export type ServiceKindValue = (typeof SERVICE_KINDS)[number];

export const SERVICE_KIND_LABELS: Record<ServiceKindValue, string> = {
  CORE: "Core service",
  OPTIONAL_EXTRA: "Optional extra",
};

export const SERVICE_NAME_MAX = 80;
export const SERVICE_DESCRIPTION_MAX = 300;

const tooLong = (max: number) => `Keep this under ${max} characters.`;

/** Form boxes arrive as strings. Both texts are required. */
export const serviceSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(SERVICE_NAME_MAX, tooLong(SERVICE_NAME_MAX)),
  description: z
    .string()
    .trim()
    .min(1, "Enter a description.")
    .max(SERVICE_DESCRIPTION_MAX, tooLong(SERVICE_DESCRIPTION_MAX)),
  kind: z.enum(SERVICE_KINDS, { error: "Choose core service or optional extra." }),
});
export type ServiceInput = z.output<typeof serviceSchema>;

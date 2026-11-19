import { recordAudit } from "../audit";
import { assertRole, MANAGEMENT, OWNER_ONLY, type Actor } from "../customers/access";
import type { Db } from "../db";
import type { Prisma, QuoteWording } from "../generated/prisma/client";
import { stableStringify } from "./content";
import { wordingSchema, type WordingInput } from "./wording-schema";

type WordingStore = Pick<Db, "quoteWording" | "auditLog">;

/** The row's values, checked against the wording rules. */
function parseRow(row: QuoteWording): WordingInput {
  return wordingSchema.parse({
    tagline: row.tagline,
    standardExclusions: row.standardExclusions,
    monthlyTerms: row.monthlyTerms,
    onceOffTerms: row.onceOffTerms,
    commonTerms: row.commonTerms,
    everyVisitPoints: row.everyVisitPoints,
    defaultValidityDays: row.defaultValidityDays,
    registrationNumber: row.registrationNumber,
    phone: row.phone,
    email: row.email,
    website: row.website,
  });
}

/** Reads the one wording row. No role check: for use inside core functions. */
export async function readQuoteWording(
  store: Pick<Db, "quoteWording">,
): Promise<WordingInput & { updatedAt: Date }> {
  const row = await store.quoteWording.findUniqueOrThrow({ where: { id: "singleton" } });
  return { ...parseRow(row), updatedAt: row.updatedAt };
}

export async function getQuoteWording(store: WordingStore, actor: Actor) {
  assertRole(actor, MANAGEMENT);
  return readQuoteWording(store);
}

/** Owner only. Changes apply to future quotes only; issued quotes keep their frozen copy. */
export async function updateQuoteWording(
  store: WordingStore,
  actor: Actor,
  input: WordingInput,
): Promise<void> {
  assertRole(actor, OWNER_ONLY);
  const current = parseRow(
    await store.quoteWording.findUniqueOrThrow({ where: { id: "singleton" } }),
  );
  const changed = (Object.keys(input) as (keyof WordingInput)[]).filter(
    (key) => stableStringify(current[key]) !== stableStringify(input[key]),
  );
  if (changed.length === 0) return;
  await store.quoteWording.update({
    where: { id: "singleton" },
    data: {
      tagline: input.tagline,
      standardExclusions: input.standardExclusions as Prisma.InputJsonValue,
      monthlyTerms: input.monthlyTerms as Prisma.InputJsonValue,
      onceOffTerms: input.onceOffTerms as Prisma.InputJsonValue,
      commonTerms: input.commonTerms as Prisma.InputJsonValue,
      everyVisitPoints: input.everyVisitPoints as Prisma.InputJsonValue,
      defaultValidityDays: input.defaultValidityDays,
      registrationNumber: input.registrationNumber,
      phone: input.phone,
      email: input.email,
      website: input.website,
      updatedById: actor.id,
    },
  });
  await recordAudit(store, {
    actorType: "STAFF",
    actorId: actor.id,
    action: "quote_wording.updated",
    entityType: "quote_wording",
    entityId: "singleton",
    after: { changed },
    ...(actor.ip ? { ip: actor.ip } : {}),
    ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
  });
}

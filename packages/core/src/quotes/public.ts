import { z } from "zod";
import { clientParty } from "../audit";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { formatZAR } from "../money";
import {
  LinkNoLongerValidError,
  QuoteExpiredError,
  QuoteNotIssuedError,
  acceptCore,
  declineCore,
} from "./acceptance";
import { buildQuoteDocument, type QuoteDocument } from "./document";
import { publicViewState, type PublicViewState } from "./public-state";
import {
  ACT_LIMIT,
  VIEW_LIMIT,
  rateBucket,
  windowStartFor,
  type RateKind,
} from "./rate-limit-window";
import {
  displayStatus,
  formatDateSA,
  formatDateTimeSA,
  formatQuoteReference,
  isValidDateString,
  todaySA,
} from "./reference";
import { isLinkTokenShape } from "./token";
import { wordingSnapshotSchema } from "./wording-schema";

/**
 * The only database functions the client portal may call. None takes an Actor (there is no staff session
 * on the portal); each does its own checks. Every database call names its columns, because the portal's
 * database login (`ace_portal`) is granted columns, not tables.
 */
export type PublicStore = Pick<
  Db,
  | "quote"
  | "quoteLine"
  | "quoteScopeItem"
  | "customer"
  | "property"
  | "auditLog"
  | "publicLinkHit"
  | "$queryRaw"
>;

const PUBLIC_QUOTE_SELECT = {
  id: true,
  customerId: true,
  status: true,
  numberYear: true,
  numberSeq: true,
  revision: true,
  validUntil: true,
  issuedAt: true,
  recipientName: true,
  siteLabel: true,
  siteAddress: true,
  wordingSnapshot: true,
  acceptedAt: true,
  acceptedByName: true,
  acceptedStartDate: true,
  declinedAt: true,
  scopeItems: {
    orderBy: { sortOrder: "asc" },
    select: { name: true, description: true, kind: true, included: true },
  },
  lines: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      lineKind: true,
      billing: true,
      frequency: true,
      description: true,
      amountCents: true,
      chosen: true,
    },
  },
} as const satisfies Prisma.QuoteSelect;

export type PublicQuoteResult =
  | { found: false }
  | {
      found: true;
      state: PublicViewState;
      reference: string;
      doc: QuoteDocument;
      optionalLines: { id: string; label: string }[];
      acceptance: {
        name: string | null;
        at: string;
        startDate: string | null;
        chosen: string[];
      } | null;
      declinedAt: string | null;
      newerToken: string | null;
      business: { tradingName: string; phone: string; email: string };
    };

/** Finds a quote by its private code. Wrong, malformed, revoked and draft codes all give `{ found: false }`. */
export async function getPublicQuote(
  store: PublicStore,
  token: string,
  now: Date = new Date(),
): Promise<PublicQuoteResult> {
  if (!isLinkTokenShape(token)) return { found: false };
  const q = await store.quote.findUnique({
    where: { linkToken: token },
    select: PUBLIC_QUOTE_SELECT,
  });
  if (!q) return { found: false };
  const today = todaySA(now);
  const state = publicViewState(q, today);
  if (!state) return { found: false };

  const wording = wordingSnapshotSchema.parse(q.wordingSnapshot);
  const reference = formatQuoteReference(q) ?? "";
  const lines = q.lines.map((l) => ({
    id: l.id,
    lineKind: l.lineKind,
    billing: l.billing,
    frequency: l.frequency,
    description: l.description,
    amountCents: l.amountCents,
    chosen: l.chosen,
  }));
  const doc = buildQuoteDocument({
    status: displayStatus(q, today),
    reference,
    issuedDate: q.issuedAt ? formatDateSA(q.issuedAt) : null,
    validUntil: formatDateSA(q.validUntil),
    // Name and property address only: the email and phone are never read.
    preparedFor: {
      name: q.recipientName ?? "Anonymised customer",
      email: null,
      phone: null,
      siteLabel: q.siteLabel ?? "",
      siteAddress: q.siteAddress ?? "",
    },
    scope: q.scopeItems,
    lines,
    wording,
  });

  let newerToken: string | null = null;
  if (state === "REPLACED" && q.numberYear !== null && q.numberSeq !== null) {
    const newer = await store.quote.findFirst({
      where: {
        numberYear: q.numberYear,
        numberSeq: q.numberSeq,
        revision: { gt: q.revision },
        status: { in: ["ISSUED", "ACCEPTED"] },
        linkToken: { not: null },
      },
      orderBy: { revision: "desc" },
      select: { linkToken: true },
    });
    newerToken = newer?.linkToken ?? null;
  }

  const optionalLines = lines
    .filter((l) => l.lineKind === "OPTIONAL")
    .map((l) => ({
      id: l.id,
      label: `${l.description} (${formatZAR(l.amountCents ?? 0)}${l.billing === "MONTHLY" ? " per month" : ""})`,
    }));

  const acceptance =
    state === "ACCEPTED" && q.acceptedAt
      ? {
          name: q.acceptedByName,
          at: formatDateTimeSA(q.acceptedAt),
          startDate: q.acceptedStartDate ? formatDateSA(q.acceptedStartDate) : null,
          chosen: lines
            .filter((l) => l.lineKind === "OPTIONAL" && l.chosen)
            .map((l) => `${l.description} (${formatZAR(l.amountCents ?? 0)})`),
        }
      : null;

  return {
    found: true,
    state,
    reference,
    doc,
    optionalLines,
    acceptance,
    declinedAt: q.declinedAt ? formatDateTimeSA(q.declinedAt) : null,
    newerToken,
    business: {
      tradingName: wording.business.tradingName,
      phone: wording.business.phone,
      email: wording.business.email,
    },
  };
}

/** Records that the link was opened: first view once, last view every time. Only for a live link. */
export async function recordLinkView(
  store: PublicStore,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  if (!isLinkTokenShape(token)) return;
  const where = {
    linkToken: token,
    status: { in: ["ISSUED", "ACCEPTED", "DECLINED"] },
  } satisfies Prisma.QuoteWhereInput;
  await store.quote.updateMany({
    where: { ...where, firstViewedAt: null },
    data: { firstViewedAt: now },
  });
  await store.quote.updateMany({ where, data: { lastViewedAt: now } });
}

export const linkAcceptSchema = z.object({
  acceptedBy: z
    .string()
    .trim()
    .min(1, "Enter your full name.")
    .max(120, "Keep this to 120 characters or fewer."),
  startDate: z.string().refine(isValidDateString, "Choose a start date."),
  chosenLineIds: z.array(z.uuid()).max(30),
});
export type LinkAcceptInput = z.output<typeof linkAcceptSchema>;

export const linkDeclineSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, "Keep this to 500 characters or fewer.")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});
export type LinkDeclineInput = z.output<typeof linkDeclineSchema>;

export type LinkContext = { ip: string | null; userAgent: string | null };

export type LinkAcceptResult =
  | { outcome: "ACCEPTED"; customerFlag: "PAUSED" | "ARCHIVED" | null }
  | { outcome: "ALREADY_ACCEPTED" }
  | { outcome: "EXPIRED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" };

/** The client accepts on the private link. Call inside a transaction. Plain DomainErrors propagate. */
export async function acceptViaLink(
  store: PublicStore,
  token: string,
  input: LinkAcceptInput,
  ctx: LinkContext,
): Promise<LinkAcceptResult> {
  if (!isLinkTokenShape(token)) return { outcome: "NOT_FOUND" };
  const found = await store.quote.findUnique({
    where: { linkToken: token },
    select: { id: true, customerId: true, status: true },
  });
  if (!found || found.status === "DRAFT") return { outcome: "NOT_FOUND" };
  if (found.status === "ACCEPTED") return { outcome: "ALREADY_ACCEPTED" };
  if (found.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    const { customerFlag } = await acceptCore(
      store,
      {
        audit: clientParty(found.customerId),
        method: "CLIENT_LINK",
        staffId: null,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        expectLinkToken: token,
      },
      found.id,
      input,
    );
    return { outcome: "ACCEPTED", customerFlag };
  } catch (error) {
    if (error instanceof LinkNoLongerValidError) return { outcome: "NOT_FOUND" };
    if (error instanceof QuoteExpiredError) return { outcome: "EXPIRED" };
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "ACCEPTED"
        ? { outcome: "ALREADY_ACCEPTED" }
        : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}

/**
 * The client declines on the private link. Call inside a transaction. The visitor's address and browser
 * are not kept for a decline (only an acceptance is proof), so `_ctx` is accepted for symmetry with
 * `acceptViaLink` and not used.
 */
export async function declineViaLink(
  store: PublicStore,
  token: string,
  input: LinkDeclineInput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for symmetry with acceptViaLink
  _ctx: LinkContext,
): Promise<
  | { outcome: "DECLINED" }
  | { outcome: "ALREADY_DECLINED" }
  | { outcome: "NOT_AVAILABLE" }
  | { outcome: "NOT_FOUND" }
> {
  if (!isLinkTokenShape(token)) return { outcome: "NOT_FOUND" };
  const found = await store.quote.findUnique({
    where: { linkToken: token },
    select: { id: true, customerId: true, status: true },
  });
  if (!found || found.status === "DRAFT") return { outcome: "NOT_FOUND" };
  if (found.status === "DECLINED") return { outcome: "ALREADY_DECLINED" };
  if (found.status !== "ISSUED") return { outcome: "NOT_AVAILABLE" };
  try {
    await declineCore(
      store,
      { audit: clientParty(found.customerId), declinedByClient: true, expectLinkToken: token },
      found.id,
      input,
    );
    return { outcome: "DECLINED" };
  } catch (error) {
    if (error instanceof LinkNoLongerValidError) return { outcome: "NOT_FOUND" };
    if (error instanceof QuoteNotIssuedError) {
      return error.status === "DECLINED"
        ? { outcome: "ALREADY_DECLINED" }
        : { outcome: "NOT_AVAILABLE" };
    }
    throw error;
  }
}

/**
 * Counts one request for this visitor (already hashed) in the current 10-minute window, with one atomic
 * statement, and says whether it is still within the limit. About one call in a hundred also deletes
 * windows older than a day (`opts.cleanup` forces or prevents this, for tests).
 *
 * Call it in its own statement or transaction BEFORE the action transaction (accept or decline). If it
 * ran inside the action transaction, a refused attempt (an error that rolls the transaction back) would
 * roll back its own increment too, so failed attempts would never count towards the limit.
 */
export async function checkRateLimit(
  store: PublicStore,
  kind: RateKind,
  ipHash: string,
  opts: { now?: Date; cleanup?: boolean } = {},
): Promise<{ allowed: boolean }> {
  const now = opts.now ?? new Date();
  const bucket = rateBucket(kind, ipHash);
  const windowStart = windowStartFor(now);
  const rows = await store.$queryRaw<{ count: number }[]>`
    insert into public_link_hits ("bucket", "windowStart", "count") values (${bucket}, ${windowStart}, 1)
    on conflict ("bucket", "windowStart") do update set "count" = public_link_hits."count" + 1
    returning "count"`;
  const count = Number(rows[0]?.count ?? 1);
  if (opts.cleanup ?? Math.random() < 0.01) {
    await store.publicLinkHit.deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
  }
  return { allowed: count <= (kind === "view" ? VIEW_LIMIT : ACT_LIMIT) };
}

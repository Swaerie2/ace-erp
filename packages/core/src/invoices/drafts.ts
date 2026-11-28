import { z } from "zod";
import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { lockCustomer } from "../customers/store";
import type { Prisma } from "../generated/prisma/client";
import { formatQuoteReference, fromDateString, toDateString, todaySA } from "../quotes/reference";
import { NEW_LINE_KINDS, type DraftWarning, type InvoiceDisplayStatus } from "./labels";
import { fitDescription, invoiceDisplayStatus, sumLineCents } from "./money";
import { formatInvoiceReference, parseInvoiceSearch } from "./reference";
import { invoiceDraftSchema, type InvoiceDraftInput } from "./schemas";
import {
  allocatedByInvoice,
  allocatedByPayment,
  billToIdFor,
  INVOICE_MESSAGES,
  InvoiceDraftConflictError,
  lockInvoiceRows,
  logInvoiceEvent,
  type InvoiceStore,
} from "./store";

/** An accepted once-off line: priced, or an optional one the client chose. */
export const ONCE_OFF_ACCEPTED: Prisma.QuoteLineWhereInput = {
  billing: "ONCE_OFF",
  OR: [{ lineKind: "PRICED" }, { lineKind: "OPTIONAL", chosen: true }],
};

const REFRESH = "Refresh the page and try again.";
const DUE_RANGE = "Choose a due date from today up to one year from today.";
const CUSTOMER_NOT_FOUND = "That customer could not be found.";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * The latest due date staff may set: the same day one year from `today` ("YYYY-MM-DD"). From 29 February it is
 * 1 March of the next year.
 */
export function latestDueDate(today: string): string {
  const date = fromDateString(today);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return toDateString(date);
}

/** The customer as invoicing needs it, with an explicit select. Refuses a missing or anonymised customer. */
async function readInvoiceableCustomer(store: InvoiceStore, customerId: string) {
  if (!isUuid(customerId)) throw new DomainError(CUSTOMER_NOT_FOUND);
  const customer = await store.customer.findUnique({
    where: { id: customerId },
    select: { id: true, status: true, anonymisedAt: true, managedById: true, billsToManager: true },
  });
  if (!customer) throw new DomainError(CUSTOMER_NOT_FOUND);
  if (customer.anonymisedAt) {
    throw new DomainError("This customer has been anonymised and cannot be changed.");
  }
  if (customer.status === "ARCHIVED") throw new DomainError(INVOICE_MESSAGES.archived);
  return customer;
}

/** The customer's accepted quotes with once-off work, for the New invoice page. */
export async function listAcceptedOnceOffQuotes(
  store: InvoiceStore,
  actor: Actor,
  customerId: string,
): Promise<
  {
    id: string;
    reference: string;
    propertyLabel: string;
    acceptedAt: Date | null;
    onceOffCents: number;
    alreadyInvoiced: boolean;
  }[]
> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(customerId)) return [];
  const quotes = await store.quote.findMany({
    where: { customerId, status: "ACCEPTED", lines: { some: ONCE_OFF_ACCEPTED } },
    orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      numberYear: true,
      numberSeq: true,
      revision: true,
      acceptedAt: true,
      property: { select: { label: true } },
      lines: { where: ONCE_OFF_ACCEPTED, select: { amountCents: true } },
      invoices: { where: { status: { not: "VOID" } }, select: { id: true } },
    },
  });
  return quotes.map((q) => ({
    id: q.id,
    reference: formatQuoteReference(q) ?? "",
    propertyLabel: q.property.label,
    acceptedAt: q.acceptedAt,
    onceOffCents: q.lines.reduce((t, l) => t + Math.max(0, l.amountCents ?? 0), 0),
    alreadyInvoiced: q.invoices.length > 0,
  }));
}

/**
 * "New invoice" on a customer: a once-off draft, empty or pre-filled from an accepted quote's priced once-off
 * lines and chosen once-off options. Lock: the customer. The due date stays empty (the default applies at issue).
 */
export async function createOnceOffDraft(
  store: InvoiceStore,
  actor: Actor,
  input: { customerId: string; fromQuoteId?: string | null },
): Promise<{ id: string }> {
  assertRole(actor, MANAGEMENT);
  const readQuote = async () => {
    if (!input.fromQuoteId) return null;
    if (!isUuid(input.fromQuoteId)) throw new DomainError(INVOICE_MESSAGES.quoteNotAccepted);
    const quote = await store.quote.findUnique({
      where: { id: input.fromQuoteId },
      select: {
        id: true,
        customerId: true,
        status: true,
        property: { select: { id: true, label: true } },
        lines: {
          where: ONCE_OFF_ACCEPTED,
          orderBy: { sortOrder: "asc" },
          select: { id: true, description: true, amountCents: true },
        },
      },
    });
    if (!quote || quote.customerId !== input.customerId || quote.status !== "ACCEPTED") {
      throw new DomainError(INVOICE_MESSAGES.quoteNotAccepted);
    }
    const lines = quote.lines.filter((l) => (l.amountCents ?? 0) > 0);
    if (lines.length === 0) throw new DomainError(INVOICE_MESSAGES.quoteNoOnceOff);
    const invoiced = await store.invoice.count({
      where: { sourceQuoteId: quote.id, status: { not: "VOID" } },
    });
    if (invoiced > 0) throw new DomainError(INVOICE_MESSAGES.quoteInvoiced);
    return { id: quote.id, property: quote.property, lines };
  };

  // Unlocked look first, then the lock, then the same checks again.
  await readInvoiceableCustomer(store, input.customerId);
  await readQuote();
  await lockCustomer(store, input.customerId);
  const customer = await readInvoiceableCustomer(store, input.customerId);
  const quote = await readQuote();
  const lines = quote
    ? quote.lines.map((l, index) => ({
        sortOrder: index + 1,
        kind: "ONCE_OFF" as const,
        propertyId: quote.property.id,
        description: fitDescription(`${quote.property.label}: ${l.description}`),
        amountCents: l.amountCents ?? 0,
        sourceQuoteLineId: l.id,
      }))
    : [];
  const created = await store.invoice.create({
    data: {
      customerId: customer.id,
      billToCustomerId: billToIdFor(customer),
      kind: "ONCE_OFF",
      createdById: actor.id,
      sourceQuoteId: quote?.id ?? null,
      lines: { create: lines },
    },
    select: { id: true },
  });
  await logInvoiceEvent(store, actor, "invoice.drafted", created.id, {
    kind: "ONCE_OFF",
    fromQuote: quote !== null,
    lineCount: lines.length,
  });
  return created;
}

const DRAFT_SELECT = {
  id: true,
  status: true,
  kind: true,
  customerId: true,
  draftVersion: true,
  dueDate: true,
  lines: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      kind: true,
      description: true,
      amountCents: true,
      propertyId: true,
      sourceQuoteLineId: true,
      forInvoiceId: true,
    },
  },
} as const satisfies Prisma.InvoiceSelect;

/** Runs the draft schema (lengths, amounts, repeated line ids) and lowercases the line ids. */
function parseDraftInput(input: InvoiceDraftInput): InvoiceDraftInput {
  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(parsed.error.issues[0]?.message ?? REFRESH);
  return {
    ...parsed.data,
    lines: parsed.data.lines.map((l) => ({ ...l, id: l.id === null ? null : l.id.toLowerCase() })),
  };
}

/**
 * Saves the whole draft in one go: the due date and every line. Existing lines keep their kind, property,
 * quote line and late-fee target; new lines may be Service, Adjustment or Once-off work. `input.version` must
 * be the version the browser last saw. A save that changes nothing writes nothing. Drafts are not audited.
 * A due date that is changed must be from today (South African date) up to one year from today; a stored one
 * that has passed may stay while other things are edited (issuing refuses it). Lock: the customer, then the
 * invoice.
 */
export async function saveInvoiceDraft(
  store: InvoiceStore,
  actor: Actor,
  id: string,
  rawInput: InvoiceDraftInput,
): Promise<{ version: number }> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) throw new DomainError(INVOICE_MESSAGES.notFound);
  const input = parseDraftInput(rawInput);
  const read = async () => {
    const inv = await store.invoice.findUnique({ where: { id }, select: DRAFT_SELECT });
    if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
    if (inv.status !== "DRAFT") throw new DomainError(INVOICE_MESSAGES.onlyDraftChange);
    if (inv.draftVersion !== input.version) throw new InvoiceDraftConflictError();
    return inv;
  };
  const check = (inv: Awaited<ReturnType<typeof read>>) => {
    if (inv.kind === "MONTHLY" && input.dueDate === null) {
      throw new DomainError("A monthly invoice needs a due date.");
    }
    const storedDue = inv.dueDate ? toDateString(inv.dueDate) : null;
    if (input.dueDate !== null && input.dueDate !== storedDue) {
      const today = todaySA();
      if (input.dueDate < today || input.dueDate > latestDueDate(today)) {
        throw new DomainError(DUE_RANGE);
      }
    }
    const existing = new Map(inv.lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const line of input.lines) {
      if (line.id !== null) {
        const old = existing.get(line.id);
        if (!old || seen.has(line.id) || old.kind !== line.kind) throw new DomainError(REFRESH);
        seen.add(line.id);
      } else if (!NEW_LINE_KINDS.some((k) => k === line.kind)) {
        throw new DomainError("Choose service, adjustment or once-off work for a new line.");
      }
      if (line.amountCents < 0 && line.kind !== "ADJUSTMENT") {
        throw new DomainError("Only an adjustment can be negative.");
      }
    }
    return existing;
  };

  // Look first WITHOUT locking: a save that changes nothing must write nothing.
  const first = await read();
  check(first);
  const firstDue = first.dueDate ? toDateString(first.dueDate) : null;
  const same =
    firstDue === input.dueDate &&
    first.lines.length === input.lines.length &&
    first.lines.every((l, i) => {
      const n = input.lines[i];
      return (
        n !== undefined &&
        n.id === l.id &&
        n.description === l.description &&
        n.amountCents === l.amountCents
      );
    });
  if (same) return { version: first.draftVersion };

  await lockCustomer(store, first.customerId);
  await lockInvoiceRows(store, [id]);
  const existing = check(await read());
  await store.invoiceLine.deleteMany({ where: { invoiceId: id } });
  if (input.lines.length > 0) {
    await store.invoiceLine.createMany({
      data: input.lines.map((l, index) => {
        const old = l.id ? existing.get(l.id) : undefined;
        return {
          invoiceId: id,
          sortOrder: index + 1,
          kind: l.kind,
          description: l.description,
          amountCents: l.amountCents,
          propertyId: old?.propertyId ?? null,
          sourceQuoteLineId: old?.sourceQuoteLineId ?? null,
          forInvoiceId: old?.forInvoiceId ?? null,
        };
      }),
    });
  }
  const updated = await store.invoice.update({
    where: { id },
    data: {
      dueDate: input.dueDate ? fromDateString(input.dueDate) : null,
      draftVersion: { increment: 1 },
    },
    select: { draftVersion: true },
  });
  return { version: updated.draftVersion };
}

/** "Skip": a draft is deleted with its lines. Lock: the customer, then the invoice. */
export async function deleteInvoiceDraft(
  store: InvoiceStore,
  actor: Actor,
  id: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) throw new DomainError(INVOICE_MESSAGES.notFound);
  const read = async () => {
    const inv = await store.invoice.findUnique({
      where: { id },
      select: { status: true, customerId: true },
    });
    if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
    if (inv.status !== "DRAFT") throw new DomainError(INVOICE_MESSAGES.onlyDraftDelete);
    return inv;
  };
  const first = await read();
  await lockCustomer(store, first.customerId);
  await lockInvoiceRows(store, [id]);
  await read();
  // invoice_lines.invoiceId is RESTRICT: the lines go first.
  await store.invoiceLine.deleteMany({ where: { invoiceId: id } });
  await store.invoice.delete({ where: { id }, select: { id: true } });
  await logInvoiceEvent(store, actor, "invoice.deleted_draft", id);
}

const CUSTOMER_BRIEF = { select: { id: true, number: true, displayName: true } } as const;

const VIEW_SELECT = {
  id: true,
  kind: true,
  status: true,
  numberYear: true,
  numberSeq: true,
  serviceMonth: true,
  dueDate: true,
  issuedAt: true,
  createdAt: true,
  draftVersion: true,
  totalCents: true,
  recipientName: true,
  recipientAddress: true,
  emailStatus: true,
  emailedAt: true,
  voidedAt: true,
  voidReason: true,
  sourceQuoteId: true,
  customerId: true,
  billToCustomerId: true,
  customer: {
    select: {
      id: true,
      number: true,
      displayName: true,
      status: true,
      anonymisedAt: true,
      managedById: true,
      billsToManager: true,
    },
  },
  billTo: CUSTOMER_BRIEF,
  sourceQuote: { select: { id: true, numberYear: true, numberSeq: true, revision: true } },
  lines: {
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      kind: true,
      description: true,
      amountCents: true,
      propertyId: true,
      forInvoiceId: true,
    },
  },
  allocations: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      amountCents: true,
      payment: { select: { id: true, receivedOn: true, amountCents: true, voidedAt: true } },
    },
  },
  reports: {
    orderBy: { createdAt: "desc" },
    select: { id: true, paidOn: true, reference: true, status: true, createdAt: true },
  },
} as const satisfies Prisma.InvoiceSelect;

/** One invoice for the staff screen, with its balance and status worked out. Null when there is none. */
export async function getInvoice(store: InvoiceStore, actor: Actor, id: string) {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) return null;
  const row = await store.invoice.findUnique({ where: { id }, select: VIEW_SELECT });
  if (!row) return null;
  const allocatedCents = row.allocations
    .filter((a) => !a.payment.voidedAt)
    .reduce((t, a) => t + a.amountCents, 0);
  const totalCents = row.totalCents ?? sumLineCents(row.lines);
  const dueDateString = row.dueDate ? toDateString(row.dueDate) : null;
  // A draft is addressed as the customer's billing stands now; issuing freezes it.
  const billToNowId = billToIdFor(row.customer);
  const billTo =
    row.status === "DRAFT" && billToNowId !== row.billTo.id
      ? ((await store.customer.findUnique({ where: { id: billToNowId }, ...CUSTOMER_BRIEF })) ??
        row.billTo)
      : row.billTo;
  return {
    ...row,
    billTo,
    reference: formatInvoiceReference(row),
    sourceQuoteReference: row.sourceQuote ? formatQuoteReference(row.sourceQuote) : null,
    totalCents,
    allocatedCents,
    balanceCents: row.status === "ISSUED" ? totalCents - allocatedCents : 0,
    displayStatus: invoiceDisplayStatus(
      { status: row.status, totalCents, allocatedCents, dueDate: dueDateString },
      todaySA(),
    ),
    dueDateString,
    serviceMonthString: row.serviceMonth ? toDateString(row.serviceMonth).slice(0, 7) : null,
  };
}
export type InvoiceView = NonNullable<Awaited<ReturnType<typeof getInvoice>>>;

const LIST_SELECT = {
  id: true,
  kind: true,
  status: true,
  numberYear: true,
  numberSeq: true,
  serviceMonth: true,
  dueDate: true,
  issuedAt: true,
  totalCents: true,
  emailStatus: true,
  customer: CUSTOMER_BRIEF,
  billTo: CUSTOMER_BRIEF,
  lines: { select: { amountCents: true } },
} as const satisfies Prisma.InvoiceSelect;
type ListRow = Prisma.InvoiceGetPayload<{ select: typeof LIST_SELECT }>;

export type InvoiceListItem = {
  id: string;
  reference: string | null;
  kind: "MONTHLY" | "ONCE_OFF";
  status: "DRAFT" | "ISSUED" | "VOID";
  displayStatus: InvoiceDisplayStatus;
  customer: { id: string; number: number; displayName: string };
  billTo: { id: string; number: number; displayName: string };
  serviceMonth: string | null;
  dueDate: string | null;
  issuedAt: Date | null;
  totalCents: number;
  balanceCents: number;
  emailStatus: "NONE" | "SENT" | "FAILED";
};

async function toListItems(store: InvoiceStore, rows: ListRow[]): Promise<InvoiceListItem[]> {
  const allocated = await allocatedByInvoice(
    store,
    rows.filter((r) => r.status === "ISSUED").map((r) => r.id),
  );
  const today = todaySA();
  return rows.map((r) => {
    const totalCents = r.totalCents ?? sumLineCents(r.lines);
    const allocatedCents = allocated.get(r.id) ?? 0;
    const dueDate = r.dueDate ? toDateString(r.dueDate) : null;
    return {
      id: r.id,
      reference: formatInvoiceReference(r),
      kind: r.kind,
      status: r.status,
      displayStatus: invoiceDisplayStatus(
        { status: r.status, totalCents, allocatedCents, dueDate },
        today,
      ),
      customer: r.customer,
      billTo: r.billTo,
      serviceMonth: r.serviceMonth ? toDateString(r.serviceMonth).slice(0, 7) : null,
      dueDate,
      issuedAt: r.issuedAt,
      totalCents,
      balanceCents: r.status === "ISSUED" ? totalCents - allocatedCents : 0,
      emailStatus: r.emailStatus,
    };
  });
}

export const INVOICE_FILTERS = ["DRAFT", "UNPAID", "OVERDUE", "PAID", "VOID"] as const;
export type InvoiceListQuery = {
  status?: string | undefined;
  q?: string | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const whole = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, whole));
}

type MoneyFilter = "UNPAID" | "OVERDUE" | "PAID";

/**
 * The ids of the issued invoices in one money filter, worked out in the database (balances are not stored):
 * paid = money allocated from payments that are not voided. PAID: nothing left owing. OVERDUE: owing and the
 * due date before today (South African date). UNPAID ("Not yet due"): owing and due today or later, or no due
 * date. Void invoices and drafts are never in these. The filter and today are parameters, never spliced in.
 */
async function moneyFilterIds(store: InvoiceStore, filter: MoneyFilter): Promise<string[]> {
  const today = todaySA();
  const rows = await store.$queryRaw<{ id: string }[]>`
    select i."id"::text as "id"
    from "invoices" i
    cross join lateral (
      select
        coalesce(i."totalCents", (
          select coalesce(sum(l."amountCents"), 0) from "invoice_lines" l where l."invoiceId" = i."id"
        ))::bigint as "total",
        (
          select coalesce(sum(a."amountCents"), 0)
          from "payment_allocations" a
          join "payments" p on p."id" = a."paymentId"
          where a."invoiceId" = i."id" and p."voidedAt" is null
        )::bigint as "paid"
    ) m
    where i."status" = 'ISSUED'
      and (
        (${filter}::text = 'PAID' and m."paid" >= m."total")
        or (${filter}::text = 'OVERDUE' and m."paid" < m."total" and i."dueDate" < ${today}::date)
        or (
          ${filter}::text = 'UNPAID' and m."paid" < m."total"
          and (i."dueDate" is null or i."dueDate" >= ${today}::date)
        )
      )`;
  return rows.map((r) => r.id);
}

/**
 * The staff invoice list, newest first, one page at a time. Search, status and the money filters are all done
 * in the database, so paging and `total` cover every invoice (no cap).
 */
export async function listInvoices(
  store: InvoiceStore,
  actor: Actor,
  query: InvoiceListQuery,
): Promise<{ items: InvoiceListItem[]; total: number; page: number; pageSize: number }> {
  assertRole(actor, MANAGEMENT);
  const pageSize = clampInt(query.pageSize, 1, 100, 25);
  const page = clampInt(query.page, 1, 10_000, 1);
  const filter = INVOICE_FILTERS.find((f) => f === query.status);
  const and: Prisma.InvoiceWhereInput[] = [];
  if (filter === "DRAFT") and.push({ status: "DRAFT" });
  else if (filter === "VOID") and.push({ status: "VOID" });
  else if (filter) {
    // Every id that matches (a few thousand at most); the search below and the paging still apply.
    and.push({ status: "ISSUED", id: { in: await moneyFilterIds(store, filter) } });
  }
  const term = query.q?.trim().slice(0, 100);
  if (term) {
    const contains = { contains: term, mode: "insensitive" } as const;
    const or: Prisma.InvoiceWhereInput[] = [
      { customer: { displayName: contains } },
      { billTo: { displayName: contains } },
    ];
    const ref = parseInvoiceSearch(term);
    if (ref) {
      or.push({
        numberSeq: ref.numberSeq,
        ...(ref.numberYear ? { numberYear: ref.numberYear } : {}),
      });
    }
    and.push({ OR: or });
  }
  const where: Prisma.InvoiceWhereInput = { AND: and };
  // One after the other: `store` can be a transaction, which runs one query at a time.
  const total = await store.invoice.count({ where });
  const rows = await store.invoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: LIST_SELECT,
  });
  return { items: await toListItems(store, rows), total, page, pageSize };
}

export type DraftReviewItem = {
  id: string;
  /** The draft version shown, posted back by "Issue all" so a draft saved since is not issued unseen. */
  version: number;
  kind: "MONTHLY" | "ONCE_OFF";
  customer: { id: string; number: number; displayName: string };
  billTo: { id: string; number: number; displayName: string };
  serviceMonth: string | null;
  dueDate: string | null;
  totalCents: number;
  lineCount: number;
  warnings: DraftWarning[];
};

/** Every draft, oldest first, with the warnings the owner should look at before issuing. */
export async function listDraftsForReview(
  store: InvoiceStore,
  actor: Actor,
): Promise<DraftReviewItem[]> {
  assertRole(actor, MANAGEMENT);
  const drafts = await store.invoice.findMany({
    where: { status: "DRAFT" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
    select: {
      id: true,
      draftVersion: true,
      kind: true,
      serviceMonth: true,
      dueDate: true,
      customer: {
        select: {
          id: true,
          number: true,
          displayName: true,
          managedById: true,
          billsToManager: true,
        },
      },
      lines: { select: { kind: true, amountCents: true } },
    },
  });
  const billToIds = [...new Set(drafts.map((d) => billToIdFor(d.customer)))];
  const billTos = await store.customer.findMany({
    where: { id: { in: billToIds } },
    ...CUSTOMER_BRIEF,
  });
  const billToById = new Map(billTos.map((b) => [b.id, b]));
  const withEmail = new Set(
    (
      await store.contact.findMany({
        where: { customerId: { in: billToIds }, receivesInvoices: true, email: { not: null } },
        select: { customerId: true },
      })
    ).map((c) => c.customerId),
  );
  const monthlyCustomerIds = [
    ...new Set(drafts.filter((d) => d.kind === "MONTHLY").map((d) => d.customer.id)),
  ];
  const monthly = await store.invoice.findMany({
    where: { kind: "MONTHLY", status: { not: "VOID" }, customerId: { in: monthlyCustomerIds } },
    select: { id: true, customerId: true, serviceMonth: true },
  });
  return drafts.map((d) => {
    const billToId = billToIdFor(d.customer);
    const warnings: DraftWarning[] = [];
    if (!withEmail.has(billToId)) warnings.push("noEmail");
    if (
      d.kind === "MONTHLY" &&
      d.serviceMonth &&
      !monthly.some(
        (m) =>
          m.customerId === d.customer.id &&
          m.id !== d.id &&
          m.serviceMonth !== null &&
          m.serviceMonth.getTime() < (d.serviceMonth?.getTime() ?? 0),
      )
    ) {
      warnings.push("firstMonth");
    }
    if (d.lines.some((l) => l.kind === "LATE_FEE")) warnings.push("lateFee");
    if (billToId !== d.customer.id) warnings.push("billToAgency");
    return {
      id: d.id,
      version: d.draftVersion,
      kind: d.kind,
      customer: {
        id: d.customer.id,
        number: d.customer.number,
        displayName: d.customer.displayName,
      },
      billTo: billToById.get(billToId) ?? {
        id: d.customer.id,
        number: d.customer.number,
        displayName: d.customer.displayName,
      },
      serviceMonth: d.serviceMonth ? toDateString(d.serviceMonth).slice(0, 7) : null,
      dueDate: d.dueDate ? toDateString(d.dueDate) : null,
      totalCents: sumLineCents(d.lines),
      lineCount: d.lines.length,
      warnings,
    };
  });
}

/**
 * The customer's Invoices tab: invoices for its work or billed to it (latest 100), what it owes as the payer,
 * its unallocated credit, and its latest 50 payments.
 */
export async function listCustomerInvoices(
  store: InvoiceStore,
  actor: Actor,
  customerId: string,
): Promise<{
  items: InvoiceListItem[];
  owedCents: number;
  creditCents: number;
  payments: {
    id: string;
    receivedOn: string;
    amountCents: number;
    reference: string | null;
    voided: boolean;
    unallocatedCents: number;
  }[];
}> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(customerId)) return { items: [], owedCents: 0, creditCents: 0, payments: [] };
  const rows = await store.invoice.findMany({
    where: { OR: [{ customerId }, { billToCustomerId: customerId }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: LIST_SELECT,
  });
  const items = await toListItems(store, rows);
  const open = await store.invoice.findMany({
    where: { billToCustomerId: customerId, status: "ISSUED" },
    select: LIST_SELECT,
  });
  const owedCents = (await toListItems(store, open)).reduce(
    (t, i) => t + Math.max(0, i.balanceCents),
    0,
  );

  const live = await store.payment.findMany({
    where: { payerCustomerId: customerId, voidedAt: null },
    select: { id: true, amountCents: true },
  });
  const allocated = await allocatedByPayment(
    store,
    live.map((p) => p.id),
  );
  const creditCents = live.reduce(
    (t, p) => t + Math.max(0, p.amountCents - (allocated.get(p.id) ?? 0)),
    0,
  );

  const recent = await store.payment.findMany({
    where: { payerCustomerId: customerId },
    orderBy: [{ receivedOn: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: { id: true, receivedOn: true, amountCents: true, reference: true, voidedAt: true },
  });
  const recentAllocated = await allocatedByPayment(
    store,
    recent.map((p) => p.id),
  );
  return {
    items,
    owedCents,
    creditCents,
    payments: recent.map((p) => ({
      id: p.id,
      receivedOn: toDateString(p.receivedOn),
      amountCents: p.amountCents,
      reference: p.reference,
      voided: p.voidedAt !== null,
      unallocatedCents: p.voidedAt ? 0 : p.amountCents - (recentAllocated.get(p.id) ?? 0),
    })),
  };
}

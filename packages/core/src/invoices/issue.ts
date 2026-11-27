import { z } from "zod";
import {
  assertRole,
  DomainError,
  ForbiddenError,
  MANAGEMENT,
  type Actor,
} from "../customers/access";
import type { Db } from "../db";
import type { Prisma } from "../generated/prisma/client";
import type { TxRunner } from "../portal/access";
import { contentHash } from "../quotes/content";
import { addDays, fromDateString, toDateString, todaySA, yearSA } from "../quotes/reference";
import { formatBillingAddress, issueProblems, sumLineCents } from "./money";
import { formatInvoiceReference } from "./reference";
import { bankDetailsReady, reasonSchema } from "./schemas";
import { buildInvoiceSnapshot, readInvoiceSettings } from "./settings";
import {
  allocatedByInvoice,
  billToIdFor,
  INVOICE_MESSAGES,
  InvoiceIssueError,
  lockCustomersInOrder,
  lockInvoiceRows,
  logInvoiceEvent,
  type InvoiceStore,
} from "./store";

/** Ids from the app are checked before they reach a uuid column (a bad one would make Postgres refuse). */
const isUuid = (value: string) => z.uuid().safeParse(value).success;

/**
 * The next invoice number for the year, taken with one atomic statement (no repeats, no gaps). The counter row
 * stays locked until the transaction ends, so call it as late as possible (after every check). No role check:
 * not exported from the barrel.
 */
export async function allocateInvoiceNumber(
  store: Pick<Db, "$queryRaw">,
  year: number,
): Promise<number> {
  const rows = await store.$queryRaw<{ lastSeq: number }[]>`
    insert into invoice_counters ("year", "lastSeq") values (${year}, 1)
    on conflict ("year") do update set "lastSeq" = invoice_counters."lastSeq" + 1
    returning "lastSeq"`;
  const seq = rows[0]?.lastSeq;
  if (seq === undefined) throw new Error("Could not allocate an invoice number.");
  return Number(seq);
}

const ISSUE_SELECT = {
  id: true,
  status: true,
  kind: true,
  customerId: true,
  serviceMonth: true,
  dueDate: true,
  customer: {
    select: {
      id: true,
      status: true,
      anonymisedAt: true,
      managedById: true,
      billsToManager: true,
    },
  },
  lines: {
    orderBy: { sortOrder: "asc" },
    select: { kind: true, description: true, amountCents: true },
  },
} as const satisfies Prisma.InvoiceSelect;

const BILL_TO_SELECT = {
  id: true,
  number: true,
  displayName: true,
  status: true,
  anonymisedAt: true,
  billingLine1: true,
  billingLine2: true,
  billingSuburb: true,
  billingCity: true,
  billingPostalCode: true,
} as const satisfies Prisma.CustomerSelect;

/**
 * Issues one draft: gives the number and freezes the recipient, ACE's bank and business details and the total.
 * Lock order: the work customer and the bill-to customer (smaller id first), then the invoice. Refuses (with
 * plain sentences in an InvoiceIssueError) an archived or anonymised customer or bill-to, missing bank details,
 * and any problem `issueProblems` finds. Emails are NOT sent here: the app sends them after the commit.
 */
export async function issueInvoice(
  store: InvoiceStore,
  actor: Actor,
  id: string,
): Promise<{ id: string; reference: string }> {
  assertRole(actor, MANAGEMENT);
  if (!isUuid(id)) throw new DomainError(INVOICE_MESSAGES.notFound);
  const read = async () => {
    const inv = await store.invoice.findUnique({ where: { id }, select: ISSUE_SELECT });
    if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
    if (inv.status !== "DRAFT") throw new DomainError(INVOICE_MESSAGES.onlyDraftIssue);
    return inv;
  };
  // The run still drafts for an archived agency; issuing is where a dead recipient is caught. Checked before
  // the locks too, because locking refuses an anonymised customer with words about "this customer".
  const readParties = async (inv: Awaited<ReturnType<typeof read>>, billToId: string) => {
    if (inv.customer.anonymisedAt) throw new InvoiceIssueError([INVOICE_MESSAGES.anonymised]);
    if (inv.customer.status === "ARCHIVED") {
      throw new InvoiceIssueError([INVOICE_MESSAGES.archived]);
    }
    const billTo = await store.customer.findUnique({
      where: { id: billToId },
      select: BILL_TO_SELECT,
    });
    if (!billTo || billTo.anonymisedAt || billTo.status === "ARCHIVED") {
      throw new InvoiceIssueError([INVOICE_MESSAGES.billToInactive]);
    }
    return billTo;
  };

  // Unlocked look first, then the locks, then the same reads again.
  const first = await read();
  const billToId = billToIdFor(first.customer);
  await readParties(first, billToId);
  await lockCustomersInOrder(store, [first.customerId, billToId]);
  await lockInvoiceRows(store, [id]);
  const inv = await read();
  if (billToIdFor(inv.customer) !== billToId) {
    throw new DomainError(INVOICE_MESSAGES.billingChanged);
  }
  const billTo = await readParties(inv, billToId);

  const settings = await readInvoiceSettings(store);
  if (!bankDetailsReady(settings)) throw new InvoiceIssueError([INVOICE_MESSAGES.bankMissing]);
  const today = todaySA();
  const dueDate = inv.dueDate ? toDateString(inv.dueDate) : addDays(today, settings.onceOffDueDays);
  const problems = issueProblems({ lines: inv.lines, dueDate }, today);
  if (problems.length > 0) throw new InvoiceIssueError(problems);

  const totalCents = sumLineCents(inv.lines);
  const recipientName = billTo.displayName;
  const recipientAddress = formatBillingAddress(billTo);
  const snapshot = await buildInvoiceSnapshot(store, settings, billTo.number);
  // The counter row is hot: the number is taken last, after every check and read.
  const numberYear = yearSA();
  const numberSeq = await allocateInvoiceNumber(store, numberYear);
  const reference = formatInvoiceReference({ numberYear, numberSeq }) ?? "";
  const hash = contentHash({
    reference,
    kind: inv.kind,
    serviceMonth: inv.serviceMonth ? toDateString(inv.serviceMonth) : null,
    issuedOn: today,
    dueDate,
    customerId: inv.customerId,
    billTo: { id: billTo.id, name: recipientName, address: recipientAddress },
    lines: inv.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      amountCents: l.amountCents,
    })),
    totalCents,
    snapshot,
  });

  const { count } = await store.invoice.updateMany({
    where: { id, status: "DRAFT" },
    data: {
      status: "ISSUED",
      numberYear,
      numberSeq,
      dueDate: fromDateString(dueDate),
      issuedAt: new Date(),
      issuedById: actor.id,
      billToCustomerId: billTo.id,
      totalCents,
      recipientName,
      recipientAddress,
      bankSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      contentHash: hash,
      emailStatus: "NONE",
      emailedAt: null,
    },
  });
  if (count !== 1) throw new DomainError(INVOICE_MESSAGES.onlyDraftIssue);
  await logInvoiceEvent(store, actor, "invoice.issued", id, { lineCount: inv.lines.length });
  return { id, reference };
}

export type IssueAllResult = {
  issued: { id: string; reference: string }[];
  failed: { id: string; problem: string }[];
};

/**
 * "Issue all drafts": every draft (oldest first), each in its own transaction so one failure never blocks the
 * rest. `only` limits it to these invoice ids; ids that are not UUIDs are ignored. Emails are not sent here.
 */
export async function issueAllDrafts(
  store: InvoiceStore,
  actor: Actor,
  deps: { run: TxRunner; only?: readonly string[] },
): Promise<IssueAllResult> {
  assertRole(actor, MANAGEMENT);
  const only = deps.only
    ? [...new Set(deps.only.filter(isUuid).map((v) => v.toLowerCase()))]
    : null;
  const drafts = await store.invoice.findMany({
    where: { status: "DRAFT", ...(only ? { id: { in: only } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  const result: IssueAllResult = { issued: [], failed: [] };
  for (const d of drafts) {
    try {
      result.issued.push(await deps.run((tx) => issueInvoice(tx, actor, d.id)));
    } catch (error) {
      // Unreachable today (the role is checked above); a ForbiddenError stops the whole batch.
      if (error instanceof ForbiddenError) throw error;
      if (error instanceof DomainError) {
        result.failed.push({ id: d.id, problem: error.message });
      } else {
        // Fixed words only: never the error (it may hold names or addresses).
        console.error("An invoice could not be issued.");
        result.failed.push({ id: d.id, problem: "Something went wrong. Try this one again." });
      }
    }
  }
  return result;
}

/**
 * Voids an issued invoice that has no money allocated from a payment that is not voided. The reason is kept on
 * the invoice (scrubbed on anonymise) and never written to the audit line. Lock order: the customers, then the
 * invoice. Payments are not locked: allocating takes the invoice lock first, so it cannot slip in between the
 * check and the update, and voiding a payment only ever removes allocated money.
 */
export async function voidInvoice(
  store: InvoiceStore,
  actor: Actor,
  id: string,
  reason: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const text = reasonSchema.safeParse(reason);
  if (!text.success) {
    throw new DomainError(text.error.issues[0]?.message ?? "Say why in a few words.");
  }
  if (!isUuid(id)) throw new DomainError(INVOICE_MESSAGES.notFound);
  const read = async () => {
    const inv = await store.invoice.findUnique({
      where: { id },
      select: { status: true, customerId: true, billToCustomerId: true },
    });
    if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
    if (inv.status !== "ISSUED") throw new DomainError(INVOICE_MESSAGES.onlyIssuedVoid);
    return inv;
  };
  const first = await read();
  await lockCustomersInOrder(store, [first.customerId, first.billToCustomerId]);
  await lockInvoiceRows(store, [id]);
  await read();
  if (((await allocatedByInvoice(store, [id])).get(id) ?? 0) > 0) {
    throw new DomainError(INVOICE_MESSAGES.hasAllocations);
  }
  const { count } = await store.invoice.updateMany({
    where: { id, status: "ISSUED" },
    data: { status: "VOID", voidedAt: new Date(), voidReason: text.data, voidedById: actor.id },
  });
  if (count !== 1) throw new DomainError(INVOICE_MESSAGES.onlyIssuedVoid);
  await logInvoiceEvent(store, actor, "invoice.voided", id);
}

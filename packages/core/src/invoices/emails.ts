import { assertRole, DomainError, MANAGEMENT, type Actor } from "../customers/access";
import { formatZAR } from "../money";
import {
  checkAttachments,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type EmailAttachment,
  type EmailMessage,
} from "../portal/email/send";
import { invoiceEmail } from "../portal/email/templates";
import { formatDateSA } from "../quotes/reference";
import { formatInvoiceReference } from "./reference";
import { bankDetailsReady, invoiceSnapshotSchema } from "./schemas";
import { INVOICE_MESSAGES, logInvoiceEvent, type InvoiceStore } from "./store";

export type InvoiceEmailDeps = {
  send: (message: EmailMessage) => Promise<void>;
  /** The PDF of one invoice (made by the app). */
  attachmentFor: (invoiceId: string) => Promise<EmailAttachment>;
};

/**
 * Fixed words stored in the audit line of a failed email. "prepare": the email could not be put together (for
 * example the invoice's frozen snapshot does not read back); "send": every address was refused.
 */
type FailReason = "no_recipient" | "attachment" | "prepare" | "send";
type Outcome =
  | { kind: "sent"; recipients: number; failedRecipients: number }
  | { kind: "failed"; reason: FailReason };

/** "Resend email": the invoice must be issued. Owner or manager. */
export async function checkInvoiceEmailable(
  store: Pick<InvoiceStore, "invoice">,
  actor: Actor,
  id: string,
): Promise<void> {
  assertRole(actor, MANAGEMENT);
  const inv = await store.invoice.findUnique({ where: { id }, select: { status: true } });
  if (!inv) throw new DomainError(INVOICE_MESSAGES.notFound);
  if (inv.status !== "ISSUED") throw new DomainError(INVOICE_MESSAGES.onlyIssuedEmail);
}

/**
 * Splits attached invoices into emails that each stay within the attachment limits (count and bytes), keeping
 * the invoice order.
 */
function chunkByLimits<T extends { attachment: EmailAttachment }>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = item.attachment.content.byteLength;
    if (
      current.length > 0 &&
      (current.length >= MAX_ATTACHMENTS || bytes + size > MAX_ATTACHMENT_BYTES)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Emails issued invoices, AFTER the issuing transaction has committed. Invoices are grouped by bill-to customer
 * (an agency gets its complexes' invoices together): each address of the bill-to customer's contacts who receive
 * invoices gets one email listing the group with every PDF attached. A group larger than the attachment limits
 * (20 files, 15 MB) goes out as several emails. An invoice whose PDF cannot be made is marked failed on its own;
 * the rest of its group is still sent. The result is stored on each invoice (emailStatus) and in the audit log
 * with fixed words and counts only. Never throws for an email problem: each failure is logged with a fixed
 * phrase only (never an address, a name, an amount or an error message).
 */
export async function emailIssuedInvoices(
  store: Pick<InvoiceStore, "invoice" | "contact" | "auditLog">,
  actor: Actor,
  invoiceIds: readonly string[],
  deps: InvoiceEmailDeps,
): Promise<{ sent: number; failed: number }> {
  assertRole(actor, MANAGEMENT);
  const ids = [...new Set(invoiceIds)];
  if (ids.length === 0) return { sent: 0, failed: 0 };
  const invoices = await store.invoice.findMany({
    where: { id: { in: ids }, status: "ISSUED" },
    orderBy: [{ numberYear: "asc" }, { numberSeq: "asc" }],
    select: {
      id: true,
      numberYear: true,
      numberSeq: true,
      totalCents: true,
      dueDate: true,
      customerId: true,
      billToCustomerId: true,
      bankSnapshot: true,
      customer: { select: { displayName: true } },
    },
  });
  type Row = (typeof invoices)[number];
  const groups = new Map<string, Row[]>();
  for (const inv of invoices) {
    groups.set(inv.billToCustomerId, [...(groups.get(inv.billToCustomerId) ?? []), inv]);
  }

  const outcomes = new Map<string, Outcome>();
  const fail = (rows: readonly Row[], reason: FailReason) => {
    for (const r of rows) outcomes.set(r.id, { kind: "failed", reason });
  };

  for (const [billToId, group] of groups) {
    try {
      const contacts = await store.contact.findMany({
        where: {
          customerId: billToId,
          receivesInvoices: true,
          email: { not: null },
          customer: { archivedAt: null, anonymisedAt: null },
        },
        orderBy: { id: "asc" },
        select: { email: true },
      });
      const emails = [
        ...new Set(contacts.flatMap((c) => (c.email && c.email.trim() !== "" ? [c.email] : []))),
      ];
      if (emails.length === 0) {
        fail(group, "no_recipient");
        continue;
      }

      const attached: { inv: Row; attachment: EmailAttachment }[] = [];
      for (const inv of group) {
        try {
          const attachment = await deps.attachmentFor(inv.id);
          checkAttachments([attachment]);
          attached.push({ inv, attachment });
        } catch {
          console.error("An invoice PDF could not be made for an email.");
          fail([inv], "attachment");
        }
      }

      for (const chunk of chunkByLimits(attached)) {
        const rows = chunk.map((c) => c.inv);
        try {
          const parsed = invoiceSnapshotSchema.safeParse(rows[0]?.bankSnapshot);
          if (!parsed.success) {
            console.error("Invoice emails could not be prepared.");
            fail(rows, "prepare");
            continue;
          }
          const snapshot = parsed.data;
          const items = rows.map((inv) => ({
            reference: formatInvoiceReference(inv) ?? "",
            forName: inv.customerId !== billToId ? inv.customer.displayName : null,
            amountLabel: formatZAR(inv.totalCents ?? 0),
            dueDateLabel: inv.dueDate ? formatDateSA(inv.dueDate) : "",
          }));
          const attachments = chunk.map((c) => c.attachment);
          let recipients = 0;
          for (const to of emails) {
            try {
              await deps.send({
                ...invoiceEmail({
                  to,
                  invoices: items,
                  paymentReference: snapshot.paymentReference,
                  bank: bankDetailsReady(snapshot.bank) ? snapshot.bank : null,
                }),
                attachments,
              });
              recipients += 1;
            } catch {
              // Fixed words only: never the error (it may hold the address) or the address itself.
              console.error("An invoice email could not be sent.");
            }
          }
          if (recipients > 0) {
            const failedRecipients = emails.length - recipients;
            for (const r of rows) {
              outcomes.set(r.id, { kind: "sent", recipients, failedRecipients });
            }
          } else {
            fail(rows, "send");
          }
        } catch {
          // Each send has its own catch above, so this is a problem putting the email together.
          console.error("Invoice emails could not be prepared.");
          fail(rows, "prepare");
        }
      }
    } catch {
      console.error("Invoice emails could not be prepared.");
      // Nothing was sent here (the contacts could not be read): a problem putting the email together.
      for (const r of group) if (!outcomes.has(r.id)) fail([r], "prepare");
    }
  }

  let sent = 0;
  let failed = 0;
  for (const inv of invoices) {
    const outcome = outcomes.get(inv.id) ?? { kind: "failed", reason: "send" };
    try {
      await store.invoice.updateMany({
        where: { id: inv.id, status: "ISSUED" },
        data:
          outcome.kind === "sent"
            ? { emailStatus: "SENT", emailedAt: new Date() }
            : { emailStatus: "FAILED" },
      });
      await logInvoiceEvent(
        store,
        actor,
        outcome.kind === "sent" ? "invoice.emailed" : "invoice.email_failed",
        inv.id,
        outcome.kind === "sent"
          ? {
              recipients: outcome.recipients,
              // Only a count, and only when some addresses were refused.
              ...(outcome.failedRecipients > 0
                ? { failedRecipients: outcome.failedRecipients }
                : {}),
            }
          : { reason: outcome.reason },
      );
    } catch {
      console.error("An invoice email result could not be saved.");
    }
    if (outcome.kind === "sent") sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

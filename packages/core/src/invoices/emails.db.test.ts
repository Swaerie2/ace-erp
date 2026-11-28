import { afterEach, describe, expect, it, vi } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { formatZAR } from "../money";
import type { EmailMessage } from "../portal/email/send";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { createOnceOffDraft } from "./drafts";
import { checkInvoiceEmailable, emailIssuedInvoices } from "./emails";
import { formatInvoiceReference } from "./reference";
import { INVOICE_MESSAGES } from "./store";
import {
  auditFor,
  crew,
  makeBillingCustomer,
  makeIssuedInvoice,
  manager,
  tag,
} from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

const SNAPSHOT = {
  bank: {
    bankName: "ZZ Test Bank",
    accountHolder: "ACE Garden Services",
    accountNumber: "1234567890",
    branchCode: "250655",
    accountType: "Business cheque",
  },
  business: {
    legalName: "ZZ ACE Legal",
    tradingName: "ACE Garden Services",
    registrationNumber: "",
    phone: "",
    email: "",
    website: "",
  },
  paymentReference: "C-0099",
};

/** An issued invoice with a frozen bank snapshot, as issuing leaves it. */
async function issued(tx: Tx, customerId: string, billToCustomerId: string, totalCents = 123456) {
  const id = await makeIssuedInvoice(tx, {
    customerId,
    billToCustomerId,
    totalCents,
    dueDate: "2099-01-31",
  });
  await tx.invoice.update({
    where: { id },
    data: { bankSnapshot: SNAPSHOT },
    select: { id: true },
  });
  return id;
}

/** A contact on a customer; returns its (made-up) email. */
async function addContact(
  tx: Tx,
  customerId: string,
  opts: { receivesInvoices: boolean; email?: string | null },
): Promise<string | null> {
  const email = opts.email === undefined ? `zz.extra.${tag()}@example.com` : opts.email;
  await tx.contact.create({
    data: {
      customerId,
      name: `ZZ E2E Extra ${tag()}`,
      email,
      phone: email === null ? "+27820000001" : null,
      receivesInvoices: opts.receivesInvoices,
    },
    select: { id: true },
  });
  return email;
}

async function contactEmails(tx: Tx, customerId: string): Promise<string[]> {
  const rows = await tx.contact.findMany({ where: { customerId }, select: { email: true } });
  return rows.flatMap((r) => (r.email ? [r.email] : []));
}

const pdfFor = async (id: string) => ({
  filename: `${id}.pdf`,
  content: new Uint8Array([37, 80, 68, 70]),
});

afterEach(() => vi.restoreAllMocks());

describe.skipIf(!dbTestsEnabled)("emailing issued invoices", () => {
  it("sends an agency one email per address with every complex's PDF, only to its invoice contacts", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx, { name: `ZZ E2E Agency ${tag()}` });
      const a = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        billsToManager: true,
      });
      const b = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        billsToManager: true,
      });
      const second = await addContact(tx, agency.customerId, { receivesInvoices: true });
      const optedOut = await addContact(tx, agency.customerId, { receivesInvoices: false });
      await addContact(tx, agency.customerId, { receivesInvoices: true, email: null });
      const i1 = await issued(tx, a.customerId, agency.customerId, 111100);
      const i2 = await issued(tx, b.customerId, agency.customerId, 222200);

      const sent: EmailMessage[] = [];
      const result = await emailIssuedInvoices(tx, manager, [i1, i2], {
        send: async (m) => {
          sent.push(m);
        },
        attachmentFor: pdfFor,
      });

      expect(result).toEqual({ sent: 2, failed: 0 });
      const agencyEmails = await contactEmails(tx, agency.customerId);
      const expected = agencyEmails.filter((e) => e !== optedOut).sort();
      expect(expected).toContain(second);
      expect(sent.map((m) => m.to).sort()).toEqual(expected);
      const complexEmails = [
        ...(await contactEmails(tx, a.customerId)),
        ...(await contactEmails(tx, b.customerId)),
      ];
      for (const m of sent) {
        expect(complexEmails).not.toContain(m.to);
        expect(m.to).not.toBe(optedOut);
        expect(m.subject).toBe("Your ACE invoices");
        expect(m.attachments?.map((f) => f.filename).sort()).toEqual(
          [`${i1}.pdf`, `${i2}.pdf`].sort(),
        );
        expect(m.text).toContain(`(${a.displayName})`);
        expect(m.text).toContain(`(${b.displayName})`);
        expect(m.text).toContain("C-0099");
      }

      const rows = await tx.invoice.findMany({
        where: { id: { in: [i1, i2] } },
        select: {
          status: true,
          emailStatus: true,
          emailedAt: true,
          numberYear: true,
          numberSeq: true,
        },
      });
      for (const r of rows) {
        expect(r.status).toBe("ISSUED");
        expect(r.emailStatus).toBe("SENT");
        expect(r.emailedAt).not.toBeNull();
      }

      for (const id of [i1, i2]) {
        const audits = await auditFor(tx, "invoice", id);
        expect(audits).toContainEqual({
          action: "invoice.emailed",
          after: { recipients: expected.length },
          actorId: manager.id,
        });
        const text = JSON.stringify(audits);
        for (const forbidden of [
          "example.com",
          agency.displayName,
          a.displayName,
          b.displayName,
          formatZAR(111100),
          formatZAR(222200),
          ...rows.map((r) => formatInvoiceReference(r) ?? "none"),
        ]) {
          expect(text).not.toContain(forbidden);
        }
      }
    });
  });

  it("a failing send leaves the invoice issued, records the failure with fixed words and does not throw", async () => {
    await withRollback(async (tx) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const c = await makeBillingCustomer(tx);
      const id = await issued(tx, c.customerId, c.customerId);
      const [address] = await contactEmails(tx, c.customerId);
      const result = await emailIssuedInvoices(tx, manager, [id], {
        send: async (m) => {
          throw new Error(`Resend refused ${m.to}: ${m.text}`);
        },
        attachmentFor: pdfFor,
      });
      expect(result).toEqual({ sent: 0, failed: 1 });
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { status: true, emailStatus: true, emailedAt: true },
      });
      expect(row).toEqual({ status: "ISSUED", emailStatus: "FAILED", emailedAt: null });
      const audits = await auditFor(tx, "invoice", id);
      expect(audits).toContainEqual({
        action: "invoice.email_failed",
        after: { reason: "send" },
        actorId: manager.id,
      });
      const logged = error.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
      expect(logged).toContain("An invoice email could not be sent.");
      expect(logged).not.toContain(String(address));
      expect(logged).not.toContain("example.com");
      expect(logged).not.toContain("C-0099");
      expect(JSON.stringify(audits)).not.toContain("example.com");
    });
  });

  it("counts the addresses that failed when at least one got the email", async () => {
    await withRollback(async (tx) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const c = await makeBillingCustomer(tx);
      const bad = await addContact(tx, c.customerId, { receivesInvoices: true });
      const id = await issued(tx, c.customerId, c.customerId);
      const result = await emailIssuedInvoices(tx, manager, [id], {
        send: async (m) => {
          if (m.to === bad) throw new Error("refused");
        },
        attachmentFor: pdfFor,
      });
      expect(result).toEqual({ sent: 1, failed: 0 });
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { emailStatus: true },
      });
      expect(row.emailStatus).toBe("SENT");
      const audits = await auditFor(tx, "invoice", id);
      expect(audits).toContainEqual({
        action: "invoice.emailed",
        after: { recipients: 1, failedRecipients: 1 },
        actorId: manager.id,
      });
      expect(JSON.stringify(audits)).not.toContain("example.com");
    });
  });

  it("records a broken frozen snapshot as prepare, not send", async () => {
    await withRollback(async (tx) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const c = await makeBillingCustomer(tx);
      const id = await issued(tx, c.customerId, c.customerId);
      await tx.invoice.update({
        where: { id },
        data: { bankSnapshot: { broken: true } },
        select: { id: true },
      });
      const send = vi.fn();
      const result = await emailIssuedInvoices(tx, manager, [id], { send, attachmentFor: pdfFor });
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(send).not.toHaveBeenCalled();
      expect(await auditFor(tx, "invoice", id)).toContainEqual({
        action: "invoice.email_failed",
        after: { reason: "prepare" },
        actorId: manager.id,
      });
      expect(error.mock.calls.map(String).join("\n")).toContain(
        "Invoice emails could not be prepared.",
      );
    });
  });

  it("records no_recipient when the payer has nobody who receives invoices", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx, { email: null });
      await addContact(tx, c.customerId, { receivesInvoices: false });
      const id = await issued(tx, c.customerId, c.customerId);
      const send = vi.fn();
      const result = await emailIssuedInvoices(tx, manager, [id], { send, attachmentFor: pdfFor });
      expect(result).toEqual({ sent: 0, failed: 1 });
      expect(send).not.toHaveBeenCalled();
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { emailStatus: true },
      });
      expect(row.emailStatus).toBe("FAILED");
      expect(await auditFor(tx, "invoice", id)).toContainEqual({
        action: "invoice.email_failed",
        after: { reason: "no_recipient" },
        actorId: manager.id,
      });
    });
  });

  it("refuses crew, and only an issued invoice can be emailed again", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const id = await issued(tx, c.customerId, c.customerId);
      const send = vi.fn();
      await expect(
        emailIssuedInvoices(tx, crew, [id], { send, attachmentFor: pdfFor }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(checkInvoiceEmailable(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      expect(send).not.toHaveBeenCalled();
      const row = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { emailStatus: true },
      });
      expect(row.emailStatus).toBe("NONE");

      await expect(checkInvoiceEmailable(tx, manager, id)).resolves.toBeUndefined();
      const draft = await createOnceOffDraft(tx, manager, { customerId: c.customerId });
      const refused = checkInvoiceEmailable(tx, manager, draft.id);
      await expect(refused).rejects.toBeInstanceOf(DomainError);
      await expect(checkInvoiceEmailable(tx, manager, draft.id)).rejects.toThrow(
        INVOICE_MESSAGES.onlyIssuedEmail,
      );
      // A draft passed to the sender is skipped (only ISSUED invoices are read), nothing is sent.
      expect(
        await emailIssuedInvoices(tx, manager, [draft.id], { send, attachmentFor: pdfFor }),
      ).toEqual({ sent: 0, failed: 0 });
      expect(send).not.toHaveBeenCalled();
    });
  });
});

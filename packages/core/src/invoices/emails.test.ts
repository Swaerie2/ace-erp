import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, type Actor } from "../customers/access";
import type { EmailMessage } from "../portal/email/send";
import { checkInvoiceEmailable, emailIssuedInvoices } from "./emails";
import type { InvoiceStore } from "./store";

const manager: Actor = { id: "staff-1", role: "MANAGER" };
const SNAPSHOT = {
  bank: {
    bankName: "B",
    accountHolder: "H",
    accountNumber: "123456",
    branchCode: "250655",
    accountType: "",
  },
  business: {
    legalName: "L",
    tradingName: "ACE Garden Services",
    registrationNumber: "",
    phone: "",
    email: "",
    website: "",
  },
  paymentReference: "C-0009",
};
const due = new Date("2026-11-30T00:00:00.000Z");
const invoice = (id: string, seq: number, customerId: string, billToCustomerId: string) => ({
  id,
  numberYear: 2026,
  numberSeq: seq,
  totalCents: 1000 * seq,
  dueDate: due,
  customerId,
  billToCustomerId,
  bankSnapshot: SNAPSHOT,
  customer: { displayName: `ZZ ${customerId}` },
});

function fakeStore(opts: {
  invoices: ReturnType<typeof invoice>[];
  emails: Record<string, string[]>;
  status?: string;
}) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const audits: { action: string; entityId: string; after: unknown }[] = [];
  const store = {
    invoice: {
      findMany: async () => opts.invoices,
      findUnique: async () => (opts.status ? { status: opts.status } : null),
      updateMany: async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return { count: 1 };
      },
    },
    contact: {
      findMany: async (args: { where: { customerId: string } }) =>
        (opts.emails[args.where.customerId] ?? []).map((email) => ({ email })),
    },
    auditLog: {
      create: async (args: { data: { action: string; entityId: string; after: unknown } }) => {
        audits.push({
          action: args.data.action,
          entityId: args.data.entityId,
          after: args.data.after,
        });
        return { id: "a" };
      },
    },
  } as unknown as InvoiceStore;
  return { store, updates, audits };
}

const pdf = async (id: string) => ({ filename: `${id}.pdf`, content: new Uint8Array([1]) });

afterEach(() => vi.restoreAllMocks());

describe("emailIssuedInvoices", () => {
  it("sends an agency's invoices together, one email per address, with every PDF attached", async () => {
    const { store, updates, audits } = fakeStore({
      invoices: [invoice("i1", 1, "complexA", "agency"), invoice("i2", 2, "complexB", "agency")],
      emails: { agency: ["zz.one@example.com", "zz.two@example.com"] },
    });
    const sent: EmailMessage[] = [];
    const result = await emailIssuedInvoices(store, manager, ["i1", "i2"], {
      send: async (m) => {
        sent.push(m);
      },
      attachmentFor: pdf,
    });
    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["zz.one@example.com", "zz.two@example.com"]);
    expect(sent[0]?.subject).toBe("Your ACE invoices");
    expect(sent[0]?.attachments?.map((a) => a.filename)).toEqual(["i1.pdf", "i2.pdf"]);
    expect(sent[0]?.text).toContain("(ZZ complexA)");
    expect(updates.map((u) => u.data.emailStatus)).toEqual(["SENT", "SENT"]);
    expect(audits).toEqual([
      { action: "invoice.emailed", entityId: "i1", after: { recipients: 2 } },
      { action: "invoice.emailed", entityId: "i2", after: { recipients: 2 } },
    ]);
  });

  it("marks the invoice failed when nobody receives invoices, without sending", async () => {
    const { store, updates, audits } = fakeStore({
      invoices: [invoice("i1", 1, "c", "c")],
      emails: {},
    });
    const send = vi.fn();
    const result = await emailIssuedInvoices(store, manager, ["i1"], { send, attachmentFor: pdf });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(updates[0]?.data).toEqual({ emailStatus: "FAILED" });
    expect(audits[0]).toEqual({
      action: "invoice.email_failed",
      entityId: "i1",
      after: { reason: "no_recipient" },
    });
  });

  it("never throws when sending fails, and logs fixed words only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, audits } = fakeStore({
      invoices: [invoice("i1", 1, "c", "c")],
      emails: { c: ["zz.x@example.com"] },
    });
    const result = await emailIssuedInvoices(store, manager, ["i1"], {
      send: async () => {
        throw new Error("Resend refused zz.x@example.com");
      },
      attachmentFor: pdf,
    });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(audits[0]?.after).toEqual({ reason: "send" });
    const logged = error.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("An invoice email could not be sent.");
    expect(logged).not.toContain("example.com");
  });

  it("records 'prepare' (not 'send') when the payer's contacts cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, audits } = fakeStore({
      invoices: [invoice("i1", 1, "c", "c")],
      emails: { c: ["zz.x@example.com"] },
    });
    store.contact.findMany = (async () => {
      throw new Error("connection lost for zz.x@example.com");
    }) as unknown as typeof store.contact.findMany;
    const send = vi.fn();
    const result = await emailIssuedInvoices(store, manager, ["i1"], { send, attachmentFor: pdf });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(audits[0]).toEqual({
      action: "invoice.email_failed",
      entityId: "i1",
      after: { reason: "prepare" },
    });
    const logged = error.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toContain("Invoice emails could not be prepared.");
    expect(logged).not.toContain("example.com");
  });

  it("marks the invoice failed when its PDF cannot be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, audits } = fakeStore({
      invoices: [invoice("i1", 1, "c", "c")],
      emails: { c: ["zz.x@example.com"] },
    });
    const send = vi.fn();
    await emailIssuedInvoices(store, manager, ["i1"], {
      send,
      attachmentFor: async () => {
        throw new Error("render failed");
      },
    });
    expect(send).not.toHaveBeenCalled();
    expect(audits[0]?.after).toEqual({ reason: "attachment" });
  });

  it("still sends the other invoices of a payer when one PDF cannot be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { store, audits } = fakeStore({
      invoices: [invoice("i1", 1, "a", "agency"), invoice("i2", 2, "b", "agency")],
      emails: { agency: ["zz.one@example.com"] },
    });
    const sent: EmailMessage[] = [];
    const result = await emailIssuedInvoices(store, manager, ["i1", "i2"], {
      send: async (m) => {
        sent.push(m);
      },
      attachmentFor: async (id) => {
        if (id === "i1") throw new Error("render failed");
        return pdf(id);
      },
    });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.attachments?.map((a) => a.filename)).toEqual(["i2.pdf"]);
    expect(sent[0]?.text).not.toContain("INV-2026-0001");
    expect(audits).toEqual([
      { action: "invoice.email_failed", entityId: "i1", after: { reason: "attachment" } },
      { action: "invoice.emailed", entityId: "i2", after: { recipients: 1 } },
    ]);
  });

  it("splits more than 20 invoices of one payer into several emails", async () => {
    const many = Array.from({ length: 25 }, (_, n) =>
      invoice(`i${n + 1}`, n + 1, `c${n}`, "agency"),
    );
    const { store } = fakeStore({ invoices: many, emails: { agency: ["zz.one@example.com"] } });
    const sent: EmailMessage[] = [];
    const result = await emailIssuedInvoices(
      store,
      manager,
      many.map((i) => i.id),
      {
        send: async (m) => {
          sent.push(m);
        },
        attachmentFor: pdf,
      },
    );
    expect(result).toEqual({ sent: 25, failed: 0 });
    expect(sent.map((m) => m.attachments?.length)).toEqual([20, 5]);
  });

  it("refuses crew, and only an issued invoice can be emailed again", async () => {
    const { store } = fakeStore({ invoices: [], emails: {}, status: "DRAFT" });
    const crew: Actor = { id: "c", role: "CREW" };
    await expect(
      emailIssuedInvoices(store, crew, ["i1"], { send: vi.fn(), attachmentFor: pdf }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(checkInvoiceEmailable(store, crew, "i1")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(checkInvoiceEmailable(store, manager, "i1")).rejects.toThrow(
      "Only an issued invoice can be emailed.",
    );
  });
});

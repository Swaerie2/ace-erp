import { describe, expect, it } from "vitest";
import { formatCustomerNumber } from "../customers/number";
import { anonymiseCustomer, exportCustomerData } from "../customers/privacy";
import { fromDateString } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { loadInvoiceDocument } from "./document";
import { getStatement } from "./statements";
import {
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
  owner,
} from "./test-helpers";

/** A valid frozen snapshot (made-up ACE details), so the document loader can read the invoice. */
const FROZEN = {
  bank: {
    bankName: "ZZ Frozen Bank",
    accountHolder: "ZZ Frozen Holder",
    accountNumber: "1111111111",
    branchCode: "111111",
    accountType: "Savings",
  },
  business: {
    legalName: "ZZ Frozen Legal (Pty) Ltd",
    tradingName: "ZZ Frozen Trading",
    registrationNumber: "2000/000000/07",
    phone: "111 111 1111",
    email: "frozen@example.com",
    website: "frozen.example.com",
  },
  paymentReference: "C-9999",
};

describe.skipIf(!dbTestsEnabled)("anonymise and export with invoices", () => {
  it("exports the customer's invoices, payments and reports without ACE's bank snapshot", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2099-01-31" });
      await tx.invoice.update({
        where: { id: inv },
        data: { bankSnapshot: { bank: "ZZ secret-ish" } },
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 500,
        receivedOn: "2026-11-01",
        reference: "ZZ REF",
      });
      await tx.paymentReport.create({
        data: { invoiceId: inv, paidOn: fromDateString("2026-11-02"), reference: "ZZ REPORT REF" },
      });
      const data = await exportCustomerData(tx, owner, c.customerId);
      expect(data.invoices.map((i) => i.id)).toEqual([inv]);
      expect(data.invoices[0]?.lines).toHaveLength(1);
      expect(data.invoices[0]).not.toHaveProperty("bankSnapshot");
      expect(data.payments.map((p) => p.reference)).toEqual(["ZZ REF"]);
      expect(data.paymentReports.map((r) => r.reference)).toEqual(["ZZ REPORT REF"]);
    });
  });

  it("keeps numbers, dates and amounts, scrubs the recipient, wording, references and notes, and deletes drafts", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const issued = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-01-31",
        totalCents: 115000,
      });
      await tx.invoiceLine.updateMany({
        where: { invoiceId: issued },
        data: { description: `${c.propertyLabel}: Weekly garden maintenance` },
      });
      const voided = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-01-31",
      });
      await tx.invoice.update({
        where: { id: voided },
        data: { status: "VOID", voidedAt: new Date(), voidReason: "ZZ typed reason" },
      });
      const draft = await tx.invoice.create({
        data: {
          customerId: c.customerId,
          billToCustomerId: c.customerId,
          kind: "ONCE_OFF",
          lines: {
            create: [
              { sortOrder: 1, kind: "ONCE_OFF", description: "ZZ draft work", amountCents: 100 },
            ],
          },
        },
        select: { id: true },
      });
      const payment = await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 115000,
        receivedOn: "2026-11-01",
        reference: "ZZ BANK REF",
        allocations: [{ invoiceId: issued, amountCents: 115000 }],
      });
      await tx.payment.update({ where: { id: payment }, data: { note: "ZZ note" } });
      const report = await tx.paymentReport.create({
        data: {
          invoiceId: issued,
          paidOn: fromDateString("2026-11-01"),
          reference: "ZZ CLIENT REF",
        },
        select: { id: true },
      });

      await anonymiseCustomer(tx, owner, c.customerId, formatCustomerNumber(c.number));

      const row = await tx.invoice.findUniqueOrThrow({
        where: { id: issued },
        include: { lines: true },
      });
      expect(row).toMatchObject({
        status: "ISSUED",
        totalCents: 115000,
        numberYear: 2099,
        recipientName: null,
        recipientAddress: null,
      });
      expect(row.lines.map((l) => [l.description, l.amountCents])).toEqual([
        ["Once-off work", 115000],
      ]);
      expect((await tx.invoice.findUniqueOrThrow({ where: { id: voided } })).voidReason).toBeNull();
      expect(await tx.invoice.findUnique({ where: { id: draft.id } })).toBeNull();
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: payment },
        include: { allocations: true },
      });
      expect(p).toMatchObject({ reference: null, note: null, amountCents: 115000 });
      expect(p.allocations.map((a) => a.amountCents)).toEqual([115000]);
      expect(
        (await tx.paymentReport.findUniqueOrThrow({ where: { id: report.id } })).reference,
      ).toBeNull();
    });
  });

  it("anonymising a complex billed to its agency keeps the agency's recipient and payment, and scrubs the complex's wording", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, { managedById: agency.customerId });
      const inv = await makeIssuedInvoice(tx, {
        customerId: complex.customerId,
        billToCustomerId: agency.customerId,
        dueDate: "2099-01-31",
        totalCents: 50000,
      });
      await tx.invoiceLine.updateMany({
        where: { invoiceId: inv },
        data: { description: `${complex.propertyLabel}: Weekly garden maintenance` },
      });
      await tx.invoice.update({
        where: { id: inv },
        data: { status: "VOID", voidedAt: new Date(), voidReason: "ZZ typed reason" },
      });
      const draft = await tx.invoice.create({
        data: {
          customerId: complex.customerId,
          billToCustomerId: agency.customerId,
          kind: "ONCE_OFF",
          lines: {
            create: [
              { sortOrder: 1, kind: "ONCE_OFF", description: "ZZ draft work", amountCents: 100 },
            ],
          },
        },
        select: { id: true },
      });
      const payment = await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 50000,
        receivedOn: "2026-11-01",
        reference: "ZZ AGENCY REF",
        allocations: [{ invoiceId: inv, amountCents: 50000 }],
      });
      const report = await tx.paymentReport.create({
        data: { invoiceId: inv, paidOn: fromDateString("2026-11-01"), reference: "ZZ REPORT REF" },
        select: { id: true },
      });

      await anonymiseCustomer(tx, owner, complex.customerId, formatCustomerNumber(complex.number));

      const row = await tx.invoice.findUniqueOrThrow({
        where: { id: inv },
        include: { lines: true },
      });
      // The frozen recipient is the agency, not the complex: it stays.
      expect(row).toMatchObject({
        recipientName: "ZZ E2E Recipient",
        recipientAddress: "1 Test Road, Testville",
        voidReason: null,
        totalCents: 50000,
      });
      // The line wording names the complex's property: it goes.
      expect(row.lines.map((l) => l.description)).toEqual(["Once-off work"]);
      expect(await tx.invoice.findUnique({ where: { id: draft.id } })).toBeNull();
      // The agency's payment is the agency's record.
      expect((await tx.payment.findUniqueOrThrow({ where: { id: payment } })).reference).toBe(
        "ZZ AGENCY REF",
      );
      // A typed reference on the complex's invoice may name the complex: it goes.
      expect(
        (await tx.paymentReport.findUniqueOrThrow({ where: { id: report.id } })).reference,
      ).toBeNull();
    });
  });

  it("anonymising an agency scrubs its recipient and payments on a complex's invoice, and keeps the complex's wording", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      // A complex that was billed to the agency before the link ended (an agency that still manages is refused).
      const complex = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, {
        customerId: complex.customerId,
        billToCustomerId: agency.customerId,
        dueDate: "2099-01-31",
        totalCents: 50000,
      });
      const own = await makeIssuedInvoice(tx, {
        customerId: complex.customerId,
        dueDate: "2099-01-31",
      });
      const payment = await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 50000,
        receivedOn: "2026-11-01",
        reference: "ZZ AGENCY REF",
        allocations: [{ invoiceId: inv, amountCents: 50000 }],
      });

      await anonymiseCustomer(tx, owner, agency.customerId, formatCustomerNumber(agency.number));

      const row = await tx.invoice.findUniqueOrThrow({
        where: { id: inv },
        include: { lines: true },
      });
      expect(row).toMatchObject({ recipientName: null, recipientAddress: null, totalCents: 50000 });
      expect(row.lines.map((l) => l.description)).toEqual(["ZZ E2E work"]);
      const p = await tx.payment.findUniqueOrThrow({
        where: { id: payment },
        include: { allocations: true },
      });
      expect(p).toMatchObject({ reference: null, amountCents: 50000 });
      expect(p.allocations.map((a) => a.amountCents)).toEqual([50000]);
      // The complex's own invoice is untouched.
      expect(await tx.invoice.findUniqueOrThrow({ where: { id: own } })).toMatchObject({
        recipientName: "ZZ E2E Recipient",
      });
    });
  });

  it("a complex's export leaves out the agency's recipient, payments and reports on invoices billed to the agency", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, { managedById: agency.customerId });
      const inv = await makeIssuedInvoice(tx, {
        customerId: complex.customerId,
        billToCustomerId: agency.customerId,
        dueDate: "2099-01-31",
        totalCents: 50000,
      });
      await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 50000,
        receivedOn: "2026-11-01",
        reference: "ZZ AGENCY REF",
        allocations: [{ invoiceId: inv, amountCents: 50000 }],
      });
      await tx.paymentReport.create({
        data: { invoiceId: inv, paidOn: fromDateString("2026-11-01"), reference: "ZZ REPORT REF" },
      });

      const mine = await exportCustomerData(tx, owner, complex.customerId);
      expect(mine.invoices.map((i) => i.id)).toEqual([inv]);
      expect(mine.invoices[0]).toMatchObject({ totalCents: 50000 });
      expect(mine.invoices[0]?.lines).toHaveLength(1);
      expect(mine.invoices[0]).not.toHaveProperty("recipientName");
      expect(mine.invoices[0]).not.toHaveProperty("recipientAddress");
      expect(mine.invoices[0]).not.toHaveProperty("allocations");
      expect(mine.payments).toEqual([]);
      expect(mine.paymentReports).toEqual([]);
      expect(JSON.stringify(mine)).not.toContain("ZZ AGENCY REF");
      expect(JSON.stringify(mine)).not.toContain("ZZ REPORT REF");

      const theirs = await exportCustomerData(tx, owner, agency.customerId);
      expect(theirs.invoices.map((i) => i.id)).toEqual([inv]);
      expect(theirs.invoices[0]).toMatchObject({ recipientName: "ZZ E2E Recipient" });
      expect(theirs.payments.map((p) => p.reference)).toEqual(["ZZ AGENCY REF"]);
      expect(theirs.paymentReports.map((r) => r.reference)).toEqual(["ZZ REPORT REF"]);
    });
  });

  it("after anonymise the statement and the invoice document still load, with the amounts kept", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-12-31",
        issuedOn: "2026-11-20",
        totalCents: 100000,
      });
      await tx.invoice.update({ where: { id: inv }, data: { bankSnapshot: FROZEN } });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 30000,
        receivedOn: "2026-11-21",
        allocations: [{ invoiceId: inv, amountCents: 30000 }],
      });

      await anonymiseCustomer(tx, owner, c.customerId, formatCustomerNumber(c.number));

      const statement = await getStatement(tx, manager, c.customerId, {
        from: "2026-11-01",
        to: "2026-11-30",
      });
      expect(statement?.customer).toMatchObject({
        displayName: "Anonymised customer",
        address: null,
      });
      expect(statement?.data.closingCents).toBe(70000);

      const loaded = await loadInvoiceDocument(tx, manager, inv);
      expect(loaded?.doc).toMatchObject({
        totalLabel: "R1,000.00",
        paidLabel: "R300.00",
        balanceLabel: "R700.00",
        billTo: { name: "Anonymised customer", address: null },
      });
      expect(loaded?.doc.rows.map((r) => r.description)).toEqual(["Once-off work"]);
    });
  });
});

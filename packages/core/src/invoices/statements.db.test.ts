import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { getStatement } from "./statements";
import { crew, makeBillingCustomer, makeIssuedInvoice, makePayment, manager } from "./test-helpers";

describe.skipIf(!dbTestsEnabled)("statements", () => {
  it("one customer: opening balance, the period's invoices and payments, closing balance and what is owed", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const sept = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 100000,
        issuedOn: "2026-09-20",
        dueDate: "2026-09-30",
      });
      const oct = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 50000,
        issuedOn: "2026-10-20",
        dueDate: "2026-10-31",
      });
      const voided = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 99900,
        issuedOn: "2026-10-05",
        dueDate: "2026-10-31",
      });
      await tx.invoice.update({
        where: { id: voided },
        data: { status: "VOID", voidedAt: new Date() },
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 60000,
        receivedOn: "2026-09-25",
        allocations: [{ invoiceId: sept, amountCents: 60000 }],
      });
      const eft = await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 70000,
        receivedOn: "2026-10-28",
        reference: "ZZ EFT",
        allocations: [
          { invoiceId: sept, amountCents: 40000 },
          { invoiceId: oct, amountCents: 30000 },
        ],
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 12345,
        receivedOn: "2026-10-10",
        voided: true,
      });

      await expect(
        getStatement(tx, crew, c.customerId, { from: "2026-10-01", to: "2026-10-31" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const statement = await getStatement(tx, manager, c.customerId, {
        from: "2026-10-01",
        to: "2026-10-31",
      });
      expect(statement?.customer).toMatchObject({
        id: c.customerId,
        number: c.number,
        displayName: c.displayName,
        address: "1 Test Road, Testville",
      });
      const data = statement?.data;
      expect(data).toMatchObject({
        openingCents: 40000,
        invoicedCents: 50000,
        paidCents: 70000,
        closingCents: 20000,
        creditCents: 0,
        byComplex: [],
      });
      expect(data?.entries.map((e) => [e.date, e.kind, e.label, e.balanceCents])).toEqual([
        ["2026-10-20", "INVOICE", expect.stringMatching(/^Invoice INV-2099-\d{4,}$/), 90000],
        ["2026-10-28", "PAYMENT", "Payment received, ref ZZ EFT", 20000],
      ]);
      const payment = data?.entries.find((e) => e.id === eft);
      expect(payment?.allocations.map((a) => [a.invoiceId, a.amountCents])).toEqual(
        expect.arrayContaining([
          [sept, 40000],
          [oct, 30000],
        ]),
      );
      expect(payment?.allocations).toHaveLength(2);
      for (const a of payment?.allocations ?? []) expect(a.reference).toMatch(/^INV-2099-\d{4,}$/);
      expect(data?.outstanding.map((o) => [o.id, o.balanceCents, o.overdue])).toEqual([
        [oct, 20000, true],
      ]);
    });
  });

  it("an agency: invoices of each complex, one payment over both, and a breakdown per complex", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx);
      const a = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        name: "ZZ E2E Complex A",
      });
      const b = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        name: "ZZ E2E Complex B",
      });
      const invA = await makeIssuedInvoice(tx, {
        customerId: a.customerId,
        billToCustomerId: agency.customerId,
        totalCents: 30000,
        issuedOn: "2026-11-20",
        dueDate: "2099-11-30",
      });
      await makeIssuedInvoice(tx, {
        customerId: b.customerId,
        billToCustomerId: agency.customerId,
        totalCents: 50000,
        issuedOn: "2026-11-20",
        dueDate: "2099-11-30",
      });
      await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 40000,
        receivedOn: "2026-11-21",
        allocations: [{ invoiceId: invA, amountCents: 30000 }],
      });
      const statement = await getStatement(tx, manager, agency.customerId, {
        from: "2026-11-01",
        to: "2026-11-30",
      });
      expect(statement?.data.byComplex).toEqual([
        {
          customerId: a.customerId,
          customerName: "ZZ E2E Complex A",
          invoicedCents: 30000,
          outstandingCents: 0,
        },
        {
          customerId: b.customerId,
          customerName: "ZZ E2E Complex B",
          invoicedCents: 50000,
          outstandingCents: 50000,
        },
      ]);
      expect(statement?.data.creditCents).toBe(10000);
      expect(statement?.data.closingCents).toBe(40000);
      // the complex's own statement is empty: its bills go to the agency
      const own = await getStatement(tx, manager, a.customerId, {
        from: "2026-11-01",
        to: "2026-11-30",
      });
      expect(own?.data.entries).toEqual([]);
    });
  });

  it("is worked out as at the end date: an allocation to an invoice issued later is not counted", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const early = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 50000,
        issuedOn: "2026-09-20",
        dueDate: "2026-09-30",
      });
      const late = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 50000,
        issuedOn: "2026-11-10",
        dueDate: "2026-11-30",
      });
      const paymentId = await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 60000,
        receivedOn: "2026-10-20",
        allocations: [
          { invoiceId: early, amountCents: 10000 },
          { invoiceId: late, amountCents: 50000 },
        ],
      });
      const statement = await getStatement(tx, manager, c.customerId, {
        from: "2026-10-01",
        to: "2026-10-31",
      });
      const data = statement?.data;
      expect(data).toMatchObject({
        openingCents: 50000,
        invoicedCents: 0,
        paidCents: 60000,
        closingCents: -10000,
        // 50000 of the payment went to an invoice that did not exist yet on 31 October
        creditCents: 50000,
      });
      expect(data?.outstanding.map((o) => [o.id, o.balanceCents])).toEqual([[early, 40000]]);
      const entry = data?.entries.find((e) => e.id === paymentId);
      expect(entry?.allocations.map((a) => [a.invoiceId, a.amountCents])).toEqual([[early, 10000]]);
    });
  });

  it("ignores a voided payment and its allocations, and shows credit on account", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 20000,
        issuedOn: "2026-10-02",
        dueDate: "2026-10-31",
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 20000,
        receivedOn: "2026-10-05",
        voided: true,
        allocations: [{ invoiceId: inv, amountCents: 20000 }],
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 35000,
        receivedOn: "2026-10-06",
        allocations: [{ invoiceId: inv, amountCents: 5000 }],
      });
      const statement = await getStatement(tx, manager, c.customerId, {
        from: "2026-10-01",
        to: "2026-10-31",
      });
      const data = statement?.data;
      expect(data).toMatchObject({
        openingCents: 0,
        invoicedCents: 20000,
        paidCents: 35000,
        closingCents: -15000,
        creditCents: 30000,
      });
      expect(data?.entries.filter((e) => e.kind === "PAYMENT")).toHaveLength(1);
      // the voided payment's allocation does not reduce the invoice: 15000 is still owed on it
      expect(data?.outstanding.map((o) => [o.id, o.balanceCents])).toEqual([[inv, 15000]]);
    });
  });

  it("still works for an archived customer", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx, { status: "ARCHIVED" });
      await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 10000,
        issuedOn: "2026-10-02",
        dueDate: "2026-10-31",
      });
      const statement = await getStatement(tx, manager, c.customerId, {
        from: "2026-10-01",
        to: "2026-10-31",
      });
      expect(statement?.customer.id).toBe(c.customerId);
      expect(statement?.data.closingCents).toBe(10000);
    });
  });

  it("refuses a bad period (before anything else) and returns null for an unknown or malformed customer id", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      await expect(
        getStatement(tx, manager, c.customerId, { from: "2026-12-01", to: "2026-11-01" }),
      ).rejects.toThrow("The start date must be on or before the end date.");
      await expect(
        getStatement(tx, manager, c.customerId, { from: "2026-13-01", to: "2026-11-01" }),
      ).rejects.toThrow("Choose valid dates.");
      // the period is checked even when the customer does not exist
      await expect(
        getStatement(tx, manager, "not-a-uuid", { from: "2026-12-01", to: "2026-11-01" }),
      ).rejects.toThrow("The start date must be on or before the end date.");
      expect(
        await getStatement(tx, manager, "11111111-1111-4111-8111-111111111111", {
          from: "2026-11-01",
          to: "2026-11-30",
        }),
      ).toBeNull();
      expect(
        await getStatement(tx, manager, "not-a-uuid", { from: "2026-11-01", to: "2026-11-30" }),
      ).toBeNull();
    });
  });
});

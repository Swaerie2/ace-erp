import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { isMonthlyDuplicate, lockCustomersInOrder, lockInvoiceRows } from "./store";
import { makeBillingCustomer, makeIssuedInvoice, makePayment } from "./test-helpers";

/** Runs `fn` and hands back what it threw (or null). A refused statement aborts the transaction, so each
 * case below runs in its own withRollback and does nothing after the refusal. */
const thrownBy = (fn: () => Promise<unknown>) =>
  fn().then(
    () => null,
    (error: unknown) => error,
  );

describe.skipIf(!dbTestsEnabled)("isMonthlyDuplicate against real database errors", () => {
  it("is true when a second monthly invoice for the same customer and month is refused", async () => {
    const error = await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const monthly = {
        customerId: c.customerId,
        kind: "MONTHLY" as const,
        serviceMonth: "2099-03",
        dueDate: "2099-03-31",
      };
      await makeIssuedInvoice(tx, monthly);
      return thrownBy(() => makeIssuedInvoice(tx, monthly));
    });
    expect(error).not.toBeNull();
    expect(isMonthlyDuplicate(error)).toBe(true);
  });

  it("is false when an invoice number is used twice", async () => {
    const error = await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const id = await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2099-03-31" });
      const taken = await tx.invoice.findUniqueOrThrow({
        where: { id },
        select: { numberYear: true, numberSeq: true },
      });
      return thrownBy(() =>
        tx.invoice.create({
          data: {
            customerId: c.customerId,
            billToCustomerId: c.customerId,
            kind: "ONCE_OFF",
            status: "ISSUED",
            numberYear: taken.numberYear,
            numberSeq: taken.numberSeq,
            dueDate: new Date(),
            issuedAt: new Date(),
            totalCents: 100,
          },
          select: { id: true },
        }),
      );
    });
    expect((error as { code?: unknown } | null)?.code).toBe("P2002");
    expect(isMonthlyDuplicate(error)).toBe(false);
  });

  it("is false when a payment is allocated to the same invoice twice", async () => {
    const error = await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const invoiceId = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-03-31",
      });
      const paymentId = await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 1000,
        receivedOn: "2026-11-01",
        allocations: [{ invoiceId, amountCents: 100 }],
      });
      return thrownBy(() =>
        tx.paymentAllocation.create({
          data: { paymentId, invoiceId, amountCents: 50 },
          select: { id: true },
        }),
      );
    });
    expect((error as { code?: unknown } | null)?.code).toBe("P2002");
    expect(isMonthlyDuplicate(error)).toBe(false);
  });
});

describe.skipIf(!dbTestsEnabled)("lock helpers", () => {
  it("lock rows given by uppercase ids", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const invoiceId = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-03-31",
      });
      await lockInvoiceRows(tx, [invoiceId.toUpperCase(), invoiceId]);
      await lockCustomersInOrder(tx, [c.customerId.toUpperCase(), c.customerId]);
      await expect(lockInvoiceRows(tx, [c.customerId])).rejects.toThrow(
        "That invoice could not be found.",
      );
    });
  });
});

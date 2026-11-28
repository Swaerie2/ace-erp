import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { allocatedByInvoice, allocatedByPayment, lockInvoiceRows, lockPaymentRow } from "./store";
import {
  addProperty,
  fillBankDetails,
  makeAcceptedQuote,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  onceOffQuoteLine,
  optionalLine,
  sameTx,
  serviceLine,
} from "./test-helpers";

// The helpers write straight to the database, so this checks they satisfy its constraints.
describe.skipIf(!dbTestsEnabled)("invoice test helpers and store sums", () => {
  it("build an agreement, invoices and payments the database accepts", async () => {
    await withRollback(async (tx) => {
      const agency = await makeBillingCustomer(tx, { email: null });
      const c = await makeBillingCustomer(tx, { managedById: agency.customerId });
      const second = await addProperty(tx, c.customerId);
      const q = await makeAcceptedQuote(tx, {
        customerId: c.customerId,
        propertyId: second,
        startDate: "2026-12-10",
        lines: [serviceLine(115000), optionalLine(20000, true), onceOffQuoteLine(50000)],
      });
      expect(q.lineIds).toHaveLength(3);
      const monthly = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        billToCustomerId: agency.customerId,
        kind: "MONTHLY",
        serviceMonth: "2099-02",
        dueDate: "2099-01-31",
        totalCents: 115000,
      });
      const onceOff = await makeIssuedInvoice(tx, {
        customerId: agency.customerId,
        dueDate: "2099-01-31",
      });
      const live = await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 150000,
        receivedOn: "2026-11-20",
        allocations: [
          { invoiceId: monthly, amountCents: 100000 },
          { invoiceId: onceOff, amountCents: 30000 },
        ],
      });
      const voided = await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 15000,
        receivedOn: "2026-11-21",
        allocations: [{ invoiceId: monthly, amountCents: 15000 }],
        voided: true,
      });
      await fillBankDetails(tx);

      await sameTx(tx)(async (t) => {
        await lockInvoiceRows(t, [onceOff, monthly, monthly]);
        await lockPaymentRow(t, live);
      });
      const byInvoice = await allocatedByInvoice(tx, [monthly, onceOff]);
      expect(byInvoice.get(monthly)).toBe(100000);
      expect(byInvoice.get(onceOff)).toBe(30000);
      const byPayment = await allocatedByPayment(tx, [live, voided]);
      expect(byPayment.get(live)).toBe(130000);
      expect(byPayment.get(voided)).toBe(15000);
    });
  });
});

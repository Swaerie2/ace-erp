import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { fromDateString, todaySA } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { recordPayment } from "./payments";
import { dismissPaymentReport, getPaymentReport, listPaymentReports } from "./reports";
import { auditFor, crew, makeBillingCustomer, makeIssuedInvoice, manager } from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

/** Stage 5b writes reports from the portal; here they are made directly. */
async function report(tx: Tx, invoiceId: string) {
  const r = await tx.paymentReport.create({
    data: { invoiceId, paidOn: fromDateString("2026-11-20"), reference: "ZZ CLIENT REF 9" },
    select: { id: true },
  });
  return r.id;
}

describe.skipIf(!dbTestsEnabled)("reported payments", () => {
  it("are listed while waiting, and confirming records the payment in the same step", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-01-31",
        totalCents: 50000,
      });
      const id = await report(tx, inv);
      await expect(listPaymentReports(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      const waiting = await listPaymentReports(tx, manager);
      const row = waiting.find((r) => r.id === id);
      expect(row).toMatchObject({
        status: "WAITING",
        paidOn: "2026-11-20",
        reference: "ZZ CLIENT REF 9",
      });
      expect(row?.invoice.billTo.id).toBe(c.customerId);
      expect(await getPaymentReport(tx, manager, id)).toMatchObject({
        invoiceId: inv,
        billToCustomerId: c.customerId,
      });

      const payment = await recordPayment(tx, manager, {
        payerCustomerId: c.customerId,
        receivedOn: todaySA(),
        amountCents: 50000,
        reference: null,
        note: null,
        allocations: [{ invoiceId: inv, amountCents: 50000 }],
        reportId: id,
      });
      const after = await tx.paymentReport.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe("CONFIRMED");
      expect(after.resolvedById).toBe(manager.id);
      const audit = await auditFor(tx, "invoice", inv);
      expect(audit.map((l) => l.action).sort()).toEqual([
        "invoice.payment_allocated",
        "invoice.report_confirmed",
      ]);
      expect(audit.find((l) => l.action === "invoice.report_confirmed")?.after).toEqual({
        reportId: id,
        paymentId: payment.id,
      });
      expect(JSON.stringify(audit)).not.toContain("ZZ CLIENT REF 9");
      expect((await listPaymentReports(tx, manager)).some((r) => r.id === id)).toBe(false);
      expect(
        (await listPaymentReports(tx, manager, { status: "ALL" })).some((r) => r.id === id),
      ).toBe(true);

      await expect(
        recordPayment(tx, manager, {
          payerCustomerId: c.customerId,
          receivedOn: todaySA(),
          amountCents: 100,
          reference: null,
          note: null,
          allocations: [],
          reportId: id,
        }),
      ).rejects.toThrow("This report has already been dealt with.");
    });
  });

  it("dismisses a report once, and refuses a report on someone else's invoice", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const other = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2099-01-31" });
      const id = await report(tx, inv);
      await expect(
        recordPayment(tx, manager, {
          payerCustomerId: other.customerId,
          receivedOn: todaySA(),
          amountCents: 100,
          reference: null,
          note: null,
          allocations: [],
          reportId: id,
        }),
      ).rejects.toThrow("That invoice is not billed to this payer.");
      await dismissPaymentReport(tx, manager, id);
      const row = await tx.paymentReport.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("DISMISSED");
      expect(row.resolvedAt).toBeInstanceOf(Date);
      await expect(dismissPaymentReport(tx, manager, id)).rejects.toThrow(
        "This report has already been dealt with.",
      );
      const audit = await auditFor(tx, "invoice", inv);
      expect(audit).toEqual([
        { action: "invoice.report_dismissed", after: { reportId: id }, actorId: manager.id },
      ]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { addDays, todaySA } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { getInvoice } from "./drafts";
import {
  allocatePayment,
  getPayment,
  listPayments,
  openInvoicesForPayer,
  recordPayment,
  unallocatePayment,
  voidPayment,
} from "./payments";
import type { PaymentInput } from "./schemas";
import {
  auditFor,
  crew,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
} from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

const input = (over: Partial<PaymentInput> & { payerCustomerId: string }): PaymentInput => ({
  receivedOn: todaySA(),
  amountCents: 100000,
  reference: "ZZ BANK REF 77",
  note: "ZZ note",
  allocations: [],
  reportId: null,
  ...over,
});

async function agencyWithTwoComplexes(tx: Tx) {
  const agency = await makeBillingCustomer(tx);
  const a = await makeBillingCustomer(tx, { managedById: agency.customerId });
  const b = await makeBillingCustomer(tx, { managedById: agency.customerId });
  const invA = await makeIssuedInvoice(tx, {
    customerId: a.customerId,
    billToCustomerId: agency.customerId,
    dueDate: "2026-10-31",
    totalCents: 60000,
  });
  const invB = await makeIssuedInvoice(tx, {
    customerId: b.customerId,
    billToCustomerId: agency.customerId,
    dueDate: "2026-11-30",
    totalCents: 40000,
  });
  return { agency, a, b, invA, invB };
}

describe.skipIf(!dbTestsEnabled)("recording payments", () => {
  it("records one EFT from an agency over two complexes' invoices, with fixed-word audit lines", async () => {
    await withRollback(async (tx) => {
      const { agency, a, invA, invB } = await agencyWithTwoComplexes(tx);
      const open = await openInvoicesForPayer(tx, manager, agency.customerId);
      expect(open.map((o) => [o.id, o.balanceCents])).toEqual([
        [invA, 60000],
        [invB, 40000],
      ]);
      expect(open[0]?.forName).toBe(a.displayName);

      await expect(
        recordPayment(tx, crew, input({ payerCustomerId: agency.customerId })),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const { id } = await recordPayment(
        tx,
        manager,
        input({
          payerCustomerId: agency.customerId,
          amountCents: 120000,
          allocations: [
            { invoiceId: invA, amountCents: 60000 },
            { invoiceId: invB, amountCents: 40000 },
          ],
        }),
      );
      const view = await getPayment(tx, manager, id);
      expect(view).toMatchObject({
        allocatedCents: 100000,
        unallocatedCents: 20000,
        reference: "ZZ BANK REF 77",
      });
      expect((await getInvoice(tx, manager, invA))?.displayStatus).toBe("PAID");
      expect((await getInvoice(tx, manager, invB))?.displayStatus).toBe("PAID");

      const paymentAudit = await auditFor(tx, "payment", id);
      expect(paymentAudit.map((l) => l.action)).toEqual(["payment.recorded"]);
      expect(paymentAudit[0]?.after).toEqual({ allocationCount: 2, fromReport: false });
      const invoiceAudit = await auditFor(tx, "invoice", invA);
      expect(invoiceAudit.map((l) => l.after)).toEqual([{ paymentId: id }]);
      const text = JSON.stringify([...paymentAudit, ...invoiceAudit]);
      expect(text).not.toContain("ZZ BANK REF 77");
      expect(text).not.toContain("ZZ note");

      const listed = await listPayments(tx, manager, { payerCustomerId: agency.customerId });
      expect(listed.items.map((p) => [p.id, p.unallocatedCents])).toEqual([[id, 20000]]);
    });
  });

  it("refuses allocations that break the rules", async () => {
    await withRollback(async (tx) => {
      const { agency, invA } = await agencyWithTwoComplexes(tx);
      const other = await makeBillingCustomer(tx);
      const otherInv = await makeIssuedInvoice(tx, {
        customerId: other.customerId,
        dueDate: "2026-10-31",
      });
      const draft = await tx.invoice.create({
        data: {
          customerId: agency.customerId,
          billToCustomerId: agency.customerId,
          kind: "ONCE_OFF",
        },
        select: { id: true },
      });
      const payer = agency.customerId;
      await expect(
        recordPayment(
          tx,
          manager,
          input({
            payerCustomerId: payer,
            allocations: [{ invoiceId: otherInv, amountCents: 100 }],
          }),
        ),
      ).rejects.toThrow("That invoice is not billed to this payer.");
      await expect(
        recordPayment(
          tx,
          manager,
          input({
            payerCustomerId: payer,
            allocations: [{ invoiceId: draft.id, amountCents: 100 }],
          }),
        ),
      ).rejects.toThrow("Payments can only be allocated to issued invoices.");
      await expect(
        recordPayment(
          tx,
          manager,
          input({ payerCustomerId: payer, allocations: [{ invoiceId: invA, amountCents: 60001 }] }),
        ),
      ).rejects.toThrow("That is more than the invoice still owes.");
      await expect(
        recordPayment(
          tx,
          manager,
          input({
            payerCustomerId: payer,
            amountCents: 1000,
            allocations: [{ invoiceId: invA, amountCents: 1001 }],
          }),
        ),
      ).rejects.toThrow("The amounts allocated add up to more than the payment.");
      await expect(
        recordPayment(
          tx,
          manager,
          input({
            payerCustomerId: payer,
            allocations: [
              { invoiceId: invA, amountCents: 100 },
              { invoiceId: invA, amountCents: 100 },
            ],
          }),
        ),
      ).rejects.toThrow("Each invoice can be listed only once.");
      await expect(
        recordPayment(
          tx,
          manager,
          input({ payerCustomerId: payer, receivedOn: addDays(todaySA(), 1) }),
        ),
      ).rejects.toThrow("Choose the date the money arrived (not in the future).");
      // The same invoice in another letter case is still a duplicate (it never reaches the unique pair).
      await expect(
        recordPayment(
          tx,
          manager,
          input({
            payerCustomerId: payer,
            allocations: [
              { invoiceId: invA, amountCents: 100 },
              { invoiceId: invA.toUpperCase(), amountCents: 100 },
            ],
          }),
        ),
      ).rejects.toThrow("Each invoice can be listed only once.");
      // Ids that are not UUIDs are refused before they reach the database (the transaction stays usable).
      await expect(
        recordPayment(
          tx,
          manager,
          input({ payerCustomerId: payer, allocations: [{ invoiceId: "nope", amountCents: 100 }] }),
        ),
      ).rejects.toThrow("That invoice could not be found.");
      await expect(
        allocatePayment(tx, manager, { paymentId: "nope", invoiceId: invA, amountCents: 1 }),
      ).rejects.toThrow("That payment could not be found.");
      await expect(unallocatePayment(tx, manager, "nope")).rejects.toThrow(
        "That allocation could not be found.",
      );
      await expect(voidPayment(tx, manager, "nope", "ZZ test")).rejects.toThrow(
        "That payment could not be found.",
      );
      expect(await getPayment(tx, manager, "nope")).toBeNull();
      expect(await tx.payment.count({ where: { payerCustomerId: payer } })).toBe(0);
    });
  });

  it("allocates credit later, adds to an existing allocation, and removes one", async () => {
    await withRollback(async (tx) => {
      const { agency, invA } = await agencyWithTwoComplexes(tx);
      const { id } = await recordPayment(
        tx,
        manager,
        input({ payerCustomerId: agency.customerId, amountCents: 50000 }),
      );
      await allocatePayment(tx, manager, { paymentId: id, invoiceId: invA, amountCents: 20000 });
      await allocatePayment(tx, manager, { paymentId: id, invoiceId: invA, amountCents: 10000 });
      const rows = await tx.paymentAllocation.findMany({
        where: { paymentId: id },
        select: { id: true, amountCents: true },
      });
      expect(rows.map((r) => r.amountCents)).toEqual([30000]);
      await expect(
        allocatePayment(tx, manager, { paymentId: id, invoiceId: invA, amountCents: 20001 }),
      ).rejects.toThrow("That is more than is left of the payment.");
      await unallocatePayment(tx, manager, rows[0]?.id ?? "");
      expect((await getPayment(tx, manager, id))?.unallocatedCents).toBe(50000);
      // Lines written in one transaction can share the same `at`, so their order is not reliable: compare sorted.
      expect((await auditFor(tx, "payment", id)).map((l) => l.action).sort()).toEqual([
        "payment.allocated",
        "payment.allocated",
        "payment.recorded",
        "payment.unallocated",
      ]);
    });
  });

  it("voiding a payment stops its allocations counting and blocks further changes", async () => {
    await withRollback(async (tx) => {
      const { agency, invA } = await agencyWithTwoComplexes(tx);
      const id = await makePayment(tx, {
        payerCustomerId: agency.customerId,
        amountCents: 60000,
        receivedOn: "2026-11-01",
        allocations: [{ invoiceId: invA, amountCents: 60000 }],
      });
      expect((await getInvoice(tx, manager, invA))?.displayStatus).toBe("PAID");
      await expect(voidPayment(tx, manager, id, " ")).rejects.toThrow("Say why in a few words.");
      await voidPayment(tx, manager, id, "ZZ bounced");
      expect((await getInvoice(tx, manager, invA))?.balanceCents).toBe(60000);
      const allocation = await tx.paymentAllocation.findFirstOrThrow({
        where: { paymentId: id },
        select: { id: true },
      });
      await expect(unallocatePayment(tx, manager, allocation.id)).rejects.toThrow(
        "This payment has been voided.",
      );
      await expect(
        allocatePayment(tx, manager, { paymentId: id, invoiceId: invA, amountCents: 1 }),
      ).rejects.toThrow("This payment has been voided.");
      await expect(voidPayment(tx, manager, id, "again")).rejects.toThrow(
        "This payment has been voided.",
      );
      const audit = await auditFor(tx, "payment", id);
      expect(audit.map((l) => l.after)).toEqual([{ allocationCount: 1 }]);
      expect(JSON.stringify(audit)).not.toContain("ZZ bounced");
    });
  });
});

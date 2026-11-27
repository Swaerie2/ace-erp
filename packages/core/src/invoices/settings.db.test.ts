import { describe, expect, it } from "vitest";
import { DomainError, ForbiddenError } from "../customers/access";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { invoiceSnapshotSchema } from "./schemas";
import {
  buildInvoiceSnapshot,
  getInvoiceSettings,
  invoiceSettingsStatus,
  readInvoiceSettings,
  setBillingTiming,
  updateInvoiceSettings,
} from "./settings";
import { auditFor, crew, makeBillingCustomer, manager, owner } from "./test-helpers";

const INPUT = {
  bankName: "ZZ Test Bank",
  accountHolder: "ACE Garden Services",
  accountNumber: "9876543210",
  branchCode: "250655",
  accountType: "Business cheque",
  onceOffDueDays: 10,
  lateFeeCents: 15000,
};

describe.skipIf(!dbTestsEnabled)("invoice settings", () => {
  it("only the owner can read and change them; managers see whether bank details are ready", async () => {
    await withRollback(async (tx) => {
      await expect(getInvoiceSettings(tx, manager)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateInvoiceSettings(tx, manager, INPUT)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(invoiceSettingsStatus(tx, crew)).rejects.toBeInstanceOf(ForbiddenError);
      await updateInvoiceSettings(tx, owner, INPUT);
      const row = await getInvoiceSettings(tx, owner);
      expect(row).toMatchObject(INPUT);
      expect(await invoiceSettingsStatus(tx, manager)).toEqual({
        bankReady: true,
        onceOffDueDays: 10,
        lateFeeCents: 15000,
      });
    });
  });

  it("records the changed field names only, and an unchanged save writes nothing", async () => {
    await withRollback(async (tx) => {
      await updateInvoiceSettings(tx, owner, INPUT);
      const savedAt = (await readInvoiceSettings(tx)).updatedAt;
      await updateInvoiceSettings(tx, owner, INPUT);
      expect((await readInvoiceSettings(tx)).updatedAt).toEqual(savedAt);
      await updateInvoiceSettings(tx, owner, { ...INPUT, lateFeeCents: 20000 });
      const lines = (await auditFor(tx, "invoice_settings", "singleton")).filter(
        (l) => l.actorId === owner.id,
      );
      expect(lines.map((l) => l.action)).toEqual([
        "invoice_settings.updated",
        "invoice_settings.updated",
      ]);
      // Two writes in one transaction can share a timestamp, so do not rely on their order.
      expect(lines.map((l) => l.after)).toContainEqual({ changed: ["lateFeeCents"] });
      const text = JSON.stringify(lines);
      expect(text).not.toContain("9876543210");
      expect(text).not.toContain("ZZ Test Bank");
      expect(text).not.toContain("ACE Garden Services");
    });
  });
});

describe.skipIf(!dbTestsEnabled)("invoice settings lock", () => {
  it("a save locks the settings row first, even when it changes nothing", async () => {
    await withRollback(async (first) => {
      const s = await readInvoiceSettings(first);
      // Nothing changes, so this writes nothing, but it still holds the row lock until `first` ends.
      await updateInvoiceSettings(first, owner, {
        bankName: s.bankName,
        accountHolder: s.accountHolder,
        accountNumber: s.accountNumber,
        branchCode: s.branchCode,
        accountType: s.accountType,
        onceOffDueDays: s.onceOffDueDays,
        lateFeeCents: s.lateFeeCents,
      });
      expect(await auditFor(first, "invoice_settings", "singleton")).not.toContainEqual(
        expect.objectContaining({ actorId: owner.id }),
      );
      const second = withRollback(async (tx) => {
        await tx.$executeRaw`set local lock_timeout = '1000ms'`;
        await updateInvoiceSettings(tx, owner, INPUT);
      });
      await expect(second).rejects.toThrow(/lock timeout/i);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("invoice snapshot", () => {
  it("holds ACE's bank and business details and the bill-to customer's number as reference", async () => {
    await withRollback(async (tx) => {
      await updateInvoiceSettings(tx, owner, INPUT);
      const snapshot = await buildInvoiceSnapshot(tx, await readInvoiceSettings(tx), 123);
      expect(invoiceSnapshotSchema.parse(snapshot)).toEqual(snapshot);
      expect(snapshot.bank).toEqual({
        bankName: INPUT.bankName,
        accountHolder: INPUT.accountHolder,
        accountNumber: INPUT.accountNumber,
        branchCode: INPUT.branchCode,
        accountType: INPUT.accountType,
      });
      expect(snapshot.paymentReference).toBe("C-0123");
      expect(snapshot.business.legalName.length).toBeGreaterThan(0);
    });
  });

  it("carries the company address when there is one, and leaves it out when it is blank", async () => {
    await withRollback(async (tx) => {
      const setAddress = (line1: string, postalCode: string) =>
        tx.organisationSettings.update({
          where: { id: "singleton" },
          data: {
            addressLine1: line1,
            addressLine2: "",
            addressSuburb: "",
            addressCity: "",
            addressPostalCode: postalCode,
          },
          select: { id: true },
        });
      const settings = await readInvoiceSettings(tx);
      await setAddress("", "");
      const blank = await buildInvoiceSnapshot(tx, settings, 1);
      expect(Object.keys(blank.business)).not.toContain("address");
      await setAddress("1 ZZ Test Road", "0000");
      const withAddress = await buildInvoiceSnapshot(tx, settings, 1);
      expect(withAddress.business.address).toBe("1 ZZ Test Road, 0000");
      expect(invoiceSnapshotSchema.parse(withAddress)).toEqual(withAddress);
      // A snapshot frozen before addresses existed still parses.
      expect(invoiceSnapshotSchema.parse(JSON.parse(JSON.stringify(blank)))).toEqual(blank);
    });
  });
});

describe.skipIf(!dbTestsEnabled)("billing timing", () => {
  it("a manager switches a customer to Post; the audit holds the fixed word only", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      await expect(setBillingTiming(tx, crew, c.customerId, "POST")).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await setBillingTiming(tx, manager, c.customerId, "POST");
      await setBillingTiming(tx, manager, c.customerId, "POST");
      const row = await tx.customer.findUniqueOrThrow({
        where: { id: c.customerId },
        select: { billingTiming: true },
      });
      expect(row.billingTiming).toBe("POST");
      const lines = (await auditFor(tx, "customer", c.customerId)).filter(
        (l) => l.action === "customer.billing_timing_changed",
      );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.after).toEqual({ billingTiming: "POST" });
      expect(JSON.stringify(lines)).not.toContain(c.displayName);
    });
  });

  it("refuses an anonymised customer", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      await tx.customer.update({
        where: { id: c.customerId },
        data: { anonymisedAt: new Date() },
        select: { id: true },
      });
      await expect(setBillingTiming(tx, manager, c.customerId, "POST")).rejects.toBeInstanceOf(
        DomainError,
      );
      const row = await tx.customer.findUniqueOrThrow({
        where: { id: c.customerId },
        select: { billingTiming: true },
      });
      expect(row.billingTiming).toBe("PRE");
    });
  });
});

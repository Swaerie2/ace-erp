import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../customers/access";
import { formatCustomerNumber } from "../customers/number";
import { addDays, formatDateSA, fromDateString, todaySA } from "../quotes/reference";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { loadInvoiceDocument, loadStatementDocument } from "./document";
import {
  crew,
  fillBankDetails,
  makeBillingCustomer,
  makeIssuedInvoice,
  makePayment,
  manager,
} from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];

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

async function setLiveAddress(tx: Tx, line1: string) {
  await tx.organisationSettings.update({
    where: { id: "singleton" },
    data: {
      addressLine1: line1,
      addressLine2: "",
      addressSuburb: "",
      addressCity: "",
      addressPostalCode: "",
    },
    select: { id: true },
  });
}

async function makeDraft(
  tx: Tx,
  input: { customerId: string; billToCustomerId: string; dueDate?: string },
) {
  const inv = await tx.invoice.create({
    data: {
      customerId: input.customerId,
      billToCustomerId: input.billToCustomerId,
      kind: "ONCE_OFF",
      status: "DRAFT",
      ...(input.dueDate ? { dueDate: fromDateString(input.dueDate) } : {}),
      lines: {
        create: [
          { sortOrder: 1, kind: "ONCE_OFF", description: "ZZ E2E draft work", amountCents: 25000 },
        ],
      },
    },
    select: { id: true },
  });
  return inv.id;
}

describe.skipIf(!dbTestsEnabled)("invoice and statement documents", () => {
  it("an issued invoice uses its frozen details, never the live settings, and counts only live payments", async () => {
    await withRollback(async (tx) => {
      await fillBankDetails(tx); // the live settings now say "ZZ Test Bank"
      const c = await makeBillingCustomer(tx);
      const id = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 100000,
        dueDate: "2099-12-31",
        issuedOn: "2026-11-20",
      });
      await tx.invoice.update({
        where: { id },
        data: { bankSnapshot: FROZEN },
        select: { id: true },
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 30000,
        receivedOn: "2026-11-21",
        allocations: [{ invoiceId: id, amountCents: 30000 }],
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 50000,
        receivedOn: "2026-11-22",
        voided: true,
        allocations: [{ invoiceId: id, amountCents: 50000 }],
      });

      const loaded = await loadInvoiceDocument(tx, manager, id);
      const doc = loaded?.doc;
      expect(doc).toMatchObject({
        reference: expect.stringMatching(/^INV-2099-\d{4,}$/),
        status: "PART_PAID",
        totalLabel: "R1,000.00",
        paidLabel: "R300.00",
        balanceLabel: "R700.00",
        billTo: { name: "ZZ E2E Recipient", address: "1 Test Road, Testville" },
        forCustomerName: null,
        paymentReference: "C-9999",
        bankReady: true,
      });
      expect(doc?.bank).toEqual(FROZEN.bank);
      expect(doc?.business).toEqual({ ...FROZEN.business, address: null });
      expect(doc?.issuedDate).toMatch(/20\sNov\s2026/);
      expect(doc?.dueDate).toMatch(/31\sDec\s2099/);

      // an invoice with no saved details cannot be shown (never a silent fallback to the live settings)
      const bare = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-12-31",
      });
      await expect(loadInvoiceDocument(tx, manager, bare)).rejects.toThrow(
        /saved business details/,
      );
    });
  });

  it("a draft is built from the live bill-to customer and live settings, with a due date of today plus the once-off days", async () => {
    await withRollback(async (tx) => {
      await fillBankDetails(tx);
      await tx.invoiceSettings.update({
        where: { id: "singleton" },
        data: { onceOffDueDays: 14 },
        select: { id: true },
      });
      const org = await tx.organisationSettings.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { legalName: true },
      });
      const agency = await makeBillingCustomer(tx);
      const complex = await makeBillingCustomer(tx, {
        managedById: agency.customerId,
        name: "ZZ E2E Complex A",
      });
      const id = await makeDraft(tx, {
        customerId: complex.customerId,
        billToCustomerId: complex.customerId, // stale: billing now goes to the agency
      });

      const doc = (await loadInvoiceDocument(tx, manager, id))?.doc;
      expect(doc).toMatchObject({
        reference: "Draft",
        status: "DRAFT",
        banner: "Draft: not yet issued.",
        billTo: { name: agency.displayName, address: "1 Test Road, Testville" },
        forCustomerName: "ZZ E2E Complex A",
        paymentReference: formatCustomerNumber(agency.number),
        totalLabel: "R250.00",
        paidLabel: null,
        balanceLabel: null,
        issuedDate: null,
      });
      expect(doc?.bank.bankName).toBe("ZZ Test Bank");
      expect(doc?.business.legalName).toBe(org.legalName);
      expect(doc?.dueDate).toBe(formatDateSA(fromDateString(addDays(todaySA(), 14))));

      const dated = await makeDraft(tx, {
        customerId: agency.customerId,
        billToCustomerId: agency.customerId,
        dueDate: "2099-01-15",
      });
      expect((await loadInvoiceDocument(tx, manager, dated))?.doc.dueDate).toMatch(/15\sJan\s2099/);
    });
  });

  it("an issued invoice shows its FROZEN company address, a draft and a statement the live one, and all carry the logo version", async () => {
    await withRollback(async (tx) => {
      await fillBankDetails(tx);
      await tx.companyLogo.deleteMany({ where: { id: "singleton" } });
      await setLiveAddress(tx, "2 ZZ Live Road");
      const c = await makeBillingCustomer(tx);
      const issued = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        dueDate: "2099-12-31",
      });
      await tx.invoice.update({
        where: { id: issued },
        data: {
          bankSnapshot: {
            ...FROZEN,
            business: { ...FROZEN.business, address: "1 ZZ Frozen Road, Frozencity" },
          },
        },
        select: { id: true },
      });
      const draft = await makeDraft(tx, {
        customerId: c.customerId,
        billToCustomerId: c.customerId,
      });
      const period = { from: "2026-11-01", to: "2026-11-30" };

      const issuedDoc = (await loadInvoiceDocument(tx, manager, issued))?.doc;
      expect(issuedDoc?.business.address).toBe("1 ZZ Frozen Road, Frozencity");
      expect(issuedDoc?.logoVersion).toBeNull();
      expect((await loadInvoiceDocument(tx, manager, draft))?.doc.business.address).toBe(
        "2 ZZ Live Road",
      );
      expect(
        (await loadStatementDocument(tx, manager, c.customerId, period))?.doc.business.address,
      ).toBe("2 ZZ Live Road");

      await tx.companyLogo.create({
        data: {
          id: "singleton",
          data: Uint8Array.from([1]),
          contentType: "image/png",
          byteSize: 1,
        },
        select: { id: true },
      });
      const logo = await tx.companyLogo.findUniqueOrThrow({
        where: { id: "singleton" },
        select: { updatedAt: true },
      });
      const version = String(logo.updatedAt.getTime());
      expect((await loadInvoiceDocument(tx, manager, issued))?.doc.logoVersion).toBe(version);
      expect((await loadInvoiceDocument(tx, manager, draft))?.doc.logoVersion).toBe(version);
      expect(
        (await loadStatementDocument(tx, manager, c.customerId, period))?.doc.logoVersion,
      ).toBe(version);
    });
  });

  it("is for owner and manager only, and gives null for a malformed or unknown id", async () => {
    await withRollback(async (tx) => {
      const c = await makeBillingCustomer(tx);
      const id = await makeIssuedInvoice(tx, { customerId: c.customerId, dueDate: "2099-12-31" });
      await expect(loadInvoiceDocument(tx, crew, id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        loadStatementDocument(tx, crew, c.customerId, { from: "2026-11-01", to: "2026-11-30" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const period = { from: "2026-11-01", to: "2026-11-30" };
      expect(await loadInvoiceDocument(tx, manager, "not-a-uuid")).toBeNull();
      expect(
        await loadInvoiceDocument(tx, manager, "00000000-0000-4000-8000-000000000000"),
      ).toBeNull();
      expect(await loadStatementDocument(tx, manager, "not-a-uuid", period)).toBeNull();
      expect(
        await loadStatementDocument(tx, manager, "00000000-0000-4000-8000-000000000000", period),
      ).toBeNull();
    });
  });

  it("a statement uses ACE's current details and says which invoices a payment settled", async () => {
    await withRollback(async (tx) => {
      await fillBankDetails(tx);
      const c = await makeBillingCustomer(tx);
      const inv = await makeIssuedInvoice(tx, {
        customerId: c.customerId,
        totalCents: 80000,
        issuedOn: "2026-11-20",
        dueDate: "2026-11-30",
      });
      await makePayment(tx, {
        payerCustomerId: c.customerId,
        amountCents: 50000,
        receivedOn: "2026-11-25",
        reference: "ZZ EFT",
        allocations: [{ invoiceId: inv, amountCents: 50000 }],
      });

      const loaded = await loadStatementDocument(tx, manager, c.customerId, {
        from: "2026-11-01",
        to: "2026-11-30",
      });
      expect(loaded?.customer).toMatchObject({ id: c.customerId, number: c.number });
      const doc = loaded?.doc;
      expect(doc?.bank.bankName).toBe("ZZ Test Bank");
      expect(doc).toMatchObject({
        paymentReference: formatCustomerNumber(c.number),
        customer: { name: c.displayName, number: formatCustomerNumber(c.number) },
        summary: {
          invoiced: "R800.00",
          paid: "R500.00",
          closing: "R300.00",
          closingNote: "Amount due",
        },
      });
      expect(doc?.rows.map((r) => r.description)).toEqual([
        expect.stringMatching(/^Invoice INV-2099-\d{4,}$/),
        expect.stringMatching(/^Payment received, ref ZZ EFT \(applied to INV-2099-\d{4,}\)$/),
      ]);
      await expect(
        loadStatementDocument(tx, manager, c.customerId, { from: "2026-12-01", to: "2026-11-01" }),
      ).rejects.toThrow(/start date/);
    });
  });
});

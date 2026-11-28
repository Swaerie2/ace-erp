import { randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma } from "../generated/prisma/client";
import { dbTestsEnabled, withRollback } from "../testing/rollback";

const TABLES = [
  "invoice_settings",
  "invoice_counters",
  "invoices",
  "invoice_lines",
  "payments",
  "payment_allocations",
  "payment_reports",
];

type Tx = Prisma.TransactionClient;
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function customer(tx: Tx): Promise<string> {
  const c = await tx.customer.create({
    data: { type: "COMPANY", displayName: "ZZ E2E Invoice Protection" },
    select: { id: true },
  });
  return c.id;
}

async function draft(
  tx: Tx,
  customerId: string,
  data: Partial<Prisma.InvoiceUncheckedCreateInput> = {},
) {
  return tx.invoice.create({
    data: { customerId, billToCustomerId: customerId, kind: "ONCE_OFF", ...data },
    select: { id: true },
  });
}

async function issued(
  tx: Tx,
  customerId: string,
  data: Partial<Prisma.InvoiceUncheckedCreateInput> = {},
) {
  return draft(tx, customerId, {
    status: "ISSUED",
    numberYear: 2099,
    numberSeq: randomInt(1, 2_000_000_000),
    dueDate: day("2099-01-31"),
    issuedAt: new Date(),
    totalCents: 1000,
    ...data,
  });
}

describe.skipIf(!dbTestsEnabled)("invoice database protections", () => {
  it("has row level security on for every invoice table", async () => {
    await withRollback(async (tx) => {
      const rls = await tx.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
        select relname, relrowsecurity from pg_class
        where relname in ('invoice_settings', 'invoice_counters', 'invoices', 'invoice_lines',
                          'payments', 'payment_allocations', 'payment_reports')`;
      expect(rls.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
      for (const row of rls) expect(row.relrowsecurity, row.relname).toBe(true);
    });
  });

  it("gives the public roles no access, and gives the portal role nothing yet", async () => {
    await withRollback(async (tx) => {
      const roles = await tx.$queryRaw<{ rolname: string }[]>`
        select rolname from pg_roles where rolname in ('anon', 'authenticated', 'ace_portal')`;
      expect(roles.map((r) => r.rolname).sort()).toEqual(["ace_portal", "anon", "authenticated"]);
      for (const { rolname } of roles) {
        for (const table of TABLES) {
          for (const p of ["select", "insert", "update", "delete"]) {
            const [row] = await tx.$queryRaw<{ allowed: boolean }[]>`
              select has_table_privilege(${rolname}, ${table}, ${p}) as allowed`;
            expect(row?.allowed, `${rolname} ${p} on ${table}`).toBe(false);
          }
        }
      }
      const [col] = await tx.$queryRaw<{ allowed: boolean }[]>`
        select has_column_privilege('ace_portal', 'customers', 'billingTiming', 'select') as allowed`;
      expect(col?.allowed).toBe(false);
    });
  });

  it("blocks the public API from reading invoices and payments", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(url && key).toBeTruthy();
    for (const table of ["invoices", "payments", "invoice_settings"]) {
      const res = await fetch(`${url}/rest/v1/${table}?select=*`, {
        headers: { apikey: key!, Authorization: `Bearer ${key}` },
      });
      expect([401, 403, 404], table).toContain(res.status);
    }
  });

  it("seeds the settings row with empty bank details, 14 due days and a R100 late fee", async () => {
    await withRollback(async (tx) => {
      const row = await tx.invoiceSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      expect(row.onceOffDueDays).toBe(14);
      expect(row.lateFeeCents).toBe(10000);
      expect(row.bankName).toBe("");
      expect(row.accountHolder).toBe("");
      expect(row.accountNumber).toBe("");
      expect(row.branchCode).toBe("");
      expect(row.accountType).toBe("");
    });
  });

  it("gives every customer Pre billing by default", async () => {
    await withRollback(async (tx) => {
      const id = await customer(tx);
      const row = await tx.customer.findUniqueOrThrow({
        where: { id },
        select: { billingTiming: true },
      });
      expect(row.billingTiming).toBe("PRE");
    });
  });

  it("rejects a second settings row", async () => {
    await expect(
      withRollback((tx) => tx.invoiceSettings.create({ data: { id: "other" } })),
    ).rejects.toThrow(/invoice_settings_singleton/);
  });

  it("rejects a once-off due days setting above 90", async () => {
    await expect(
      withRollback((tx) =>
        tx.invoiceSettings.update({ where: { id: "singleton" }, data: { onceOffDueDays: 91 } }),
      ),
    ).rejects.toThrow(/invoice_settings_due_days_range/);
  });

  it("rejects a draft that has a number", async () => {
    await expect(
      withRollback(async (tx) => {
        await draft(tx, await customer(tx), { numberYear: 2099, numberSeq: 1 });
      }),
    ).rejects.toThrow(/invoices_number_iff_not_draft/);
  });

  it("rejects an issued invoice without a total", async () => {
    await expect(
      withRollback(async (tx) => {
        await issued(tx, await customer(tx), { totalCents: null });
      }),
    ).rejects.toThrow(/invoices_issued_complete/);
  });

  it("rejects a total of zero", async () => {
    await expect(
      withRollback(async (tx) => {
        await issued(tx, await customer(tx), { totalCents: 0 });
      }),
    ).rejects.toThrow(/invoices_total_positive/);
  });

  it("rejects a monthly invoice without a service month", async () => {
    await expect(
      withRollback(async (tx) => {
        await draft(tx, await customer(tx), { kind: "MONTHLY" });
      }),
    ).rejects.toThrow(/invoices_service_month_iff_monthly/);
  });

  it("rejects a service month that is not the first of the month", async () => {
    await expect(
      withRollback(async (tx) => {
        await draft(tx, await customer(tx), { kind: "MONTHLY", serviceMonth: day("2099-03-15") });
      }),
    ).rejects.toThrow(/invoices_service_month_first_day/);
  });

  it("rejects a void invoice without a void date", async () => {
    await expect(
      withRollback(async (tx) => {
        await issued(tx, await customer(tx), { status: "VOID" });
      }),
    ).rejects.toThrow(/invoices_void_iff_voided/);
  });

  it("allows only one live monthly invoice per customer and service month", async () => {
    await expect(
      withRollback(async (tx) => {
        const id = await customer(tx);
        const month = { kind: "MONTHLY" as const, serviceMonth: day("2099-04-01") };
        await draft(tx, id, month);
        await draft(tx, id, month);
      }),
    ).rejects.toThrow(
      /invoices_monthly_once_per_month|Unique constraint.*customerId.*serviceMonth/s,
    );
  });

  it("allows a new monthly invoice for the month when the earlier one is void", async () => {
    await withRollback(async (tx) => {
      const id = await customer(tx);
      const month = { kind: "MONTHLY" as const, serviceMonth: day("2099-05-01") };
      await issued(tx, id, { ...month, status: "VOID", voidedAt: new Date() });
      const second = await draft(tx, id, month);
      expect(second.id).toBeTruthy();
    });
  });

  it("rejects a line of zero", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await draft(tx, await customer(tx));
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "ONCE_OFF",
            description: "x",
            amountCents: 0,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_amount_not_zero/);
  });

  it("rejects a negative line that is not an adjustment", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await draft(tx, await customer(tx));
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "SERVICE",
            description: "x",
            amountCents: -100,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_negative_only_adjustment/);
  });

  it("allows a negative adjustment", async () => {
    await withRollback(async (tx) => {
      const inv = await draft(tx, await customer(tx));
      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: inv.id,
          sortOrder: 1,
          kind: "ADJUSTMENT",
          description: "Discount",
          amountCents: -500,
        },
        select: { amountCents: true },
      });
      expect(line.amountCents).toBe(-500);
    });
  });

  it("rejects a late fee line that names no invoice", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await draft(tx, await customer(tx));
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "LATE_FEE",
            description: "Late payment fee",
            amountCents: 10000,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_late_fee_target/);
  });

  it("rejects an empty line description", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await draft(tx, await customer(tx));
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "ONCE_OFF",
            description: "",
            amountCents: 100,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_description_length/);
  });

  it("rejects a payment of zero", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.payment.create({
          data: {
            payerCustomerId: await customer(tx),
            receivedOn: day("2099-01-01"),
            amountCents: 0,
            recordedById: "staff",
          },
        });
      }),
    ).rejects.toThrow(/payments_amount_positive/);
  });

  it("rejects an allocation of zero", async () => {
    await expect(
      withRollback(async (tx) => {
        const id = await customer(tx);
        const inv = await issued(tx, id);
        const pay = await tx.payment.create({
          data: {
            payerCustomerId: id,
            receivedOn: day("2099-01-01"),
            amountCents: 100,
            recordedById: "staff",
          },
          select: { id: true },
        });
        await tx.paymentAllocation.create({
          data: { paymentId: pay.id, invoiceId: inv.id, amountCents: 0 },
        });
      }),
    ).rejects.toThrow(/payment_allocations_amount_positive/);
  });

  it("rejects a resolved payment report without a resolved date", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await issued(tx, await customer(tx));
        await tx.paymentReport.create({
          data: { invoiceId: inv.id, paidOn: day("2099-01-01"), status: "CONFIRMED" },
        });
      }),
    ).rejects.toThrow(/payment_reports_resolved_iff_not_waiting/);
  });

  it("rejects an invoice counter below 1", async () => {
    await expect(
      withRollback((tx) => tx.invoiceCounter.create({ data: { year: 2098, lastSeq: 0 } })),
    ).rejects.toThrow(/invoice_counters_seq_positive/);
  });

  it("rejects two invoices with the same number", async () => {
    await expect(
      withRollback(async (tx) => {
        const id = await customer(tx);
        const numberSeq = randomInt(1, 2_000_000_000);
        await issued(tx, id, { numberSeq });
        await issued(tx, id, { numberSeq });
      }),
    ).rejects.toThrow(/invoices_numberYear_numberSeq_key|Unique constraint/);
  });

  it("rejects an invoice number with a year but no sequence", async () => {
    await expect(
      withRollback(async (tx) => {
        await issued(tx, await customer(tx), { numberSeq: null });
      }),
    ).rejects.toThrow(/invoices_number_pair/);
  });

  it("rejects an invoice number sequence below 1", async () => {
    await expect(
      withRollback(async (tx) => {
        await issued(tx, await customer(tx), { numberSeq: 0 });
      }),
    ).rejects.toThrow(/invoices_number_seq_positive/);
  });

  it("rejects a second allocation row for the same payment and invoice", async () => {
    await expect(
      withRollback(async (tx) => {
        const id = await customer(tx);
        const inv = await issued(tx, id);
        const pay = await tx.payment.create({
          data: {
            payerCustomerId: id,
            receivedOn: day("2099-01-01"),
            amountCents: 100,
            recordedById: "staff",
          },
          select: { id: true },
        });
        await tx.paymentAllocation.create({
          data: { paymentId: pay.id, invoiceId: inv.id, amountCents: 50 },
        });
        await tx.paymentAllocation.create({
          data: { paymentId: pay.id, invoiceId: inv.id, amountCents: 50 },
        });
      }),
    ).rejects.toThrow(/payment_allocations_paymentId_invoiceId_key|Unique constraint/);
  });

  it("rejects a line that names another invoice but is not a late fee", async () => {
    await expect(
      withRollback(async (tx) => {
        const id = await customer(tx);
        const overdue = await issued(tx, id);
        const inv = await draft(tx, id);
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "SERVICE",
            description: "x",
            amountCents: 100,
            forInvoiceId: overdue.id,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_for_invoice_ok/);
  });

  it("rejects a late fee charged against its own invoice", async () => {
    await expect(
      withRollback(async (tx) => {
        const inv = await draft(tx, await customer(tx));
        await tx.invoiceLine.create({
          data: {
            invoiceId: inv.id,
            sortOrder: 1,
            kind: "LATE_FEE",
            description: "Late payment fee",
            amountCents: 10000,
            forInvoiceId: inv.id,
          },
        });
      }),
    ).rejects.toThrow(/invoice_lines_for_invoice_ok/);
  });

  it("allows a late fee charged against another invoice", async () => {
    await withRollback(async (tx) => {
      const id = await customer(tx);
      const overdue = await issued(tx, id);
      const inv = await draft(tx, id);
      const line = await tx.invoiceLine.create({
        data: {
          invoiceId: inv.id,
          sortOrder: 1,
          kind: "LATE_FEE",
          description: "Late payment fee",
          amountCents: 10000,
          forInvoiceId: overdue.id,
        },
        select: { forInvoiceId: true },
      });
      expect(line.forInvoiceId).toBe(overdue.id);
    });
  });

  it("rejects a voided payment that does not say who voided it", async () => {
    await expect(
      withRollback(async (tx) => {
        await tx.payment.create({
          data: {
            payerCustomerId: await customer(tx),
            receivedOn: day("2099-01-01"),
            amountCents: 100,
            recordedById: "staff",
            voidedAt: new Date(),
          },
        });
      }),
    ).rejects.toThrow(/payments_void_pair/);
  });
});

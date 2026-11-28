import { formatCentsForInput, getDb, getInvoiceSettings } from "@ace/core";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { SettingsForm } from "./settings-form";

export default async function InvoiceSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER"]); // owner only
  const actor = await toActor(staff);
  const sp = await searchParams;
  const s = await getInvoiceSettings(getDb(), actor);
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-forest">Invoice settings</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        ACE&apos;s bank details are printed on every invoice and statement. Changes apply to
        invoices issued afterwards: an invoice that has been issued keeps the details it was issued
        with. Invoices cannot be issued until the bank, account holder, account number and branch
        code are filled in.
      </p>
      {/* A new key after every save starts the form afresh, so its "saved" message shows again. */}
      <SettingsForm
        key={s.updatedAt.toISOString()}
        saved={first(sp.saved) === "1"}
        initial={{
          bankName: s.bankName,
          accountHolder: s.accountHolder,
          accountNumber: s.accountNumber,
          branchCode: s.branchCode,
          accountType: s.accountType,
          onceOffDueDays: String(s.onceOffDueDays),
          lateFee: formatCentsForInput(s.lateFeeCents),
        }}
      />
    </div>
  );
}

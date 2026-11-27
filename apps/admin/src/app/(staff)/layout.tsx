import { MANAGEMENT } from "@ace/core";
import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";

// The layout gives every staff page the same header. It is NOT the security check:
// each page and action calls requireStaff() itself.
export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  return (
    <div className="min-h-screen">
      <header className="border-b border-charcoal/10 bg-white/60">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold">
            <span className="font-display text-forest">ACE</span>
            <Link href="/customers" className="text-charcoal/80 hover:text-forest">
              Customers
            </Link>
            {MANAGEMENT.includes(staff.role) ? (
              <Link href="/quotes" className="text-charcoal/80 hover:text-forest">
                Quotes
              </Link>
            ) : null}
            {MANAGEMENT.includes(staff.role) ? (
              <>
                <Link href="/invoices" className="text-charcoal/80 hover:text-forest">
                  Invoices
                </Link>
                <Link href="/payments" className="text-charcoal/80 hover:text-forest">
                  Payments
                </Link>
                <Link href="/statements" className="text-charcoal/80 hover:text-forest">
                  Statements
                </Link>
              </>
            ) : null}
            {MANAGEMENT.includes(staff.role) ? (
              <Link href="/services" className="text-charcoal/80 hover:text-forest">
                Services
              </Link>
            ) : null}
            {staff.role === "OWNER" ? (
              <Link href="/settings/quote-wording" className="text-charcoal/80 hover:text-forest">
                Quote wording
              </Link>
            ) : null}
            {staff.role === "OWNER" ? (
              <Link href="/settings/invoices" className="text-charcoal/80 hover:text-forest">
                Invoice settings
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-charcoal/60 sm:inline">
              {staff.name} ({staff.role.toLowerCase()})
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-full border border-forest/30 px-4 py-1.5 font-display text-xs font-semibold text-forest hover:bg-forest hover:text-cream"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-4 py-8">{children}</div>
    </div>
  );
}

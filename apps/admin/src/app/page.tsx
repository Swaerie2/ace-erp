import { requireStaff } from "@/lib/auth";
import { signOut } from "./login/actions";

export default async function Home() {
  // Every protected page starts with this check. Never skip it.
  const staff = await requireStaff();

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
          ACE Garden Services
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-forest">
          Hello, {staff.name}
        </h1>
        <p className="mt-2 text-sm text-charcoal/60">Signed in as {staff.role.toLowerCase()}</p>
        <p className="mt-6 text-charcoal/70">
          Sign-in is working. Customers, quotes and invoices arrive in the next modules.
        </p>
        <form action={signOut} className="mt-8">
          <button
            type="submit"
            className="rounded-full border border-forest/30 px-5 py-2.5 font-display text-sm font-semibold text-forest transition-colors hover:bg-forest hover:text-cream"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}

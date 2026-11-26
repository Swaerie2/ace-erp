import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/actions";

export function SignedInShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-10 items-center text-xs font-semibold tracking-[0.18em] text-ochre uppercase"
        >
          ACE Garden Services
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-full px-4 text-sm font-semibold text-forest ring-1 ring-forest/30 hover:bg-forest hover:text-cream"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="mt-6 space-y-6">{children}</div>
    </main>
  );
}

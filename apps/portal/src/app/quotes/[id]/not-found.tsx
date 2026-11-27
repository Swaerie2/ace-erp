import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "This quote is not available",
  robots: { index: false, follow: false },
};

export default function QuoteNotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
        ACE Garden Services
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest">
        This quote is not available
      </h1>
      <p className="mt-4 text-charcoal/70">It may have been replaced or withdrawn.</p>
      <p className="mt-6">
        <Link
          href="/"
          prefetch={false}
          className="inline-flex min-h-11 items-center font-semibold text-forest underline"
        >
          Back to your quotes
        </Link>
      </p>
    </main>
  );
}

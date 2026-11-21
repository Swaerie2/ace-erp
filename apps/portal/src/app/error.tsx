"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

// Never shows the error text or digest: it could carry details about the quote or the server.
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
        ACE Garden Services
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest">Something went wrong</h1>
      <p className="mt-4 text-charcoal/70">
        Something went wrong. Please try again, or contact ACE Garden Services.
      </p>
      <div className="mt-6">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-forest px-6 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

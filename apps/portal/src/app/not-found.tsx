import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "This link is not valid",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
        ACE Garden Services
      </p>
      <h1 className="mt-3 font-display text-3xl font-semibold text-forest">
        This link is not valid
      </h1>
      <p className="mt-4 text-charcoal/70">
        Please check the link you were sent, or contact ACE Garden Services for a new one.
      </p>
    </main>
  );
}

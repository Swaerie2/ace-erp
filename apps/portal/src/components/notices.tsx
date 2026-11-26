import type { ReactNode } from "react";

export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <p className="text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
        ACE Garden Services
      </p>
      <div className="mt-4 space-y-6">{children}</div>
    </main>
  );
}

export function Notice({
  title,
  tone = "info",
  children,
}: {
  title: string;
  tone?: "info" | "good";
  children?: ReactNode;
}) {
  const colours =
    tone === "good"
      ? "bg-forest/10 ring-forest/25 text-forest"
      : "bg-ochre/10 ring-ochre/30 text-charcoal";
  return (
    <section role="status" className={`rounded-2xl p-5 ring-1 sm:p-6 ${colours}`}>
      <h1 className="font-display text-xl font-semibold">{title}</h1>
      {children ? <div className="mt-2 space-y-1 text-charcoal">{children}</div> : null}
    </section>
  );
}

export function Contact({ phone, email }: { phone: string; email: string }) {
  return <p>{[phone, email].filter(Boolean).join(" · ")}</p>;
}

/** What link previews and crawlers see: nothing about the quote. */
export function BarePage() {
  return (
    <PageShell>
      <Notice title="Your quotation from ACE Garden Services">
        <p>Open this link in your browser to read your quotation.</p>
      </Notice>
    </PageShell>
  );
}

export function TooManyRequests() {
  return (
    <PageShell>
      <Notice title="Too many requests">
        <p>Please try again in a few minutes.</p>
      </Notice>
    </PageShell>
  );
}

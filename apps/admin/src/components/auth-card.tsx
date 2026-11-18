/** The centred branded card shared by every sign-in screen. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <p className="text-center text-xs font-semibold tracking-[0.18em] text-ochre uppercase">
          ACE Garden Services
        </p>
        <h1 className="mt-3 text-center font-display text-3xl font-semibold text-forest">
          {title}
        </h1>
        {subtitle ? <p className="mt-3 text-center text-sm text-charcoal/70">{subtitle}</p> : null}
        <div className="mt-8 rounded-2xl bg-white/70 p-8 shadow-sm ring-1 ring-charcoal/10">
          {children}
        </div>
      </div>
    </main>
  );
}

export const inputClass =
  "mt-1 block w-full rounded-lg border border-charcoal/20 bg-white px-3 py-2.5 text-charcoal shadow-sm outline-none focus:border-forest focus:ring-2 focus:ring-forest/20";

export const buttonClass =
  "w-full rounded-full bg-forest px-5 py-3 font-display text-sm font-semibold text-cream transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:opacity-60";

import { CODE_TTL_MINUTES } from "@ace/core/portal";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice, PageShell } from "@/components/notices";
import { readPendingEmail } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";
import { CodeForm } from "./code-form";

// Nothing personal in the title or description.
export const metadata: Metadata = {
  title: "Enter your sign-in code",
  description: "Enter the code we emailed you to sign in to the ACE Garden Services client portal.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function CodePage() {
  const visitor = await getVisitor();
  // Link previews and crawlers get the bare page, with no database work.
  if (visitor.isBot) {
    return (
      <PageShell>
        <Notice title="ACE client portal">
          <p>Open this page in your browser to sign in.</p>
        </Notice>
      </PageShell>
    );
  }
  const email = await readPendingEmail();
  if (!email) redirect("/sign-in");
  return (
    <PageShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Check your email</h1>
        <p className="break-words text-charcoal/80">
          If that email is on file, we have sent a code to {email}. It works once, for{" "}
          {CODE_TTL_MINUTES} minutes.
        </p>
        <CodeForm />
        <p>
          <Link
            href="/sign-in"
            prefetch={false}
            className="inline-flex min-h-10 items-center text-sm font-semibold text-forest underline"
          >
            Use a different email or ask for a new code
          </Link>
        </p>
      </section>
    </PageShell>
  );
}

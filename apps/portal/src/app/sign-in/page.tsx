import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Notice, PageShell } from "@/components/notices";
import { getSession } from "@/lib/session";
import { getVisitor } from "@/lib/visitor";
import { SignInForm } from "./sign-in-form";

// Nothing personal in the title or description.
export const metadata: Metadata = {
  title: "Sign in to the ACE client portal",
  description: "Sign in to the ACE Garden Services client portal.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SignInPage() {
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
  if (await getSession()) redirect("/");
  return (
    <PageShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Sign in</h1>
        <p className="text-charcoal/80">
          Enter your email address and we will email you a 6-digit code. There is no password.
        </p>
        <SignInForm />
      </section>
    </PageShell>
  );
}

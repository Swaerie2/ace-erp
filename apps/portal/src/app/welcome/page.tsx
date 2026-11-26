import { getPortalDb } from "@ace/core";
import { getWelcomeStep } from "@ace/core/portal";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignedInShell } from "@/components/signed-in-shell";
import { requireSession } from "@/lib/session";
import { WelcomeForm } from "./welcome-form";

// Nothing personal in the title or description.
export const metadata: Metadata = {
  title: "Welcome to the ACE client portal",
  description: "Check your details for the ACE Garden Services client portal.",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const session = await requireSession({ allowUnwelcomed: true });
  const step = await getWelcomeStep(getPortalDb(), session.scope);
  if (!step) redirect("/");
  return (
    <SignedInShell>
      <section className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-charcoal/10 sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-forest">Welcome</h1>
        <p className="text-charcoal/80">
          Please check your details. You only need to do this once
          {step.remaining > 1
            ? `, for each of the ${step.remaining} accounts linked to your email`
            : ""}
          .
        </p>
        <WelcomeForm step={step} />
      </section>
    </SignedInShell>
  );
}

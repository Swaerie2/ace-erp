import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { getSignedInStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { SetupForm } from "./setup-form";

export default async function SetupPage() {
  await getSignedInStaff();
  const supabase = await createSupabaseServerClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  // Already linked an app? Then they only need to type a code.
  if (factors && factors.totp.length > 0) redirect("/login/verify");

  // Clear out half-finished attempts from earlier visits to this page.
  for (const stale of factors?.all ?? []) {
    if (stale.factor_type === "totp" && stale.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `ACE authenticator ${new Date().toISOString()}`,
  });
  if (error || !data) {
    return (
      <AuthCard title="Set up your authenticator">
        <p role="alert" className="text-sm text-red-700">
          We could not start the setup. Refresh the page to try again.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up your authenticator"
      subtitle="Staff accounts need a second step at every sign-in. This takes a minute and only happens once."
    >
      <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm text-charcoal/80">
        <li>Open Google Authenticator or Microsoft Authenticator on your phone.</li>
        <li>Add an account and scan this square.</li>
        <li>Type the 6-digit code the app shows below.</li>
      </ol>

      <div className="flex justify-center rounded-xl bg-white p-3 ring-1 ring-charcoal/10">
        {/* The QR code is an inline image generated for this person only. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.totp.qr_code}
          alt="QR code to scan with your authenticator app"
          width={192}
          height={192}
        />
      </div>

      <details className="mt-4 text-sm text-charcoal/70">
        <summary className="cursor-pointer">Can&apos;t scan? Type this key instead</summary>
        <p className="mt-2 rounded-lg bg-charcoal/5 p-3 font-mono text-xs break-all select-all">
          {data.totp.secret}
        </p>
      </details>

      <div className="mt-6">
        <SetupForm factorId={data.id} />
      </div>

      <form action={signOut} className="mt-6 text-center">
        <button type="submit" className="text-sm text-charcoal/60 underline hover:text-forest">
          Cancel and sign out
        </button>
      </form>
    </AuthCard>
  );
}

import { AuthCard } from "@/components/auth-card";
import { getSignedInStaff } from "@/lib/auth";
import { signOut } from "../actions";
import { VerifyForm } from "./verify-form";

export default async function VerifyPage() {
  const staff = await getSignedInStaff();

  return (
    <AuthCard
      title="Enter your code"
      subtitle={`Hi ${staff.name}. Open your authenticator app and type the 6-digit code for ACE.`}
    >
      <VerifyForm />
      <form action={signOut} className="mt-6 text-center">
        <button type="submit" className="text-sm text-charcoal/60 underline hover:text-forest">
          Cancel and sign out
        </button>
      </form>
    </AuthCard>
  );
}

import { AuthCard } from "@/components/auth-card";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <AuthCard title="Staff sign in" subtitle="For ACE staff only.">
      {error === "no-access" ? (
        <p role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          That account does not have access to the staff area.
        </p>
      ) : null}
      <LoginForm />
    </AuthCard>
  );
}

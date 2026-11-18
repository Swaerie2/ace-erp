import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { requireStaff } from "@/lib/auth";

export default async function ForbiddenPage() {
  await requireStaff();

  return (
    <AuthCard title="Not allowed" subtitle="Your role does not have access to that page.">
      <p className="text-center">
        <Link href="/" className="text-sm text-forest underline">
          Back to the home page
        </Link>
      </p>
    </AuthCard>
  );
}

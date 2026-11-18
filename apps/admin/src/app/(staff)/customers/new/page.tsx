import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  await requireStaff(["OWNER", "MANAGER"]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Add customer</h1>
      <NewCustomerForm />
    </div>
  );
}

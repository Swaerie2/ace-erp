import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { ImportForm } from "./import-form";

export default async function ImportPage() {
  await requireStaff(["OWNER", "MANAGER"]);
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Import customers</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        Upload a CSV file (up to 2 MB or 2,000 rows). You will see a preview first and nothing is
        saved until you confirm. The file itself is never stored.{" "}
        {/* A file download, not a page: a plain link, not client-side navigation. */}
        <a
          href="/customers/import/template"
          download
          className="font-semibold text-forest underline"
        >
          Download the template
        </a>
        .
      </p>
      <ImportForm />
    </div>
  );
}

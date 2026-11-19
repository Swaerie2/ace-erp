import { IMPORT_TEMPLATE } from "@ace/core";
import { requireStaff } from "@/lib/auth";

export async function GET() {
  await requireStaff(["OWNER", "MANAGER"]);
  return new Response(IMPORT_TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ace-customer-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}

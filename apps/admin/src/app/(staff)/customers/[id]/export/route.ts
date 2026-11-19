import { exportCustomerData, formatCustomerNumber, inTx } from "@ace/core";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["OWNER"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found", { status: 404 });
  const actor = await toActor(staff);

  const data = await inTx((tx) => exportCustomerData(tx, actor, id));
  // createdById is an internal staff id, not data about the customer. undefined is left out of JSON.
  const customer = { ...data.customer, createdById: undefined };
  const name = formatCustomerNumber(customer.number);
  return new Response(JSON.stringify({ ...data, customer }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-data.json"`,
      "Cache-Control": "no-store",
    },
  });
}

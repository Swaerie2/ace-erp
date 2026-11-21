import { getDb, getQuoteWording } from "@ace/core";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { WordingForm } from "./wording-form";

export default async function QuoteWordingPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER"]); // owner only
  const actor = await toActor(staff);
  const sp = await searchParams;
  const { updatedAt, ...wording } = await getQuoteWording(getDb(), actor);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-semibold text-forest">Quote wording</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        The standard wording printed on every new quote. Changes apply to future quotes only; a
        quote that has been issued keeps the wording it was issued with.
      </p>
      {/* A new key after every save starts the form afresh, so its "saved" banner shows again. */}
      <WordingForm
        key={updatedAt.toISOString()}
        initial={wording}
        saved={first(sp.saved) === "1"}
      />
    </div>
  );
}

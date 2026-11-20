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
  void updatedAt;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-2xl font-semibold text-forest">Quote wording</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        The standard wording printed on every new quote. Changes apply to future quotes only; a
        quote that has been issued keeps the wording it was issued with.
      </p>
      {first(sp.saved) === "1" ? (
        <p role="status" className="mt-4 rounded-lg bg-forest/10 px-3 py-2 text-sm text-forest">
          Wording saved.
        </p>
      ) : null}
      <WordingForm initial={wording} />
    </div>
  );
}

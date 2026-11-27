import {
  HIERARCHY_MESSAGES,
  formatCustomerNumber,
  type AgencyOption,
  type CustomerHierarchy,
  type HierarchyMessageKey,
} from "@ace/core";
import Link from "next/link";
import { inputClass } from "@/components/auth-card";
import { secondaryButtonClass } from "@/components/form";
import { clearManagedByAction, setBillsToAction, setManagedByAction } from "../actions";

const SUCCESS: Record<string, string> = {
  linked: "Managing agency saved.",
  cleared: "Managing agency removed.",
  billing: "Billing choice saved.",
};

/** Only a fixed code arrives in the address bar; anything unknown shows nothing. */
function noticeFor(code: string | undefined): { text: string; ok: boolean } | null {
  if (!code) return null;
  if (Object.hasOwn(SUCCESS, code)) return { text: SUCCESS[code] ?? "", ok: true };
  if (Object.hasOwn(HIERARCHY_MESSAGES, code)) {
    return { text: HIERARCHY_MESSAGES[code as HierarchyMessageKey], ok: false };
  }
  if (code === "generic")
    return { text: "That could not be saved. Refresh the page and try again.", ok: false };
  return null;
}

export function HierarchyPanel({
  customerId,
  locked,
  hierarchy,
  agencyQuery,
  agencyResults,
  notice,
}: {
  customerId: string;
  locked: boolean;
  hierarchy: CustomerHierarchy;
  agencyQuery: string;
  agencyResults: AgencyOption[];
  notice: string | undefined;
}) {
  const message = noticeFor(notice);
  const manager = hierarchy.manager;
  const managesComplexes = hierarchy.complexes.length > 0;
  return (
    <section
      aria-labelledby="hierarchy-heading"
      className="space-y-4 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10"
    >
      <h2 id="hierarchy-heading" className="font-display text-lg font-semibold text-forest">
        Managing agency
      </h2>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg px-3 py-2 text-sm ring-1 ${message.ok ? "bg-forest/10 text-forest ring-forest/25" : "bg-red-50 text-red-800 ring-red-200"}`}
        >
          {message.text}
        </p>
      ) : null}

      {manager ? (
        <div className="space-y-3">
          <p className="text-sm">
            Managed by{" "}
            <Link href={`/customers/${manager.id}`} className="font-semibold text-forest underline">
              {manager.displayName}
            </Link>{" "}
            <span className="text-charcoal/50">{formatCustomerNumber(manager.number)}</span>
          </p>
          {locked ? (
            <p className="text-sm">
              Bills go to:{" "}
              {hierarchy.billsToManager ? "the managing agency" : "this customer itself"}
            </p>
          ) : (
            <>
              <form action={setBillsToAction} className="space-y-2">
                <input type="hidden" name="customerId" value={customerId} />
                <fieldset className="space-y-1">
                  <legend className="text-sm font-semibold text-charcoal">Bills go to</legend>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="billsTo"
                      value="agency"
                      defaultChecked={hierarchy.billsToManager}
                      className="h-4 w-4 accent-forest"
                    />
                    The managing agency
                  </label>
                  <label className="flex min-h-10 items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name="billsTo"
                      value="complex"
                      defaultChecked={!hierarchy.billsToManager}
                      className="h-4 w-4 accent-forest"
                    />
                    This customer itself
                  </label>
                </fieldset>
                <button type="submit" className={secondaryButtonClass}>
                  Save billing choice
                </button>
              </form>
              <form action={clearManagedByAction}>
                <input type="hidden" name="customerId" value={customerId} />
                <button type="submit" className={secondaryButtonClass}>
                  Remove managing agency
                </button>
              </form>
            </>
          )}
        </div>
      ) : managesComplexes ? (
        <p className="text-sm text-charcoal/70">
          This customer manages complexes, so it cannot itself be managed by an agency.
        </p>
      ) : (
        <p className="text-sm text-charcoal/70">Not managed by an agency.</p>
      )}

      {!locked && !managesComplexes ? (
        <div className="space-y-2">
          <form method="get" role="search" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tab" value="overview" />
            <label className="block min-w-0 flex-1 text-sm font-medium text-charcoal">
              {manager ? "Move to another agency" : "Find the managing agency"}
              <input
                name="agencyQ"
                type="search"
                maxLength={80}
                defaultValue={agencyQuery}
                placeholder="Agency name"
                className={inputClass}
              />
            </label>
            <button type="submit" className={secondaryButtonClass}>
              Search
            </button>
          </form>
          {agencyQuery && agencyResults.length === 0 ? (
            <p className="text-sm text-charcoal/60">
              No customer by that name can be an agency. Type at least two letters of the name.
            </p>
          ) : null}
          {agencyResults.length > 0 ? (
            <ul className="space-y-2">
              {agencyResults.map((a) => (
                <li key={a.id}>
                  <form action={setManagedByAction}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="agencyId" value={a.id} />
                    <button type="submit" className={`${secondaryButtonClass} text-left`}>
                      Managed by {a.displayName} ({formatCustomerNumber(a.number)})
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {managesComplexes ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-charcoal">Complexes managed</h3>
          <ul className="divide-y divide-charcoal/10 rounded-xl ring-1 ring-charcoal/10">
            {hierarchy.complexes.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
              >
                <Link
                  href={`/customers/${c.id}`}
                  className="min-w-0 break-words font-semibold text-forest underline"
                >
                  {c.displayName}
                </Link>
                <span className="text-charcoal/60">
                  {formatCustomerNumber(c.number)} · {c.status.toLowerCase()} · {c.propertyCount}{" "}
                  {c.propertyCount === 1 ? "property" : "properties"} · {c.quoteCount}{" "}
                  {c.quoteCount === 1 ? "quote" : "quotes"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

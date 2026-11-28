import {
  formatCustomerNumber,
  getCustomer,
  getCustomerForCrew,
  getCustomerHierarchy,
  getDb,
  getPropertyAgreement,
  listCustomerActivity,
  listCustomerInvoices,
  listQuotes,
  searchAgencies,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { activateCustomerAction } from "../actions";
import { ActivityTab } from "./activity-tab";
import { ContactsTab } from "./contacts-tab";
import { CrewView } from "./crew-view";
import { InvoicesTab } from "./invoices-tab";
import { OverviewTab } from "./overview-tab";
import { PropertiesTab } from "./properties-tab";
import { QuotesTab } from "./quotes-tab";

type Param = string | string[] | undefined;
type Search = {
  tab?: Param;
  edit?: Param;
  add?: Param;
  error?: Param;
  agencyQ?: Param;
  link?: Param;
  notice?: Param;
};
const TABS = ["overview", "contacts", "properties", "quotes", "invoices", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Search>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const actor = await toActor(staff);

  // Crew only ever reach the crew query: no contacts, notes or fees.
  if (staff.role === "CREW") {
    const view = await getCustomerForCrew(getDb(), actor, id);
    if (!view) notFound();
    return <CrewView customer={view} />;
  }

  const customer = await getCustomer(getDb(), actor, id);
  if (!customer) notFound();
  // A repeated key (?edit=a&edit=b) arrives as an array; `first` treats it as absent.
  const tab: Tab = TABS.find((t) => t === first(sp.tab)) ?? "overview";
  const edit = first(sp.edit);
  const add = first(sp.add);
  const contactNotice = first(sp.error);
  const agencyQuery = (first(sp.agencyQ) ?? "").slice(0, 80);
  const linkNotice = first(sp.link);
  const notice = first(sp.notice);

  return (
    <div>
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="min-w-0 break-words font-display text-2xl font-semibold text-forest">
          {customer.displayName}
        </h1>
        <span className="text-sm text-charcoal/50">{formatCustomerNumber(customer.number)}</span>
        <span className="rounded-full bg-forest/10 px-2.5 py-1 text-xs font-semibold text-forest">
          {customer.status.toLowerCase()}
        </span>
        {customer.status === "LEAD" || customer.status === "PAUSED" ? (
          // One click, from any tab. Archived customers must be restored first, so no button there.
          <form action={activateCustomerAction}>
            <input type="hidden" name="id" value={customer.id} />
            <button
              type="submit"
              className="rounded-full bg-forest px-4 py-1.5 font-display text-xs font-semibold text-cream transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
            >
              {customer.status === "LEAD" ? "Mark as active" : "Resume"}
            </button>
          </form>
        ) : null}
      </div>

      <nav
        className="mt-6 flex gap-1 overflow-x-auto border-b border-charcoal/10 text-sm font-semibold"
        aria-label="Customer sections"
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/customers/${id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`whitespace-nowrap px-4 py-2 ${t === tab ? "border-b-2 border-forest text-forest" : "text-charcoal/60 hover:text-forest"}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" ? (
          <OverviewTab
            customer={customer}
            editing={edit === "1"}
            isOwner={staff.role === "OWNER"}
            hierarchy={await getCustomerHierarchy(getDb(), actor, id)}
            agencyQuery={agencyQuery}
            agencyResults={
              agencyQuery
                ? await searchAgencies(getDb(), actor, { q: agencyQuery, excludeId: id })
                : []
            }
            linkNotice={linkNotice}
          />
        ) : tab === "contacts" ? (
          <ContactsTab customer={customer} edit={edit} add={add === "1"} notice={contactNotice} />
        ) : tab === "properties" ? (
          <PropertiesTab
            customer={customer}
            edit={edit}
            add={add === "1"}
            agreements={Object.fromEntries(
              await Promise.all(
                customer.properties.map(
                  async (p) => [p.id, await getPropertyAgreement(getDb(), actor, p.id)] as const,
                ),
              ),
            )}
          />
        ) : tab === "quotes" ? (
          <QuotesTab
            customerId={id}
            customerName={customer.displayName}
            result={await listQuotes(getDb(), actor, { customerId: id, pageSize: 50 })}
            canQuote={customer.status !== "ARCHIVED" && !customer.anonymisedAt}
          />
        ) : tab === "invoices" ? (
          <InvoicesTab
            customerId={id}
            billingTiming={customer.billingTiming}
            locked={customer.status === "ARCHIVED" || Boolean(customer.anonymisedAt)}
            data={await listCustomerInvoices(getDb(), actor, id)}
            notice={notice}
          />
        ) : (
          <ActivityTab entries={await listCustomerActivity(getDb(), actor, id)} />
        )}
      </div>
    </div>
  );
}

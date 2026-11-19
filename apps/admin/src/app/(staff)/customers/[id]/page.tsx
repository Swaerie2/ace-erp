import {
  formatCustomerNumber,
  getCustomer,
  getCustomerForCrew,
  getDb,
  listCustomerActivity,
} from "@ace/core";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { ActivityTab } from "./activity-tab";
import { ContactsTab } from "./contacts-tab";
import { CrewView } from "./crew-view";
import { OverviewTab } from "./overview-tab";
import { PropertiesTab } from "./properties-tab";

type Search = {
  tab?: string;
  edit?: string | string[];
  add?: string | string[];
  error?: string | string[];
};
const TABS = ["overview", "contacts", "properties", "activity"] as const;
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
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "overview";
  // A repeated ?edit= arrives as an array; treat it as absent.
  const edit = Array.isArray(sp.edit) ? undefined : sp.edit;
  const add = Array.isArray(sp.add) ? undefined : sp.add;
  const notice = Array.isArray(sp.error) ? undefined : sp.error;

  return (
    <div>
      <Link href="/customers" className="text-sm text-forest hover:underline">
        ← Customers
      </Link>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">{customer.displayName}</h1>
        <span className="text-sm text-charcoal/50">{formatCustomerNumber(customer.number)}</span>
        <span className="rounded-full bg-forest/10 px-2.5 py-1 text-xs font-semibold text-forest">
          {customer.status.toLowerCase()}
        </span>
      </div>

      <nav
        className="mt-6 flex gap-1 border-b border-charcoal/10 text-sm font-semibold"
        aria-label="Customer sections"
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/customers/${id}?tab=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={`px-4 py-2 ${t === tab ? "border-b-2 border-forest text-forest" : "text-charcoal/60 hover:text-forest"}`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "overview" ? (
          <OverviewTab
            customer={customer}
            editing={sp.edit === "1"}
            isOwner={staff.role === "OWNER"}
          />
        ) : tab === "contacts" ? (
          <ContactsTab customer={customer} edit={edit} add={add === "1"} notice={notice} />
        ) : tab === "properties" ? (
          <PropertiesTab customer={customer} edit={edit} add={add === "1"} />
        ) : (
          <ActivityTab entries={await listCustomerActivity(getDb(), actor, id)} />
        )}
      </div>
    </div>
  );
}

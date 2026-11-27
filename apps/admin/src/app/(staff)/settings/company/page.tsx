import { getCompanyProfile, getDb } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { Notice, noticeFor } from "@/components/notice";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { removeCompanyLogoAction } from "./actions";
import { AddressForm, LogoForm } from "./company-forms";

const NOTICES = {
  logo: { text: "Logo saved. It now shows on invoices, statements and quotes.", ok: true },
  removed: { text: "Logo removed. Documents are now made without a logo.", ok: true },
  address: { text: "Address saved. Documents made from now on show it.", ok: true },
  failed: { text: "That could not be done. Refresh the page and try again.", ok: false },
};

const sectionClass = "mt-6 space-y-4 rounded-2xl bg-white/70 p-4 ring-1 ring-charcoal/10";
const headingClass = "font-display text-lg font-semibold text-forest";

export default async function CompanyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const staff = await requireStaff(["OWNER"]); // owner only
  const actor = await toActor(staff);
  const sp = await searchParams;
  const saved = first(sp.saved);
  const profile = await getCompanyProfile(getDb(), actor);
  const details: [string, string][] = [
    ["Legal name", profile.legalName],
    ["Trading name", profile.tradingName],
    ["Registration number", profile.registrationNumber],
    ["Phone", profile.phone],
    ["Email", profile.email],
    ["Website", profile.website],
  ];
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-forest">Company profile</h1>
      <p className="mt-2 text-sm text-charcoal/70">
        The logo and address printed on invoices, statements and quotes. A changed logo also shows
        on older invoices when they are printed again. The address and bank details on an issued
        invoice stay as they were when it was issued.
      </p>
      <div className="mt-4">
        <Notice notice={noticeFor(saved, NOTICES)} />
      </div>

      <section className={sectionClass} aria-labelledby="logo-heading">
        <h2 id="logo-heading" className={headingClass}>
          Logo
        </h2>
        {profile.logo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small private picture from our own route
          <img
            src={`/company-logo?v=${encodeURIComponent(profile.logo.version)}`}
            alt={`${profile.tradingName} logo`}
            className="max-h-20 w-auto rounded bg-white p-1 ring-1 ring-charcoal/10"
          />
        ) : (
          <p className="text-sm text-charcoal/70">No logo yet.</p>
        )}
        {/* A new key after every upload starts the form afresh. */}
        <LogoForm key={profile.logo?.version ?? "none"} />
        {profile.logo ? (
          <form
            action={removeCompanyLogoAction}
            className="flex flex-wrap items-center gap-3 border-t border-charcoal/10 pt-4"
          >
            <button type="submit" className={secondaryButtonClass}>
              Remove logo
            </button>
            <span className="text-sm text-charcoal/70">
              Documents are then made without a logo. You can upload one again at any time.
            </span>
          </form>
        ) : null}
      </section>

      <section className={sectionClass} aria-labelledby="address-heading">
        <h2 id="address-heading" className={headingClass}>
          Address
        </h2>
        <p className="text-sm text-charcoal/70">
          Printed under the company name on every document. Leave it blank to print none.
        </p>
        <AddressForm key={JSON.stringify(profile.address)} initial={profile.address} />
      </section>

      <section className={sectionClass} aria-labelledby="details-heading">
        <h2 id="details-heading" className={headingClass}>
          Company details
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-medium text-charcoal/70">{label}</dt>
              <dd className="text-charcoal">{value || "Not filled in"}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-charcoal/70">
          The registration number, phone, email and website are changed in Quote wording. The legal
          and trading names cannot be changed in the app.{" "}
          <Link href="/settings/quote-wording" className="font-semibold text-forest underline">
            Open Quote wording
          </Link>
        </p>
      </section>
    </div>
  );
}

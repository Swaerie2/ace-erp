import { getDb, listServices, SERVICE_KIND_LABELS } from "@ace/core";
import Link from "next/link";
import { secondaryButtonClass } from "@/components/form";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { first } from "@/lib/search-params";
import { archiveServiceAction, moveServiceAction, restoreServiceAction } from "./actions";
import { ServiceForm } from "./service-form";

type Param = string | string[] | undefined;
type Search = { add?: Param; edit?: Param; archived?: Param };

const smallButton =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-forest/30 px-3 text-sm font-semibold text-forest transition-colors hover:bg-forest hover:text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-forest";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requireStaff(["OWNER", "MANAGER"]); // every page starts with this
  const sp = await searchParams;
  const actor = await toActor(staff);
  const all = await listServices(getDb(), actor, { includeArchived: true });
  const switchedOn = all.filter((s) => !s.archivedAt);
  const switchedOff = all.filter((s) => s.archivedAt);
  const showOff = first(sp.archived) === "1";
  const editing = all.find((s) => s.id === first(sp.edit));
  const adding = first(sp.add) === "1";

  const back = (
    <Link
      href={editing?.archivedAt && !adding ? "/services?archived=1" : "/services"}
      className="inline-flex min-h-10 items-center text-sm text-forest hover:underline"
    >
      ← Services
    </Link>
  );

  if (adding) {
    return (
      <div>
        {back}
        <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Add service</h1>
        <ServiceForm />
      </div>
    );
  }
  if (editing) {
    return (
      <div>
        {back}
        <h1 className="mt-2 font-display text-2xl font-semibold text-forest">Edit service</h1>
        <ServiceForm
          service={{
            id: editing.id,
            name: editing.name,
            description: editing.description,
            kind: editing.kind,
            archived: editing.archivedAt !== null,
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-forest">Services</h1>
        <Link
          href="/services?add=1"
          className="inline-flex min-h-10 items-center rounded-full bg-forest px-5 py-2.5 font-display text-sm font-semibold text-cream hover:bg-forest-deep"
        >
          Add service
        </Link>
      </div>
      <p className="mt-2 text-sm text-charcoal/70">
        These are the services quotes are built from. There are no prices here: each client is
        quoted after a site visit.
      </p>

      {switchedOn.length === 0 ? (
        <p className="mt-10 text-center text-charcoal/60">No services are switched on.</p>
      ) : (
        <ul className="mt-6 divide-y divide-charcoal/10 rounded-2xl bg-white/70 ring-1 ring-charcoal/10">
          {switchedOn.map((s, index) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="break-words font-semibold text-forest">
                  {s.name}
                  {s.kind === "OPTIONAL_EXTRA" ? (
                    <span className="ml-2 rounded-full bg-ochre/15 px-2.5 py-1 text-xs font-semibold text-ochre">
                      {SERVICE_KIND_LABELS[s.kind]}
                    </span>
                  ) : null}
                </p>
                <p className="whitespace-pre-line break-words text-sm text-charcoal/70">
                  {s.description}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <form action={moveServiceAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="direction" value="up" />
                  <button
                    type="submit"
                    className={smallButton}
                    disabled={index === 0}
                    aria-label={`Move ${s.name} up`}
                  >
                    ↑
                  </button>
                </form>
                <form action={moveServiceAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="direction" value="down" />
                  <button
                    type="submit"
                    className={smallButton}
                    disabled={index === switchedOn.length - 1}
                    aria-label={`Move ${s.name} down`}
                  >
                    ↓
                  </button>
                </form>
                <Link
                  href={`/services?edit=${s.id}`}
                  className={smallButton}
                  aria-label={`Edit ${s.name}`}
                >
                  Edit
                </Link>
                <form action={archiveServiceAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <button type="submit" className={smallButton} aria-label={`Switch off ${s.name}`}>
                    Switch off
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      {switchedOff.length > 0 ? (
        <div className="mt-8">
          <Link
            href={showOff ? "/services" : "/services?archived=1"}
            className={secondaryButtonClass}
          >
            {showOff
              ? "Hide switched-off services"
              : `Show switched-off services (${switchedOff.length})`}
          </Link>
          {showOff ? (
            <ul className="mt-4 divide-y divide-charcoal/10 rounded-2xl bg-white/40 ring-1 ring-charcoal/10">
              {switchedOff.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-charcoal/60"
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <p className="break-words font-semibold">
                      {s.name}
                      <span className="ml-2 rounded-full bg-charcoal/10 px-2.5 py-1 text-xs font-semibold">
                        Switched off
                      </span>
                    </p>
                    <p className="whitespace-pre-line break-words text-sm">{s.description}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/services?edit=${s.id}`}
                      className={smallButton}
                      aria-label={`Edit ${s.name}`}
                    >
                      Edit
                    </Link>
                    <form action={restoreServiceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        type="submit"
                        className={smallButton}
                        aria-label={`Switch on ${s.name}`}
                      >
                        Switch on
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

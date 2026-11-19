# Module 2: Services catalogue (design)

Status: Draft for owner review. Date: 2026-11-19.

## Goal

Staff keep one list of the services ACE sells. Quotes (Module 3) are built from this list. There is
deliberately **no price list**: every client is priced individually after a site visit, so a price
belongs on a quote line, never on a service.

## Decisions taken with the owner

1. No fixed prices anywhere in the catalogue. Two neighbouring yards can need very different work.
2. A quote can be once-off, recurring, or both (for example a once-off clean-up followed by a
   monthly contract). Recurring work has a visit frequency (weekly, every two weeks, once a month)
   but is always billed as one monthly amount. These belong to quote lines (Module 3), not here.
3. A quote lists **every** active service. The ones the client asked for are highlighted with their
   frequency and price; the rest show as "Not included, quoted separately on request". This gives
   ACE a clear record when a client later asks for work that was never in scope.
4. Weed treatment is an **optional extra**, offered on top of other services.
5. Plain catalogue only (no per-service default frequency or billing type). Defaults can be added
   later, once real quotes show what is worth pre-filling.

## Out of scope

Prices, quote lines, frequencies, agreed scope and extra-work quotes (Module 3). Crew-facing scope
view (Module 6). Per-customer service agreements as a separate screen (they come from accepted
quotes).

## Data model

One table, hardened like the others: Row Level Security on with no policies, privileges revoked
from `anon` and `authenticated`, only server code reads or writes.

### services

| Field                | Notes                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| id                   | uuid                                                                                     |
| name                 | required, max 80 characters, unique ignoring case (including switched-off services)      |
| description          | required, max 300 characters; the scope wording the client reads on a quote              |
| kind                 | `CORE` or `OPTIONAL_EXTRA`                                                               |
| sortOrder            | whole number; the order services appear in on quotes. New services go to the end         |
| archivedAt           | null while on; set when switched off. Services are never deleted                         |
| createdAt, updatedAt |                                                                                          |

Seed rows, inserted by the migration so a fresh live database starts with them (editable in the
app afterwards):

| Order | Name                           | Kind            | Description                                                         |
| ----- | ------------------------------ | --------------- | ------------------------------------------------------------------- |
| 1     | Lawn Mowing & Edging           | CORE            | Mowing, edging along paths and beds, and clearing of cut grass.     |
| 2     | Garden Maintenance             | CORE            | Weed control, pruning, planting and bed care.                       |
| 3     | Hedge & Shrub Trimming         | CORE            | Shaping and trimming of hedges and shrubs.                          |
| 4     | Seasonal Clean-Ups             | CORE            | Leaf removal, debris clearing and garden refreshes.                 |
| 5     | Commercial & Complex Contracts | CORE            | Tailored maintenance plans for complexes, HOAs and business parks.  |
| 6     | Waste Removal                  | CORE            | Removal of garden waste from site.                                  |
| 7     | Weed Treatment                 | OPTIONAL_EXTRA  | Treatment to control weeds in lawns and beds.                       |

The existing property fields `agreedMonthlyFeeCents` and `extrasNote` (and the property
`frequency`) are **left untouched** in this module. Module 3 replaces them with the accepted
quote's lines, in a migration written and approved then, keeping the amount history.

## Behaviour and rules

- Only OWNER and MANAGER can list, add, edit, reorder, switch off or switch on a service. Enforced
  in `packages/core` with `assertRole(actor, MANAGEMENT)` first, like customers. Crew get no access
  in this module (a read-only name list for crew arrives with Jobs).
- Switching a service off hides it from new quotes only. Switched-off services remain visible to
  staff under a toggle, and can be switched back on. Nothing that already used the service changes.
- Editing a name or description affects future quotes only. Quotes will store their own copy of the
  wording (Module 3), so history never changes.
- Reordering swaps a service with its neighbour (up or down). Order values stay contiguous.
- A save that changes nothing writes nothing (no audit line, no `updatedAt` change).
- Every add, edit, reorder, switch-off and switch-on writes an audit line holding **field names and
  ids only**, never the text typed (same rule as customers).
- A duplicate name (ignoring case) gives a plain-language field error, not a crash.
- Concurrent edits: the changing action locks the row (conditional update) and re-reads, as in
  Module 1, so two managers cannot clobber each other.

## Screens (staff app, phone-friendly)

One page, `/services`, linked from the staff menu for OWNER and MANAGER only.

- A list of services in order: name, a chip for "Optional extra", the description, and up and down
  buttons. No drag and drop, so it works on a phone.
- "Add service" form (name, description, kind) and an Edit form per service, in the same style as the
  customer forms (focus moves to the first error, no lost input on a failed save).
- Switch off / Switch on button per service. A "Show switched-off services" toggle reveals the rest,
  shown greyed.
- Crew or signed-out visitors get the standard not-allowed or sign-in behaviour via `requireStaff`.

## Requirements carried forward (also recorded in docs/ARCHITECTURE.md)

- **Module 3, quote builder on a phone.** Opened at a site visit: every active service is a row with
  an on/off switch. Switching a row on lets staff set once-off or recurring, the visit frequency,
  the amount and a note for that property. Switched-off rows stay visible as "Not included". Drafts
  save as you go. Decide what happens with no mobile signal on site.
- **Module 3, scope snapshot.** Each quote line stores a copy of the service name and description.
  On acceptance the scope is frozen as the customer's agreed scope (and a lead becomes active).
- **Module 3, extra work.** A client request for a "not included" service becomes an extra-work quote,
  with the agreed scope as the record that it was never covered.
- **Module 6, crew.** Crew see the agreed scope for each property so they can tell included work from
  extras.

## Testing

- Unit tests for the zod schema (name and description length, kind, trimming).
- Database tests (`npm run test:db`, rolled-back transactions, dev database only): create, edit,
  no-op save, duplicate name ignoring case, reorder up/down at the ends, switch off/on, audit lines
  contain field names only, crew and signed-out actors refused, seed rows present.
- Real-browser check on a throwaway manager and crew account, at phone width: add, edit, reorder,
  switch off and on, duplicate name error, crew cannot reach the page.

## Before this module is merged

The migration (new table, seed rows, RLS and privilege revokes) needs the owner's explicit approval
before it is applied to the dev database.

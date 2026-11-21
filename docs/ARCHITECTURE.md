# Architecture and decisions

## The shape of the system

```
 Staff                          Clients
   |                               |
   v                               v
app.acegardens.co.za      portal.acegardens.co.za       www.acegardens.co.za
  (apps/admin)               (apps/portal)               (public website, separate repo)
        \                       /
         \                     /
          +---- packages/core ----+   shared rules: money, audit log, database access
                     |
                     v
              Postgres database (one, private)
```

Two apps instead of one so a fault in one cannot expose the other, and so each can be updated on
its own. One shared core so the apps never disagree about how money or quotes work.
There is deliberately **no separate API server**: each app runs its own server-side code.

## Decisions

| Decision        | Choice                                                                               | Why                                                                                            |
| --------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Framework       | Next.js 16 and React 19                                                              | Same family as the public website; one language across the system.                             |
| Language        | TypeScript, strict                                                                   | Catches mistakes before they reach a client.                                                   |
| Database        | Postgres via Supabase (Cape Town region wanted)                                      | Managed, backed up, South African region helps POPIA.                                          |
| Database access | Prisma 7                                                                             | Typed queries and safe, reviewable migrations.                                                 |
| Staff sign-in   | Email, password and a second verification step                                       | Staff can create and change money records, so they get the strongest protection.               |
| Client sign-in  | Emailed one-time code (no password)                                                  | Nothing for clients to remember, forget or reuse elsewhere.                                    |
| Money           | Whole cents, no decimals                                                             | Invoices must add up exactly.                                                                  |
| VAT             | Off. A settings switch exists for later.                                             | ACE is not VAT registered. Compulsory registration starts at R1 million turnover in 12 months. |
| Payments        | EFT only for now. Payments are separate records so card gateways can be added later. | Matches how clients pay today.                                                                 |
| Hosting         | Vercel (Cape Town region) for both apps                                              | Same as the public website.                                                                    |

## Module roadmap

Each module is built, tested and approved before the next begins.

| #   | Module                       | Delivers                                                                          |
| --- | ---------------------------- | --------------------------------------------------------------------------------- |
| 0   | Foundation                   | Project, checks, staff sign-in and roles, audit log, backups, email, error alerts |
| 1   | Customers                    | Client profiles, properties, contacts, notes, import from a spreadsheet           |
| 2   | Services catalogue           | The list of services quotes are built from (no prices: each client is quoted)     |
| 3   | Quotes                       | 3a built (builder, PDF, accept by staff); 3b (client link) built                  |
| 4   | Client portal and onboarding | Welcome and registration after acceptance, client sign-in, view quotes            |
| 5   | Invoices and statements      | EFT invoices with payment reference, mark paid, proof of payment, statements      |
| 6   | Jobs and scheduling          | Recurring weekly rounds, crew allocation                                          |
| 7+  | Extras                       | Card payments, accounting export, field app, WhatsApp, reports                    |

Requirements carried forward to later modules:

- ~~**Module 3b (Quotes): client link.** A private link per quote so the client can accept or
  decline.~~ Done in Module 3b (see the Quotes sections below). Extra work asked for later is
  simply a new quote for the same property.
- **Module 6 (Jobs): crew see the agreed scope** for each property, so included work and extras
  are clear on the day.

## Security and privacy rules (POPIA)

These apply to every module. A module is not finished until it follows all of them.

1. **No secrets in git.** Keys and passwords live in `.env.local` (never committed) and in the
   hosting dashboard. The secret/service key is used on the server only, never in the browser.
2. **No real personal data in git or in development.** Development uses made-up records. Real
   clients are imported through the app.
3. **Tables are private by default.** Row Level Security is switched on for every table, with no
   public access. Only our server code reads or writes.
4. **Check who is asking, every time.** Every server action confirms who is signed in and what they
   may do. Staff roles: OWNER, MANAGER, CREW. A client can only ever see their own records.
5. **Audit trail.** Creating, changing, sending, accepting, paying and signing in are recorded in
   the audit log with who, what and when. The log can be added to, never edited or deleted.
6. **Collect only what is needed**, say why, and record consent where it is required. Clients can
   ask what we hold about them.
7. **Private pages stay out of search engines.** Both apps are `noindex` and disallow all crawlers.
8. **Backups and recovery.** Automatic database backups, and a restore that has actually been tested.
9. **Breach plan.** If personal information is exposed, the Information Regulator and affected
   people must be told. The owner is responsible for registering an Information Officer.

## Staff sign-in (Module 0b)

- Two steps every time: email and password, then a 6-digit code from an authenticator app (TOTP).
  A session without the second step (`aal1`) is refused everywhere; each page and action checks
  this itself, not just the redirect in `proxy.ts`.
- A staff member needs both a sign-in account and an active row in `staff_users`. Having only the
  sign-in account is not enough, and deactivating the row locks them out.
- Failed attempts show one generic message, so nobody can learn which emails have accounts.
- Sign-ins, failures, denials, code failures and sign-outs go to the audit log. Passwords and codes
  are never recorded.
- Accounts are created only by `npm run staff:create` (and later by an owner inside the app).
  Public sign-up is switched off in Supabase.

## Customers (Module 1)

- **Tables:** `customers`, `contacts` and `properties`, with the same hardening as every table
  (Row Level Security on, no public access). Customers and properties are archived, never deleted.
  The only removals are anonymising a customer (below) and removing a contact, which deletes that
  contact row.
- **Customer numbers** (`C-0001` style) come from a database sequence. Gaps are normal: a number
  used inside a rolled-back transaction (for example by the database tests) is not handed out
  again.
- **Roles are enforced in `packages/core/src/customers/`, not in the screens.** OWNER and MANAGER
  see everything; export and anonymise are OWNER only. CREW get a separate view with a fixed list
  of columns in `views.ts` (customer name, property address, map link, access notes). The crew
  list also leaves out leads and archived customers. A new screen cannot leak a field by accident,
  because the crew query never selects the restricted columns.
- **Browser-safe entry `@ace/core/client`.** It holds only validation rules and types. The rule:
  client components never import values from `@ace/core` (that pulls the database code into the
  browser); they import from `@ace/core/client` instead.
- **Audit lines hold field names and ids only, never personal values** (for example "changed:
  email, phone" and the customer id). The reason: the audit log can never be edited, so if it held
  names or emails, anonymising a customer would leave them behind. A save that changes nothing
  writes no audit line.
- **Anonymise** (OWNER only) replaces a customer's personal details and cannot be undone. The owner
  must type the customer number to confirm. It writes the contacts and properties first and the
  customer row last, under a lock on the customer row, so a half-finished run can be retried and an
  edit cannot slip in at the same time. Money amounts are kept. Archived customers can still be
  corrected and stay archived; anonymised customers cannot be changed at all. A guard test, `privacy-coverage.test.ts`, fails whenever a new personal column
  is added to a customer table until someone decides how anonymise treats it.
- **CSV import:** at most 2 MB and 2,000 rows. The file is read and previewed first, then confirmed.
  Duplicates (same email, same phone, or same name and address) are skipped. Errors are reported by
  spreadsheet row number and skipped. The file itself is never stored, and the audit line records
  counts only.
- **Small decisions that matter:** the customer page tab bar scrolls sideways on phones; phone
  numbers are stored in `+27` form; emails are stored in lowercase.

### Known limitations and follow-ups

- Removing a contact and archiving a property have no "are you sure" step. Removing a contact
  deletes it for good. Archived properties have no screen to bring them back.
- Exporting a customer is a plain link (a GET request) that writes one audit line each time it is
  opened.
- Attempts that are refused (for example a crew member typing a restricted address) are not written
  to the audit log.
- The database tests need a real development database, so CI does not run them. Run
  `npm run test:db` yourself before merging.
- A CSV with more than about 2 MB of non-English (non-ASCII) text may fail at the confirm step with
  a body-size error.
- Real customer numbers start after the numbers the tests have used up in the development
  database. Use a fresh live database for real data so the numbers start at `C-0001`.
- Add database CHECK constraints for the `+27` phone format and for `status = ARCHIVED` going with
  `archivedAt` being set. This needs a new migration, so it was left out of this module.
- Contacts are hard-deleted. Add a confirm step and switch to a soft delete before quotes reference
  contacts in Module 3.
- The row lock is a touch of `updatedAt`. Switch to `SELECT ... FOR UPDATE` before Module 3 locks
  customers.
- ~~Extend `anonymiseCustomer`, `privacy-coverage.test.ts` and the export to quotes.~~ Done in
  Module 3a. The draft-save and revise paths also refuse an anonymised customer's quote, so
  personal text cannot be written back into one. Still to extend when they exist: invoices and any
  other table that holds customer data, and drive that test from the set of scrubbed fields.
- Imported customers have no per-customer audit row (the import writes one line with counts).
- Bind form ids to their customer in core (for example a contact id must belong to the customer
  in the URL) before Module 4 adds client logins.
- The database tests use some fixed emails and phone numbers, and `test-db.mjs` has no allow-list
  for which database it runs against. Check `.env.local` points at the development database before
  running `npm run test:db`.

### Before real customer data goes in

- [ ] Create a fresh live Supabase project and run `prisma migrate deploy`. Customer numbers then
      start at `C-0001` (the development database numbers were used up by tests).
- [ ] Confirm the region. Cape Town was wanted; check Supabase offers it. If not, record the basis
      for the cross-border transfer under POPIA section 72.
- [ ] Turn on backups and test a restore. Anonymised data stays in backups until they roll off.
- [ ] Re-run the Row Level Security and privilege checks against the live database for both `anon`
      and `authenticated`.
- [ ] Keep sign-up disabled, a minimum password length of 12 or more, leaked-password protection
      on, and the custom email sender.
- [ ] Only the hosting dashboard holds live credentials, never `.env.local`.
- [ ] Imported customers have no consent date. Record the lawful basis (an existing customer
      relationship) or add a consent column to the import before importing real clients.
- [ ] The `services` seed rows are the starting wording; check them in the live app.

## Services (Module 2)

- **Table:** `services`, hardened like every table (Row Level Security on, no public access). Each
  service has a name (unique ignoring case, including switched-off ones), a description (the scope
  wording a client reads on a quote), a kind (`CORE` or `OPTIONAL_EXTRA`) and a display order.
  Services are switched off (archived), never deleted. There is deliberately no price anywhere:
  every client is quoted individually, so a price belongs on a quote line.
- **Seed rows:** seven starting services are inserted by the migration, so a fresh live database
  starts with them. Staff can edit them in the app afterwards.
- **Roles are enforced in `packages/core/src/services/`, not in the screens.** Only OWNER and
  MANAGER can list, add, edit, reorder, switch off or switch on a service. CREW get no access in
  this module, and `/services` sends them to the not-allowed page.
- **Order:** reordering swaps a switched-on service with its neighbour and renumbers the
  switched-on services 1, 2, 3 and so on. Ties (two services added at the same moment) are broken by
  creation time, then by id. A service switched back on goes to the end of the list.
- **Audit lines hold field names and ids only, never the text typed** (`service.created`,
  `service.updated`, `service.moved`, `service.archived`, `service.restored`). A save that changes
  nothing writes nothing.
- **One page, `/services`,** linked from the staff menu for OWNER and MANAGER only. It uses up and
  down buttons (no drag and drop) so it works on a phone, and a "Show switched-off services" toggle.
- **Hand-written SQL:** `services_name_lower_key`, the `*_not_blank` / `*_lowercase` CHECK
  constraints and the RLS/REVOKE statements are hand-written SQL that Prisma does not know about.
  Any generated migration must be read for a DROP of them, and migrations are produced with
  `prisma migrate diff` (schema to schema), not `prisma migrate dev`, against the shared dev
  database.

## Quotes (Module 3a)

- **Tables:** `quote_wording` (one owner-edited row), `quotes`, `quote_scope_items`, `quote_lines`
  and `quote_counters`, hardened like every table (Row Level Security on, no public access). Money
  is whole cents. Issued quotes are never deleted; only a never-issued draft can be deleted.
- **Statuses and rules:**
  - `DRAFT`: editable, saves as you go (a version number stops two devices overwriting each other).
  - `ISSUED`: frozen. Can be marked as sent, accepted, declined, withdrawn or revised.
  - `ACCEPTED`: never edited. Only the owner can reverse it (back to `ISSUED`, with a note).
  - `DECLINED`, `WITHDRAWN`: closed. A revision can still be started from them.
  - `REPLACED`: set only on an `ISSUED` source quote when its revision is issued.
  - Expired is not stored. A quote is expired when it is `ISSUED` and the South African date is
    after its valid-until date. An expired quote cannot be accepted; revise it instead.
  - Only one draft revision may exist in a numbered quote chain at a time.
- **Numbering:** `QUO-year-number` (for example `QUO-2026-0104`), with ` R2`, ` R3` for revisions.
  The number is given when the quote is issued, using one atomic counter statement per year
  (`quote_counters`), so two quotes issued at the same moment never share a number and drafts
  leave no gaps.
- **Frozen content:** at issue the recipient, the property label and address, the scope rows, the
  wording snapshot (tagline, exclusions, the terms that apply, every-visit points, business
  details) and a SHA-256 content hash are stored on the quote. Changing the wording or the services
  later never changes an issued quote. The PDF and the quote page show only this frozen content.
- **Agreement rule:** a property's current monthly agreement is its most recent accepted quote that
  has a monthly priced line. Accepting a new one ends the earlier ones (`quote.agreement_ended`).
  Accepted once-off quotes are listed separately and are never ended. Accepting also makes a lead
  active ("activated by quote acceptance"); a paused or archived customer is flagged, not changed.
  Accept and reverse lock the customer, then the property, then the quote, in that order.
- **Who can do what:** OWNER and MANAGER build, issue, send, accept, decline, withdraw and revise.
  Reversing an acceptance and editing the quote wording (`/settings/quote-wording`) are OWNER only.
  CREW get nothing: every page, action, route and core function checks the role first. The checks
  live in `packages/core/src/quotes/`, not in the screens.
- **Privacy extension:** audit lines hold field names, ids and fixed words only, never typed text.
  Anonymising a customer wipes the personal columns on their quotes (recipient, site, acceptance
  name and note, decline and reversal notes, internal note, accepted IP and browser). Amounts, lines,
  wording and the content hash stay. Anonymised customers' quotes cannot be accepted, declined or
  reversed. The privacy guard test covers every quote column, and the customer export includes the
  customer's quotes.
- **PDF:** generated on the server with the built-in PDF fonts (Helvetica), so no font files are
  bundled. The staff route is staff only; clients get the same PDF (without their email or phone)
  from the portal at `/q/<token>/pdf`, which is refused for bots and rate limited.
- **Hand-written SQL:** the check constraints, the RLS and REVOKE statements, the unique index on
  the quote number and the seeded `quote_wording` row in the quotes migration are hand-written SQL
  that Prisma does not know about (same note as services). Any generated migration must be read for
  a DROP of them, and migrations are produced with `prisma migrate diff`, not `prisma migrate dev`.
  A second migration removed the two temporary property columns (monthly fee and extras note).

### Known limitations and follow-ups

- ~~Quotes have no client link yet (Phase 3b). Until then staff share the PDF themselves.~~ Done in
  Module 3b (below).
- ~~For Phase 3b: `acceptQuote` is staff-bound ... the client link will need a shared internal accept
  function that takes an actor type.~~ Done in Module 3b: the staff action and the client link both
  call one shared accept function.
- The wording row lists (exclusions, terms, every-visit points) are stored as JSON.
- The customer Activity tab does not list quote events. They appear on the quote itself.
- `quote_lines.description` is staff text and is assumed to be free of personal details. The
  builder shows a short hint under the field, but nothing enforces it.
- Two staff saving the one wording row at the same moment can overwrite each other (it is a single
  settings row).
- The quote number counter is per year and gap-free only inside the issuing transaction.

### Before real customer data goes in

- [ ] Check the standard quote wording, the once-off terms (drafted by Claude from the owner's
      description), the "Every visit on record" points (some promises depend on the Jobs module)
      and the business details on a test quote in the live app.
- [ ] Have the terms read by a legal adviser once.

## Quotes: the private client link (Module 3b)

- **Where the code lives.** `packages/core/src/quotes/public.ts` is the only door the portal uses to
  reach the database. It has five functions: `getPublicQuote`, `recordLinkView`, `acceptViaLink`,
  `declineViaLink` and `checkRateLimit`. None takes a staff `Actor`; the client's acts are recorded
  with actor type `CUSTOMER`. `packages/ui` holds the quote document and the PDF layout, shared by
  both apps so staff and clients see the same thing. The portal pages are under
  `apps/portal/src/app/q/[token]`.
- **The portal's own database login.** The portal connects as the low-privilege role `ace_portal`,
  created by the migration `20261121120000_client_link` (no login until the owner sets a password).
  The migration lists exactly what it may read and write: a few columns of quotes, customers and
  properties, the quote lines and scope rows, insert-only on the audit log, and the rate-limit table.
  It cannot read contacts, staff, services, the internal note, other customers' details or the audit
  history. Every database call in the public path names its columns (`select`), so it works with
  those column-level grants. In production the portal exits at start-up when `PORTAL_DATABASE_URL`
  is not set (`apps/portal/src/instrumentation.ts`); in development it falls back to `DATABASE_URL`.
- **The link.** Each issued quote gets a random 256-bit code, shown to staff as a link
  (`<PORTAL_URL>/q/<code>`) they can copy, revoke or replace. Unknown, revoked and wrong codes all
  give the same not-found page. Pages are `noindex`, `no-store` and send no referrer. Link previews,
  crawlers and clients that send no browser string get a bare page, are not counted as a view and
  get no PDF.
- **Privacy.** The rate limiter keeps only a SHA-256 hash of the visitor's address. The client's
  address and browser are stored only on the acceptance record (scrubbed when the customer is
  anonymised, along with the link code) and never in the audit log. Audit lines hold fixed words
  and counts only, never the typed name.

### Known limitations and follow-ups

- There is no alert when a client accepts. Staff look at the Quotes list (status Accepted) and the
  "last viewed" time on the quote.
- A forwarded link works for whoever holds it. The typed name and the recorded address show who
  accepted.
- Over the rate limit, the page shows a "Too many requests" notice (HTTP 200, because a Next.js page
  cannot set its own status), while the PDF route returns a real HTTP 429.
- The client's address is taken from the first `x-forwarded-for` entry. That is only trustworthy on
  a host that overwrites the header (Vercel does). Check this when choosing the live host.
- ~~The customer data export includes the live link code.~~ Done: `exportCustomerData` leaves
  `linkToken` out of the quote rows it returns.
- The portal has no automated browser tests. The real-browser check is done by hand, as listed in
  the Module 3b spec.

### Before real customer data goes in

- [ ] Give the portal its own database login: in the live database run
      `ALTER ROLE ace_portal WITH LOGIN PASSWORD '<a new long random password>'` (type it yourself,
      never in chat or git), then set `PORTAL_DATABASE_URL` for the portal app to that role's pooled
      connection string. The portal will not start in production without it.
- [ ] Set `PORTAL_URL` for the staff app to the portal's public address. The staff app builds the
      client link from it, and in production it refuses to build one without it.
- [ ] Confirm the live host overwrites `x-forwarded-for` (see the limitation above).

## Working agreement

- Small steps. One module at a time. Nothing goes live without the owner approving it.
- Every change passes `npm run check` (types, lint, tests, formatting) before it is committed.
- The same checks run automatically on GitHub for every change.
- A test environment and a live environment, with separate databases. Live data is never used for testing.

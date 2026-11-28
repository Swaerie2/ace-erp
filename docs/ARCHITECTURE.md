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

| #   | Module                       | Delivers                                                                                                                    |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0   | Foundation                   | Project, checks, staff sign-in and roles, audit log, backups, email, error alerts                                           |
| 1   | Customers                    | Client profiles, properties, contacts, notes, import from a spreadsheet                                                     |
| 2   | Services catalogue           | The list of services quotes are built from (no prices: each client is quoted)                                               |
| 3   | Quotes                       | 3a built (builder, PDF, accept by staff); 3b (client link) built                                                            |
| 4   | Client portal and onboarding | Built: sign-in by emailed code, welcome page, quotes with accept/decline, My complexes for agencies                         |
| 5   | Invoices and statements      | 5a built (staff): Pre or Post billing, monthly run, EFT invoices with PDF and email, payments, statements; 5b (portal) next |
| 6   | Jobs and scheduling          | Recurring weekly rounds, crew allocation                                                                                    |
| 7+  | Extras                       | Card payments, accounting export, field app, WhatsApp, reports                                                              |

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
  corrected and stay archived; anonymised customers cannot be changed at all. A guard test,
  `privacy-coverage.test.ts`, fails whenever a new personal column is added to a customer table
  until someone decides how anonymise treats it.
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
- Portal ids are bound by the signed-in scope in core; staff form ids are still not bound to the
  customer in the URL. The new Invite to portal and Remove access actions look up the contact's real
  customer for the change and the redirect; saving and removing a contact still redirect by the form
  id. Bind them as a follow-up.
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
  In Module 3b it could not read contacts, staff, services, the internal note, other customers' details
  or the audit history; Module 4 added a short, exact list of columns (see the Module 4 section) and
  it still cannot read staff, services, wording, settings, the internal note or the audit history.
  Every database call in the public path names its columns (`select`), so it works with those
  column-level grants. In production the portal exits at start-up when `PORTAL_DATABASE_URL`,
  `RESEND_API_KEY`, `EMAIL_FROM` or `PORTAL_URL` is not set (`apps/portal/src/instrumentation.ts`,
  fixed messages, never a value); in development it falls back to `DATABASE_URL`.
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
- [ ] Set `PORTAL_URL` for the staff app to the portal's public address (Module 4 also needs it in the
      portal app: see its checklist below). The staff app builds the client link from it, and in
      production it refuses to build one without it.
- [ ] Confirm the live host overwrites `x-forwarded-for` (see the limitation above).

## Client portal, sign-in and managing agencies (Module 4)

- **Where the code lives.** `packages/core/src/portal/`. Portal-facing functions (sign-in, session,
  welcome, quotes, home) take a `PortalScope`, never a staff `Actor`, and are exported only from
  `@ace/core/portal`. Staff functions (managing-agency links, Invite to portal, Remove access) take
  `(store, actor, ...)`, check the role first and are exported from `@ace/core`. The portal pages are
  `apps/portal/src/app/{sign-in,welcome,quotes}` and the home page (`page.tsx`); the accept and decline
  forms are shared with the private link page (`apps/portal/src/components/quote-forms`). The staff
  screens are the Managed by panel and Complexes managed list on the customer page, the Portal panel on
  each contact (Invite to portal, Remove access), and the portal facts and history names on the quote.
- **Sign-in.** The client types their email and gets a 6-digit code by email (valid 10 minutes, single
  use, stored only as a salted hash, dead after 5 wrong tries). A correct code starts a session: a
  random token in the cookie, stored in the database only as a SHA-256 hash, valid 30 days from last
  use and 90 days at most. The cookie is `__Host-ace-portal` in production (plain `ace-portal` over
  http in development). Code requests are limited to 3 per email per hour, 10 per email per day and
  10 per visitor per hour (hashed values in the rate-limit table; windows are kept two days before
  cleanup), and each code allows 5 tries. The reply never says whether an email is on file. This is not
  Supabase Auth: client logins live in their own tables (`portal_codes`, `portal_sessions`) and are
  completely separate from staff accounts.
- **The welcome page.** First sign-in only: name, phone, the billing address of the contact's own
  customer, and the POPIA consent. There are deliberately no property access or gate notes anywhere
  in the portal (owner decision): staff keep entering those in the Customers module.
- **What clients see.** Their quotes (issued, accepted, declined) and the PDF. They can accept or
  decline an open quote. Accepting uses the same shared acceptance routine as staff and the private
  link, with method `CLIENT_PORTAL` and the accepting contact recorded (`acceptedByContactId`).
- **The visible set.** Every request recomputes, from live data, the contacts with that email and
  portal access (customer not archived or anonymised), their customers, and the customers those
  manage (one level). Every query is restricted to that set, inside the query itself, never only
  in a check before it. Removing access, archiving or anonymising ends a session at once; moving a
  complex to another agency moves its visibility at once.
- **Managing agencies.** A complex is its own customer with an optional Managed by link to its agency
  and a Bills go to switch. The agency sees a My complexes page. One level only: a managed customer
  cannot be an agency, a customer that manages others cannot be managed, and an agency that still
  manages complexes cannot be anonymised.
- **Access.** After any acceptance commits (staff, link or portal), the quote customer's contacts who
  receive quotes, have an email and were never invited get access and a welcome email (sent with
  `after()`; an email failure never undoes the acceptance). Staff can Invite to portal (also re-sends)
  and Remove access. A removed contact is never silently re-granted. Changing a contact's email
  switches its portal access off and clears the welcome (the invitation date is kept, so nothing
  re-grants it); staff use Invite to portal for the new address.
- **Email.** `sendEmail` posts to Resend's HTTP API (no extra package). Without a key: printed to the
  server console when NODE_ENV is development or test (read the sign-in code there), and a loud
  failure for any other value. In production the portal refuses to start without `RESEND_API_KEY`,
  `EMAIL_FROM` and `PORTAL_URL`.
- **The portal's database login** (`ace_portal`) gained exactly the column grants listed in the
  migration `20261123120000_client_portal`, frozen by the exact-privileges catalogue test
  (`packages/core/src/quotes/portal-role.db.test.ts`). It still cannot read property access notes,
  staff, services, wording, settings or the audit history.
- **Privacy.** Codes and session tokens are stored only as hashes. Email addresses in the rate-limit
  table are hashed. Audit lines hold fixed words and ids only. Anonymising a customer ends its
  sign-ins and removes its codes and sessions. Sign-in pages and signed-in pages are `noindex` and
  `no-store` (headers in `apps/portal/next.config.ts`).

### Known limitations and follow-ups

- No alert to staff when a client signs in or accepts; staff look at the Quotes list and "last signed
  in" on the contact.
- Anyone who controls the inbox can sign in; there is no second factor for clients, by design.
- The billing address on the welcome page belongs to the customer, so it is shared with every contact
  of that customer.
- A sign-in request that is sent (SENT) and one with no match (NO_MATCH) differ by a few milliseconds
  of database work. Accepted.
- The rate limits use fixed windows (hour windows, and a UTC-day window for the daily email cap), so up
  to double the limit (up to 20 code requests around midnight UTC) can get through across a window
  boundary. A per-email cap also means someone can keep one email at its daily cap by spacing requests
  (3 per hour over 4 hours); that is inherent to a per-email limit, and the hourly and visitor limits
  slow it down.
- The signed-in header rules in `apps/portal/next.config.ts` are an allow-list: any NEW signed-in route
  must be added there, or it goes out without `no-store` and `noindex`.
- The `__Host-` cookie set and clear could not be tested over http. Check them on the first https
  deployment.
- `verifySignInCode` must be called with the pool client, not inside a transaction (it opens its own
  transaction and its first steps must be committed on their own).
- An agency's acceptance on behalf of a complex records the person and the agency; the complex's own
  contacts are not told.
- Over the page view limit, a page shows a "Too many requests" notice with HTTP 200 (a Next.js page
  cannot set its own status), while the PDF route returns a real 429. Sign-in pages show their own
  "too many" message.

### Before real customer data goes in

- [ ] Set up a Resend account and verify the `acegardens.co.za` domain (SPF and DKIM DNS records). Put
      `RESEND_API_KEY` and `EMAIL_FROM` in the hosting settings for BOTH apps (the staff app sends the
      welcome on Invite to portal). Never in git or chat.
- [ ] Set `PORTAL_URL` for BOTH apps to the portal's public address (the welcome email links to
      `<PORTAL_URL>/sign-in`; production refuses to build links without it).
- [ ] The Module 3b items still apply: the `ace_portal` login password and `PORTAL_DATABASE_URL`, and
      the `x-forwarded-for` check on the live host.
- [ ] In a real browser, check sign-in over https: the code arrives, the `__Host-ace-portal` cookie
      is set, stays after a page reload, and is cleared by Sign out.
- [ ] Send one real sign-in email to an inbox you control and check it arrives (not in spam) and the
      code works.

## Invoices, payments and statements (Module 5a, staff side)

- **Where the code lives.** `packages/core/src/invoices/`: small pure files with their own tests (`dates.ts`
  for run month, service month, due dates and part months; `money.ts` for totals, balances, statuses and
  allocation suggestions; `reference.ts`; `statement-math.ts`; `schemas.ts`), the shared helpers (`store.ts`:
  locks, allocated sums, audit lines) and the staff functions (`settings.ts`, `drafts.ts`, `run.ts`,
  `issue.ts`, `payments.ts`, `reports.ts`, `statements.ts`, `document.ts`, `emails.ts`, `activity.ts`), each
  taking `(store, actor, ...)` with the role check first. Changing Invoice settings is owner only; everything
  else is owner and manager; crew never see invoices. The screens are `/invoices`, `/payments`,
  `/payments/reports`, `/statements`, `/settings/invoices` and the Invoices tab on the customer page.
- **Pre or Post.** Each customer has a Billing timing switch (default Pre). The run in month M bills Pre
  clients for month M+1 (due the last day of M) and Post clients for month M (due the 25th of M). The run
  month can be any month from 12 months back up to next month.
- **The run.** "Create this month's invoices" makes one DRAFT per customer that has a monthly agreement in
  force (leads, paused, archived and anonymised customers are skipped), each customer in its own
  transaction. Lines come from the accepted quote (priced monthly lines and chosen monthly options, labelled
  with the property). The agreement billed for a property is the one in force for the month: the old price
  carries on until the month the replacement quote starts, and that whole month is billed at the new price.
  Only a property's first agreement is charged by days when it starts after the 1st. Each overdue issued
  invoice with a balance and no fee yet gets a suggested late payment fee line (amount in settings, 0
  switches it off). Running it twice makes no duplicates (a partial unique index guards it). It is one
  function, so a later automatic switch can call it.
- **Start-month catch-up (part-month invoices).** The run bills Pre clients a month ahead, so a client whose
  first agreement starts in a month whose run has already been (Pre: the 20th of the month before; Post:
  the 20th of the month) would never be billed for those first days. `catchup.ts` finds these clients
  (only a property's first agreement, starting this month or last month: older months are never caught
  up) that have no live monthly invoice for that month, and makes a DRAFT for that month with the lines
  the run would build (the part month charged by days, no late fees). It is due a week from today or on
  the normal due date if later, never more than a week after that month ends and never before today. It
  happens when staff record an acceptance in the staff app (after the acceptance has committed; a failure
  never undoes the acceptance), from the box "N clients need a part-month invoice" on the Invoices page
  (for clients who accepted in the portal or on the client link), and after every "Create this month's
  invoices". The portal never creates invoices: its database login has no rights on the invoice tables.
  A monthly draft whose month before has no live invoice (for example after a switch from Post to Pre)
  carries the warning "No invoice exists for <month>".
- **Issue.** Gives the number `INV-<year>-<0001>` from an atomic yearly counter, freezes the recipient (the
  bill-to customer: the agency when the complex's bills go to it), ACE's bank and company details
  (including the address) and the total, and stores a fingerprint (`contentHash`). "Issue all drafts" does
  at most 50 drafts per press in the staff app. The email (one per address of the payer's contacts who
  receive invoices, every PDF of that issue attached, split into several emails above 20 files or 15 MB) is
  sent after the response with `after()`; a failure never undoes the issue, is noted on the invoice and in
  its history, and Resend email sends it again. Only Draft, Issued and Void are stored; Unpaid, Part paid,
  Paid and Overdue are worked out from the balance and the due date (South African time).
- **Payments.** EFT only. Staff record the date, amount, bank reference and note, and allocate to the payer's
  issued invoices. Core never allocates by itself: the payment form has a "Fill oldest first" button that
  spreads the amount, and staff can change every box. Money not allocated is credit on account. A voided
  payment keeps its allocations as history but they stop counting. An invoice with live allocations cannot
  be voided.
- **Lock order** everywhere: customers (smaller id first), then invoices (by id), then the payment, then the
  payment report; every write re-reads and re-checks after the locks.
- **Reported payments.** The `payment_reports` table exists; stage 5b's portal "I have paid" writes it. Staff
  confirm (this records the payment in the same step) or dismiss.
- **Statements** are worked out on demand for the paying customer and a period (opening balance, invoices,
  payments, closing balance, credit, what is still owed, and a per-complex breakdown for an agency), on
  screen and as a PDF. Allocations have no date of their own, so each one counts from the date its payment
  arrived: a statement printed again after money was allocated later can differ from the earlier print.
- **Documents.** Invoice and statement screens and PDFs are built from one document object (`document.ts`),
  which carries the frozen company address and the logo's version. The logo picture is added by the app
  (see Company profile below).
- **Privacy.** Anonymising a customer keeps invoice numbers, dates, amounts and allocations, clears the frozen
  recipient, void reasons, payment references and notes and report references, replaces line wording with a
  fixed word, and deletes its drafts. The export includes its invoices, payments and reports (without ACE's
  bank snapshot). Audit lines hold ids, counts and fixed words only. The portal's database login has no
  access to any invoice table yet (stage 5b adds exactly what the portal needs).
- **Database tests** run three files at a time by default (`packages/core/scripts/test-db.mjs`;
  `ACE_DB_TEST_WORKERS` from 2 to 8 sets another number, 1 runs one file at a time): files that issue quote
  or invoice numbers hold the counter row lock for a whole rolled-back test, and with many files at once
  they can time out. If a counter-row timeout appears, run that file alone.

### Known limitations and follow-ups

- Annual escalation is manual: revise the accepted quote or edit the drafts.
- Only void-and-reissue corrects an issued invoice; there are no credit notes.
- The run skips a client who is paused when it runs but cannot know about a pause part way through the
  month; the owner reviews the drafts.
- A first month whose run had already been is caught up only for this month and last month (see Start-month
  catch-up); an older one is not charged automatically. A new property added for a client who already has
  that month's invoice is not caught up either (one monthly invoice per month): add its part month to the
  next draft by hand.
- The late fee suggestion on a draft looks at the overdue invoices of the customer being invoiced (the
  complex), not at everything its agency owes. The owner reviews the fee line.
- Statements are on demand only and are not emailed; credit on account is shown but never refunded or
  applied automatically.
- There is no fully automatic run on the 20th yet (the run is one function, ready for a switch).
- An anonymised customer's invoices and payments are frozen: they cannot be voided, allocated or issued
  against. The fingerprint (`contentHash`) of an anonymised invoice no longer matches its contents, so a
  future "verify" feature must treat those invoices as unverifiable. A payment reference or note typed for
  an agency may still name an anonymised complex (kept on purpose).
- The Invoices list works out the Not yet due, Overdue and Paid filters in the database over every issued
  invoice (no cap), then pages the matches. The reported payments list shows the newest 200.
- Payment reports ("I have paid") and every portal invoice page are stage 5b. A report for an invoice that
  was voided later can still be confirmed (the money becomes credit).
- Emails are sent one after the other inside `after()`, so a very large batch could outlast the hosting
  time limit; this is why Issue all stops at 50 per press. The invoice page shows whether an invoice was
  emailed, and Resend email sends it again.

### Before real customer data goes in

- [ ] The owner enters ACE's bank details (bank, account holder, account number, branch code, account type)
      in Invoice settings before the first issue. Check the once-off due days (14) and the late fee (R100).
- [ ] The owner uploads the company logo and enters the company address in Company profile (documents
      issued before the address is entered keep none).
- [ ] The Module 4 email checklist applies: Resend domain, `RESEND_API_KEY` and `EMAIL_FROM` in the hosting
      settings of the staff app (it sends the invoices).
- [ ] Send one real invoice email with its PDF to an inbox you control and check it arrives (not in spam)
      and the PDF opens.
- [ ] Open one invoice PDF and one quote PDF made after that and check that both show the logo and the
      company address.

## Company profile (logo and address)

- **Where the code lives.** `packages/core/src/company/` (`logo.ts` checks the picture, `profile.ts` holds the
  staff functions and the logo reads, `address.ts` and `format.ts` the address). The owner uses
  `/settings/company` (owner only; the menu shows it to the owner). The staff app serves the picture at
  `/company-logo` (owner and manager, private cache) and the portal at its own `/company-logo` (public and
  cacheable: a logo is not secret and the private quote link has no sign-in). Both add a `?v=<version>`
  address so a replaced logo shows at once.
- **The logo** is kept in its own one-row table, `company_logo` (migration
  `20261127150000_company_profile`), apart from `organisation_settings` so the bytes are never read by
  accident. PNG or JPEG only, at most 500 KB, 32 to 4000 pixels wide and high. The type is decided from the
  file's own first bytes, never the file name, and a damaged-file check refuses a picture that is cut off
  (a PNG without its end chunk, a JPEG without its end marker). No SVG. The database refuses anything else
  too. The `ace_portal` login may read only that table's columns (the one addition to the frozen portal
  grants catalogue); it still has no access to `organisation_settings`.
- **Live logo, frozen address.** The logo is read live: an old invoice printed again after the logo changed
  shows the new logo. The company address and details (and the bank details) are frozen on each invoice when
  it is issued and in each quote's wording when it is issued, so an older document keeps the address it was
  issued with, and one issued before an address was entered has none. A blank address is left out of the
  fingerprint, so documents issued without one hash as they did before.
- **PDFs.** The document objects carry the address (invoices and statements also the logo's version),
  never the picture. The app reads the logo bytes separately for each PDF (`getLogoForPdf` for staff,
  `getLogoForClientPdf` from `@ace/core/portal` for the portal) and hands them to the PDF layout. The invoice
  emails use the same logo in their attached PDFs. If the logo cannot be read or breaks the PDF, the PDF is
  made again without a logo (only fixed words are logged), so a bad logo never stops an invoice, statement
  or quote PDF. Emails themselves stay plain text.
- **Privacy and audit.** The address and logo are business details, not personal data. Audit lines
  (`company.logo_set`, `company.logo_removed`, `company.address_changed`) hold the picture type and size or
  the names of the changed fields, never the address or the picture.
- **Company details** (legal and trading name, registration number, phone, email, website) are shown on the
  page for reference. The registration number, phone, email and website are still edited in Quote
  wording; the two names cannot be changed in the app.

### Known limitations and follow-ups

- A phone photo's rotation flag (EXIF) is not applied, and a lossless JPEG is refused: save the logo again
  as a plain PNG or JPEG.
- A file with extra bytes after the end of the picture is refused as damaged; saving it again fixes it.

## Working agreement

- Small steps. One module at a time. Nothing goes live without the owner approving it.
- Every change passes `npm run check` (types, lint, tests, formatting) before it is committed.
- The same checks run automatically on GitHub for every change.
- A test environment and a live environment, with separate databases. Live data is never used for testing.

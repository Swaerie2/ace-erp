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
| 3   | Quotes                       | Create, PDF, email, client link to accept, decline or ask for changes             |
| 4   | Client portal and onboarding | Welcome and registration after acceptance, client sign-in, view quotes            |
| 5   | Invoices and statements      | EFT invoices with payment reference, mark paid, proof of payment, statements      |
| 6   | Jobs and scheduling          | Recurring weekly rounds, crew allocation                                          |
| 7+  | Extras                       | Card payments, accounting export, field app, WhatsApp, reports                    |

Requirements carried forward to later modules:

- **Module 3 (Quotes): lead becomes active on acceptance.** When a client accepts a quote, the
  customer moves from Lead to Active automatically by calling `activateCustomer` (already built:
  the staff "Mark as active" button on the customer page uses it). The change is recorded as
  "activated by quote acceptance". Only leads convert automatically; if a paused or archived
  customer accepts a quote, it is flagged to staff instead of changing silently.
- **Module 3 (Quotes): phone-first quote builder with scope.** Built for use at a site visit on a
  phone. Every active service is a row with an on/off switch; switched on rows take once-off or
  recurring, visit frequency (weekly, every two weeks, monthly; always billed as one monthly
  amount), price and a note; switched off rows show as "Not included, quoted separately on
  request". Drafts save as you go; decide how it behaves with no signal on site. Each quote line
  stores a copy of the service wording, and acceptance freezes the scope as the customer's agreed
  scope. Work requested outside that scope becomes an extra-work quote. Module 3 also replaces the
  temporary property fee and extras fields (migration to be approved then).
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
- Extend `anonymiseCustomer` and `privacy-coverage.test.ts` to every new table that holds customer
  data (quotes, invoices), and drive that test from the set of scrubbed fields.
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

## Working agreement

- Small steps. One module at a time. Nothing goes live without the owner approving it.
- Every change passes `npm run check` (types, lint, tests, formatting) before it is committed.
- The same checks run automatically on GitHub for every change.
- A test environment and a live environment, with separate databases. Live data is never used for testing.

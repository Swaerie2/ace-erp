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
| 2   | Services and prices          | The price list quotes are built from                                              |
| 3   | Quotes                       | Create, PDF, email, client link to accept, decline or ask for changes             |
| 4   | Client portal and onboarding | Welcome and registration after acceptance, client sign-in, view quotes            |
| 5   | Invoices and statements      | EFT invoices with payment reference, mark paid, proof of payment, statements      |
| 6   | Jobs and scheduling          | Recurring weekly rounds, crew allocation                                          |
| 7+  | Extras                       | Card payments, accounting export, field app, WhatsApp, reports                    |

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

## Working agreement

- Small steps. One module at a time. Nothing goes live without the owner approving it.
- Every change passes `npm run check` (types, lint, tests, formatting) before it is committed.
- The same checks run automatically on GitHub for every change.
- A test environment and a live environment, with separate databases. Live data is never used for testing.

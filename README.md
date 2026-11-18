# ACE ERP

Staff app, client portal and shared core for ACE Garden Services (TERRA UNDECIM TRADING (PTY) LTD).

Built one module at a time, each one tested and approved before the next begins.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the decisions, the module roadmap and the
security rules.

## What is here

| Folder          | What it is                                                   | Address (live)            |
| --------------- | ------------------------------------------------------------ | ------------------------- |
| `apps/admin`    | Staff app (quotes, customers, invoices)                      | `app.acegardens.co.za`    |
| `apps/portal`   | Client portal (quotes, invoices, statements)                 | `portal.acegardens.co.za` |
| `packages/core` | Shared database, money rules, audit log. Both apps use this. | (not a website)           |

The public website (`www.acegardens.co.za`) is a separate project and is not touched from here.

## First-time setup

1. Install Node 22 or newer.
2. `npm install` (this also builds the database client).
3. Copy `.env.example` to `.env.local` and fill in your values. **Never commit `.env.local`.**
4. `npm run db:migrate` to create the tables in your development database.
5. `npm run dev:admin` (http://localhost:3100) or `npm run dev:portal` (http://localhost:3200).
   Run one at a time on a low-memory computer.

## Everyday commands

| Command          | What it does                                                                          |
| ---------------- | ------------------------------------------------------------------------------------- |
| `npm run check`  | Runs every check at once: types, lint, tests, formatting. Do this before each commit. |
| `npm run test`   | Runs the automated tests.                                                             |
| `npm run build`  | Builds both apps the way the live site is built.                                      |
| `npm run format` | Tidies the formatting of all files.                                                   |

## Ground rules

- **No real client data, passwords or keys in git.** Development uses made-up data only.
  Real clients are imported through the app, never stored in the code.
- **Money is whole cents.** ACE is not VAT registered, so no VAT is shown. VAT is a switch in the
  settings, off by default.
- **Every important change is written to the audit log.**

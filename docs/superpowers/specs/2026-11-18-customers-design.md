# Module 1: Customers (design)

Status: awaiting owner review. Date: 2026-11-18.

## Goal

Staff can load, find, edit and archive customers with their contacts and properties, and import
the existing client list from a CSV. This is the foundation that quotes (Module 3), the client
portal (Module 4) and invoices (Module 5) hang off.

## Out of scope (later modules)

Price list and service items (Module 2), quotes (3), client login (4), invoices and statements (5),
jobs and scheduling (6), crew timesheets (later), sending email or WhatsApp.

## Data model

All tables follow the existing hardening: Row Level Security on with no policies, privileges
revoked from `anon` and `authenticated`, only server code (Prisma over the service connection)
reads or writes. Money is whole cents. Every create, edit, archive, restore, import, export and
anonymise writes to `audit_log`.

### customers

| Field                                 | Notes                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| id                                    | uuid                                                                                              |
| number                                | `C-0001` style, generated from a database sequence, unique, never reused                          |
| type                                  | `PERSON` or `COMPANY` (company covers body corporates and managing agents)                        |
| displayName                           | what staff see and search; required                                                               |
| companyName, registrationNumber       | optional, for `COMPANY`                                                                           |
| status                                | `LEAD`, `ACTIVE`, `PAUSED`, `ARCHIVED`                                                            |
| billingAddress                        | structured: line1, line2, suburb, city, postalCode                                                |
| source                                | referral, google, facebook, directory, other (free note allowed)                                  |
| notes                                 | internal only                                                                                     |
| consentAt, consentSource, consentNote | when and how they agreed to us holding their details (POPIA)                                      |
| archivedAt, anonymisedAt              | customers are archived, never hard-deleted; anonymise replaces personal details but keeps the row |
| createdAt, updatedAt, createdBy       |                                                                                                   |

### contacts (people at a customer)

id, customerId, name, role (free text, e.g. owner, trustee, managing agent, tenant), email
(lowercased), phone (stored as +27 format), receivesQuotes, receivesInvoices, portalAccess
(boolean, the Module 4 sign-in will use a contact's email), createdAt, updatedAt.
Each customer needs at least one contact. Emails are not globally unique (one agent can manage
many bodies) but a duplicate triggers a warning.

### properties (where the work happens)

id, customerId, label (e.g. "Main house"), address (structured, same shape as billing),
mapUrl, accessNotes (gate codes, dogs, who to call), lawnSizeSqm, grassType, hasIrrigation,
terrainNotes, frequency (`WEEKLY`, `FORTNIGHTLY`, `MONTHLY`, `ONCE_OFF`), preferredDay,
agreedMonthlyFeeCents (nullable integer), extrasNote (e.g. weed treatment), archivedAt, timestamps.

The fee and extras are plain fields for now. In Module 2 they are replaced by links to price-list
items so prices are not typed in two places; the migration will be written then.

## Who sees what

Enforced in the data layer in `packages/core`, not in the screens, so a new screen cannot leak
fields by accident.

| Role              | Sees                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| OWNER, MANAGER    | Everything. Only OWNER can anonymise or export a customer.                                              |
| CREW              | Customer display name, property address, map link, access notes. Never fees, emails, phones or billing. |
| Client (Module 4) | Only their own records, never access notes or internal notes.                                           |

Two read functions exist: a full view (requires OWNER or MANAGER) and a crew view that selects only
the allowed columns. Tests prove the crew view cannot return restricted fields.

## Screens (apps/admin)

A small staff shell with navigation is added (Customers for now, more modules later). Mobile
first: adding a customer must be comfortable on a phone.

- `/customers`: list with search (number, name, email, phone, address), status filter, 25 per
  page, newest first. Archived hidden by default.
- `/customers/new`: add a customer with a first contact and an optional first property in one
  form. Shows a warning, not a block, if the email or phone already exists elsewhere.
- `/customers/[id]`: overview with tabs for Contacts, Properties and Activity (the audit trail for
  that customer). Edit, add contact, add property, archive and restore.
- `/customers/import`: upload CSV, preview, confirm (see below).
- Owner-only actions: export one customer's data (JSON download) and anonymise (type the customer
  number to confirm). Both are audited.

All forms validate on the server with zod; the browser checks are only a convenience. Phone numbers
accept `082 123 4567` or `+27 82 123 4567` and are stored as `+27821234567`.

## CSV import

- Columns (a downloadable template is provided): type, display name, company name, contact name,
  email, phone, billing address fields, property address, frequency, agreed monthly fee in rand,
  extras note, source, notes.
- Limits: 2 MB, 2,000 rows, CSV only.
- Step 1 uploads and parses on the server and shows a preview: rows that will be created, rows that
  look like duplicates (same email or phone, or same name and address) and rows with errors, each
  with the reason. Nothing is saved yet.
- Step 2 confirms. Duplicates are skipped by default; errors are skipped and listed. The import is
  one transaction.
- The uploaded file is never stored. The audit entry records counts only, no personal details.
- Real client files stay out of git (`*.csv` is already ignored).

## Errors and edge cases

- Duplicate warnings never block; unique customer numbers cannot collide (database sequence).
- Archiving keeps all history. Restoring returns the customer to its previous status.
- Anonymising cannot be undone, so it needs the typed confirmation and is owner-only.
- All forms show clear messages and keep what the user typed.

## Testing

- Unit: phone normalisation, address and money validation, customer number formatting, CSV parsing
  and duplicate detection, crew view excludes restricted fields.
- Database checks (same style as `verify-db`): RLS on, `anon` and `authenticated` cannot read the
  new tables, unique number, lowercase email constraint.
- Browser tests with made-up customers only: add, search, edit, archive and restore, import with
  good, duplicate and bad rows, and a CREW test account that cannot reach fees or emails even by
  typing the URL or calling the action directly.
- CI runs the checks, tests and build on every push, as today.

## Decisions to confirm at review

1. Customers are archived, not deleted; only anonymise removes personal details.
2. CREW never sees fees, emails, phones or billing.
3. Fee and extras are simple fields now and move into the price list in Module 2.

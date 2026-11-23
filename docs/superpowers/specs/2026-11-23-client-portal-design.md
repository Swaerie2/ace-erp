# Module 4: Client portal, sign-in and managing agencies

Status: design approved by the owner in three parts (2026-11-23), written spec awaiting review.

## Goal

A client signs in to `portal.acegardens.co.za` with their email and an emailed one-time code (no password), completes a short welcome page the first time, and sees their quotes (open, accepted, declined, expired), with the same accept and decline as the private link. Managing agencies see every complex they manage, with its properties and quotes, on a "My complexes" page. Staff can give, re-send and remove portal access, and link a complex to its managing agency.

## Decisions (made with the owner)

1. **Scope now:** sign-in, welcome page, quotes with accept/decline, My complexes. No invoices, statements or proof of service (Modules 5 and 6). Clients cannot add or remove people; staff do that.
2. **Login:** emailed 6-digit one-time code. We build it ourselves (our tables, one email path, instant removal of access, client logins kept completely separate from staff accounts). Not Supabase Auth.
3. **Who gets access:** automatically when a quote is accepted (on the link, in the portal, or recorded by staff), the contacts of that customer who receive quotes and have an email address, if never invited before. Staff can also press **Invite to portal** on any contact (this re-sends the welcome) and **Remove access**.
4. **Welcome page** (once per person): confirm name and phone (the email is the login and is fixed), billing address, and the privacy (POPIA) consent tick with the time recorded. **No gate or access codes anywhere in the portal** (owner decision, 2026-11-23: access is arranged with people on site; it can be added later if that changes). Staff keep entering access notes on the property in the Customers module, as today.
5. **Managing agencies:** each complex stays its own customer with its own quotes, agreement and properties. A new optional **Managed by** link ties it to its agency (an ordinary customer record). A per-complex **Bills go to** switch defaults to the agency and can be set to the complex itself. One level only: agency, complexes, properties. Agency contacts see all managed complexes and may accept or decline their open quotes (recorded as done for the agency). A complex's own contacts (for example trustees) see only their own complex.
6. **Proof of service (later):** the portal works from one rule, "which properties can this person see". Invoices and service proof attach to properties in Modules 5 and 6 and will appear on My complexes through that same rule. Not built now.

## Out of scope

Property access or gate codes in the portal (access is arranged with people on site; staff enter notes in the Customers module); invoices, statements, proof of service; text-message or WhatsApp codes; clients managing other people's access; staff alerts when a client signs in or accepts; "remember this device" beyond the session; passwords.

## Data model (one migration, hand-written, applied only after the owner approves it)

- **customers:** `managedById` (uuid, null, references customers, restrict) and `billsToManager` (boolean, not null, default true). CHECK `managedById IS NULL OR managedById <> id`. Index on `managedById`. Code rules, under the lock order below: a customer that manages complexes cannot itself be managed and vice versa (no chains, no cycles); an anonymised customer cannot be linked; an agency that still manages complexes cannot be anonymised (a clear message tells staff to move its complexes first); anonymising a complex clears its link.
- **contacts:** `portalInvitedAt`, `portalWelcomedAt`, `lastSignedInAt` (timestamps, null). `portalAccess` already exists.
- **quotes:** `acceptedByContactId` (uuid, null: which person accepted in the portal; the agency is implied when that contact's customer is not the quote's customer). New value `CLIENT_PORTAL` for `QuoteAcceptMethod`.
- **portal_codes:** `id`, `email` (lowercase), `codeHash` and `salt`, `expiresAt`, `attempts` (default 0), `usedAt` (null), `createdAt`. Index on `email`.
- **portal_sessions:** `id`, `tokenHash` (unique; SHA-256 of the random cookie value), `email`, `createdAt`, `lastSeenAt`, `expiresAt` (sliding 30 days), `absoluteExpiresAt` (90 days). Index on `email`.
- Both new tables have Row Level Security on, all rights revoked from `anon` and `authenticated`, and one policy for `ace_portal`. Rows older than a day are deleted opportunistically (about one request in a hundred), the same way as the rate-limit table.
- Personal data: `portal_codes.email` and `portal_sessions.email` are personal. They are deleted when the person's access is removed or their customer is anonymised, and the privacy-coverage test classifies every new column.

## The visible set ("scope")

For a signed-in email, every request computes, from the live data:

- **contacts**: contacts with that lowercase email, `portalAccess = true`, whose customer is neither archived nor anonymised;
- **customers**: the customers of those contacts, plus every customer whose `managedById` is one of them (one level);
- **properties**: non-archived properties of those customers.

A session is valid only while it has not expired **and** its scope contains at least one contact. Removing access, archiving the customer or anonymising it therefore stops the session at once, even before its row is deleted. Re-assigning a complex moves visibility immediately because nothing is copied.

Every portal read and write restricts itself to this set **inside the database query** (for example `where customerId in <scope customers>`). Identifiers in a web address or form are never trusted on their own. Quotes shown: `ISSUED` (open or expired), `ACCEPTED`, `DECLINED`. Never `DRAFT`, `WITHDRAWN` or `REPLACED`. A quote whose private link was revoked is still visible here (the portal is authenticated; the revoke only retires the shared secret).

## Behaviour

### Sign-in

- `/sign-in`: email field. The reply is always "If that email is on file, we have sent a code", whether or not it is. A code is created only if the email belongs to a contact in scope (access on, customer not archived or anonymised). Creating a code invalidates that email's earlier unused codes.
- Codes: 6 digits from a secure random source, valid 10 minutes, stored salted and hashed, compared in constant time. After 5 wrong tries a code is dead. A used code cannot be reused.
- Limits (hashed visitor address and hashed email, the same rate-limit table with an hour window): 3 code requests per email and 10 per visitor per hour; verifying attempts also count against the visitor's action allowance.
- `/sign-in/code`: code field. On success a new session is created (a fresh random token every time), the cookie is set (`__Host-ace-portal` in production, `ace-portal` in development; secure, HTTP-only, same-site lax, path `/`), `lastSignedInAt` is set on the matching contacts, and the person goes to `/welcome` if any of their contacts is not yet welcomed, otherwise to the home page.
- Sign out deletes the session. Sessions slide for 30 days from last use and end at 90 days.
- Link previews and crawlers get the plain page and cannot request codes (the same bot rule as the quote link).

### Welcome (`/welcome`)

Shown once per contact (`portalWelcomedAt` null), one contact at a time if the email has several. Fields: the contact's name and phone (validated and normalised with the existing helpers), the privacy consent tick (required; sets `consentAt` and `consentSource = "portal"` on that contact's customer if not already set), and the billing address of that contact's own customer (for an agency, the agency's own address, not each complex's). Property access notes are not asked for, shown or editable in the portal for anyone, agency or not. Submitting sets `portalWelcomedAt`.

### Home, My complexes and quotes

- `/`: the person's quotes grouped by customer and property. If the scope includes managed complexes the home page is **My complexes**: each complex (name, status) with its properties and their quotes underneath, collapsed by default when there are many. Search by complex name.
- `/quotes/[id]`: the same document as the private link (name and property address only, never email or phone, never internal notes), the PDF download, and for an open quote the same accept form (add-ons, typed full name, start date, agree tick) and decline form. Authority is the scope: the quote's customer must be in it.
- Accepting or declining reuses the shared acceptance routine with `CLIENT_PORTAL`, the contact id, and the same proof (time, name, add-ons, start date, address and browser on the quote record; fixed words only in the audit log, actor type `CUSTOMER`). Double-click records once, as on the link.
- `/quotes/[id]/pdf`: the same PDF as the link, rate limited like it (real 429), no-store.

### Granting and removing access

- After an acceptance commits (staff action, link, or portal), `grantPortalAccess(quote)` runs in its own transaction: contacts of the quote's customer with an email, `receivesQuotes`, `portalAccess = false` and `portalInvitedAt` null get access and `portalInvitedAt`, then the welcome email is sent. An email failure never undoes the acceptance: the audit notes `portal.invite_sent` or `portal.invite_failed` (fixed words only) and staff can press Invite to resend. A contact who was removed keeps `portalInvitedAt`, so it is never silently re-granted.
- Staff **Invite to portal** (owner or manager): sets access, `portalInvitedAt`, sends the welcome again. **Remove access**: access off, that email's sessions and codes deleted (only if no other contact with that email still has access).

### Email

One module in core, `sendEmail`, through Resend (`RESEND_API_KEY`, `EMAIL_FROM`, already in `.env.example`) over its HTTP API (no new dependency). Two plain HTML-plus-text emails: the sign-in code and the welcome. Subject lines carry nothing personal ("Your ACE sign-in code", "Welcome to the ACE client portal"). The welcome has a sign-in button to the portal's sign-in page; there is no secret in the link, the client requests a code on arrival. In development with no key the email is printed to the dev server console and never sent; in production a missing key makes sending fail loudly (and the portal's sign-in says nothing different to the visitor).

### Staff screens (staff app, owner and manager only; crew never)

- Customer page: **Managed by** (search for an agency, change or remove; audited) and, when managed, the **Bills go to** switch. On an agency, a **Complexes managed** list with counts and links.
- Contact: a **Portal** panel (access on or off, invited, last signed in) with Invite to portal and Remove access.
- Quote facts: "Accepted in the client portal by X" and "(for agency Y)" when the accepting contact belongs to the agency.
- Quote history labels for the new audit actions; customer anonymise removes sign-ins.

## Technical design

- **Core** (`packages/core/src/portal/`): `scope.ts` (pure helpers and the query that computes scope), `codes.ts` and `sessions.ts` (generate, hash, verify, create, read, slide, delete), `signin.ts` (`requestSignInCode`, `verifySignInCode`, `getPortalSession`, `signOut`), `welcome.ts`, `quotes.ts` (list, get, accept and decline for a scope), `access.ts` (`grantPortalAccess`, staff `inviteContact` and `removeContactAccess`), `hierarchy.ts` (My complexes query and the link rules) and `email/` (`sendEmail`, the two templates). None of the portal-facing functions takes a staff `Actor`; each takes the session scope. Every database call names its columns (the `ace_portal` role has column-level grants). Lock order stays customer (smaller id first when two are involved), then property, then quote.
- **The `ace_portal` role** gains exactly what the functions need, frozen again by the exact-privileges catalogue test: SELECT on `contacts` (`id`, `customerId`, `name`, `role`, `email`, `phone`, `receivesQuotes`, `portalAccess`, `portalInvitedAt`, `portalWelcomedAt`, `lastSignedInAt`) and UPDATE on `name`, `phone`, `portalAccess`, `portalInvitedAt`, `portalWelcomedAt`, `lastSignedInAt`, `updatedAt`; more SELECT on `customers` (`displayName`, `type`, `companyName`, `archivedAt`, billing columns, `consentAt`, `consentSource`, `managedById`, `billsToManager`) and UPDATE on the billing columns, `consentAt`, `consentSource`, `consentNote`; more SELECT on `properties` (`label`, address columns; **not** `accessNotes`, which the portal role can neither read nor write) and no new UPDATE on `properties` (it keeps only the `updatedAt` lock column from Module 3b); UPDATE on `quotes.acceptedByContactId`; SELECT, INSERT, UPDATE, DELETE on the two new tables. It still cannot touch staff users, services, wording, settings or the audit history.
- **Portal app:** pages `/sign-in`, `/sign-in/code`, `/welcome`, `/`, `/complexes` (part of home), `/quotes/[id]`, `/quotes/[id]/pdf`; a signed-in check helper that every page and action calls first; the quote link pages are unchanged. Response headers: every signed-in page is `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`; `/q/*` keeps `Referrer-Policy: no-referrer`.
- **Staff app:** the screens above, using the existing `requireStaff` first on every page, action and route, and `@ace/core/client` in client components. The staff accept action and the portal accept both call `grantPortalAccess` after commit.
- **Shared UI:** the accept and decline forms move to `@ace/ui` (or are shared by the link and portal pages) so there is one implementation.

## Privacy and security

- Possession of the email inbox is the only credential. Codes are short-lived, rate limited, hashed and single use; sessions are random, hashed in the database and revocable; no response reveals whether an email is on file.
- The visible set is computed from live data and enforced in each query; a client from one complex cannot reach another, and a complex's own contacts cannot reach the agency's other complexes.
- The audit log holds fixed words, ids and counts only, never emails, codes, names, addresses or browser strings. The client's address and browser are stored only on an acceptance record and scrubbed on anonymise, as for the link.
- Hashes of the visitor's address and of the email are the only thing the rate limiter keeps.
- Customer data export never includes sessions or codes; anonymise deletes them.

## Testing

- **Unit:** code generation and verification (length, expiry, attempts, constant-time compare, single use), session token hashing and expiry maths, scope rules, email templates, bot rule reuse.
- **Database (dev database, rolled-back transactions; each test issues few quotes because issuing is slow):** every portal function run under `SET LOCAL ROLE ace_portal`; break-in tests (client of complex A reading or writing B by id, trustee reaching the agency's other complexes, removed access, archived or anonymised customer, re-assigned complex, expired, reused and over-tried codes, request limits, unknown email gives the same reply and no code); agency link rules (no chains or cycles, anonymise refusals); grant-after-acceptance rules (never re-grant after removal, email failure leaves the acceptance); the exact-privileges catalogue test updated; privacy-coverage and export tests for the new columns.
- **Real browser (both apps):** staff link a complex to an agency and invite a contact; sign in with the code read from the dev server console; welcome page; quotes list; My complexes for an agency; accept and decline in the portal; a trustee sees only their complex; remove access ends the session; sign out; rate limit; headers; phone width (375px); one real accept through the actual `ace_portal` login (temporarily enabled with the owner's approval, then switched back off).

## Known limitations and go-live

- **Go-live:** set up Resend with the `acegardens.co.za` domain (DNS records) and put its key and `EMAIL_FROM` in the hosting settings (never in git); the `ace_portal` password and `PORTAL_DATABASE_URL`, `PORTAL_URL`, and the `x-forwarded-for` check from Module 3b still apply.
- No alert to staff when a client signs in or accepts; staff look at the Quotes list and "last signed in".
- Anyone who controls the inbox can sign in; there is no second factor for clients by design.
- A quote accepted by an agency contact on behalf of a complex records the person and the agency, but the complex's own contacts are not notified.
- Hierarchy is one level; a second level (a group of agencies) is a later change if ever needed.

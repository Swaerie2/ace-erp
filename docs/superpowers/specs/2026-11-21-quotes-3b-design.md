# Module 3b: The private client link for quotes (design)

Status: Draft for owner review. Date: 2026-11-21.

This builds on the approved Module 3 design (`2026-11-19-quotes-design.md`, section "Phase 3b: the private client link") and on phase 3a, which is merged. Where this document is more specific, this document wins.

## Goal

A client opens a private link, reads their quote, chooses their optional add-ons and presses **Accept** (or **Decline**), with no login. Staff see the result in the Quotes list. Everything a staff-recorded acceptance does also happens when the client accepts: a lead becomes active, and the quote becomes the property's agreed scope.

## Decisions taken with the owner

1. The link is the proof of identity: no one-time code. The record of who accepted, when, from where and exactly what, is what protects ACE.
2. Staff find out about an acceptance from the **Quotes list** (status Accepted) and from "last viewed" on the quote. No email, no push, no banner in this phase.
3. The link shows the client's name and the property address, **not** their email or phone.
4. Link previews (WhatsApp, Telegram, Facebook and similar) see only a bare page that names ACE and shows nothing about the quote, and do not count as the client viewing it.
5. Rate limiting is kept in the database, with the visitor's IP stored only as a hash.
6. The portal app talks to the database through a small, reviewed set of functions only. A separate low-privilege database login is a follow-up for before real clients use the link (see "Known limitations").
7. The quote document and the PDF layout move into one shared package, so the staff app and the portal use the same code.
8. If the customer is paused or archived when the client accepts, the acceptance is still recorded and staff see a note on the quote.

## Out of scope

Email or WhatsApp sending from the app; one-time codes; the client login and onboarding (Module 4); staff alerts beyond the Quotes list; a low-privilege database role (follow-up).

## Data model (one new migration, written by the build, approved by the owner before it is applied)

All new objects follow the existing hardening: Row Level Security on with no policies, privileges revoked from `anon` and `authenticated`.

### quotes: new columns

| Field            | Notes                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| linkToken        | text, unique, nullable. 32 random bytes as base64url (43 characters). Null means "no link" (revoked or never made) |
| linkCreatedAt    | timestamp, nullable                                                                                                |
| firstViewedAt    | timestamp, nullable                                                                                                |
| lastViewedAt     | timestamp, nullable                                                                                                |
| declinedByClient | boolean, default false. True when the decline came from the client link                                            |

Check constraint: `linkToken` is null or at least 40 characters long.

The existing columns `acceptedMethod` (value `CLIENT_LINK`), `acceptedByName`, `acceptedStartDate`, `acceptedIp`, `acceptedUserAgent`, `declineReason` and `contentHash` already exist and are used as designed. `linkToken` is a secret that opens personal data, so **anonymising a customer sets it to null** (the privacy guard test classifies the new columns).

### public_link_hits (rate limiting)

`bucket` text (for example `view:<ip hash>` or `act:<ip hash>`), `windowStart` timestamp (the start of a 10-minute window), `count` integer. Primary key (`bucket`, `windowStart`). No personal data: the IP is hashed with SHA-256 and a fixed label before it is stored. Rows older than a day are deleted opportunistically (about one request in a hundred).

## Behaviour

### The link

- A link is created automatically **when a quote is issued** (inside the issuing transaction). Staff can **Revoke** it (token set to null) and **Create a new link** (a fresh token); both are written to the audit log (`quote.link_revoked`, `quote.link_created`, no token in the log). A quote issued before this phase has no link until staff press Create.
- The address is `<PORTAL_URL>/q/<token>`.
- A link works while the quote is Issued, Accepted or Declined. A Replaced quote's link shows a "replaced" page; a Withdrawn quote's link shows a "withdrawn" page; an Expired quote's link shows an "expired" page.

### What a visitor sees at `/q/<token>`

- **Unknown, revoked or never-existing code:** one identical "This link is not valid" page (HTTP 404), whatever the reason.
- **Issued, not expired:** the quote document (name and property address only), then the acceptance form.
- **Expired:** "This quotation has expired. Please contact ACE Garden Services." with the business phone and email, and the document without the form.
- **Replaced:** "This quotation has been replaced by a newer version" with a button to the newest issued or accepted quote of the same number (its own link).
- **Withdrawn:** "This quotation has been withdrawn."
- **Accepted:** a confirmation with who accepted and when, the chosen add-ons and the start date, and a PDF download.
- **Declined:** "This quotation was declined."
- **Link previews and crawlers** (recognised by their user-agent: WhatsApp, facebookexternalhit, Twitterbot, TelegramBot, Slackbot, Discordbot, LinkedInBot, Googlebot, bingbot and similar) get a minimal page titled "Your quotation from ACE Garden Services" with no quote content, and no view is recorded.
- The page title and description never contain customer details. Pages are `noindex`, `nofollow`, never cached (`Cache-Control: private, no-store`), and send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`.

### Accepting

The form has: a tick box for each optional add-on, **Full name** (required), **Service start date** (today or later, South African date), and "I accept this quotation (Ref QUO-...) and the terms above" (required). The server then, in one transaction and using the same rules as a staff-recorded acceptance:

- checks the rate limit, finds the quote by token and locks customer, property and quote in that order;
- requires the quote to be ISSUED and not expired, the start date to be today or later, and the chosen lines to be optional lines of this quote;
- marks the chosen add-ons, sets ACCEPTED, `acceptedMethod = CLIENT_LINK`, the typed name, the start date, the IP address and browser, and no staff id;
- ends the property's earlier monthly agreement when this quote has monthly work (the agreement rule);
- makes a LEAD customer active (audit "activated by quote acceptance"), and leaves a PAUSED or ARCHIVED customer unchanged;
- writes the audit entry `quote.accepted` with actor type `CUSTOMER` (fixed words and counts only, never the name).

Pressing Accept twice records one acceptance: the second request finds the quote already accepted and shows the confirmation page. Acceptance by an anonymised customer's link cannot happen (the link no longer exists).

### Declining

An optional reason (up to 500 characters). Sets DECLINED, `declinedByClient = true`, stores the reason, audit `quote.declined` with actor type `CUSTOMER`. A lead stays a lead.

### Rate limits

Per visitor (hashed IP) in a 10-minute window: 120 page views and PDF downloads, and 10 accept or decline attempts. Over the limit the visitor gets a plain "Too many requests, please try again in a few minutes" page (HTTP 429). Staff are not affected (they use the staff app).

### PDF for clients

`/q/<token>/pdf` returns the frozen quote as a PDF (the same layout as staff get), without the client's email or phone, for Issued, Accepted and Declined quotes; anything else is the same not-found page. Same headers and rate limit as above.

### Staff screens (staff app)

- **Client link panel** on the quote page for Issued, Accepted and Declined quotes: the link, a Copy button, "Last viewed" (or "Not opened yet"), **Revoke link**, and **Create new link**. Owner and manager only.
- **Facts**: an acceptance from the link shows "Accepted on the client link by <name>" with the time; a decline from the link says so. When a client acceptance left the customer paused or archived, a note says "The customer is paused/archived, so they were not made active. Check the customer."
- The Quotes list needs no change (status Accepted).

## Technical design

- **Shared package `@ace/ui`** (`packages/ui`): `QuoteDocumentView` and `QuotePdf`, moved out of the staff app unchanged in behaviour. Both apps depend on it. Each app's `globals.css` adds a Tailwind `@source` line so the package's classes are generated. `@react-pdf/renderer` moves to this package (and stays an external package in both Next configs).
- **Core** (`packages/core/src/quotes`):
  - `link.ts`: token generation (`crypto.randomBytes(32)`), staff functions `createQuoteLink` and `revokeQuoteLink` (role: owner or manager), issuing calls token creation.
  - `acceptance.ts`: the shared internal acceptance routine used by both the staff function and the client function, taking an "acting party" (staff actor, or the client link with IP and browser) so the role check, the staff id and the audit actor type differ but every rule and lock is the same. `activateCustomer` is split the same way (an internal version without the role check, used only after the quote checks pass).
  - `public.ts`: the only functions the portal may call: `getPublicQuote(token)`, `recordLinkView(token)`, `acceptViaLink(token, input, context)`, `declineViaLink(token, input, context)`, and `checkRateLimit(kind, ipHash)`. None takes an `Actor`; each does its own checks and returns plain data (no database objects).
  - `bots.ts`: pure `isPreviewBot(userAgent)` and `hashIp(ip)`.
- **Portal app** (`apps/portal`): `/q/[token]` page, accept and decline server actions, `/q/[token]/pdf` route, the not-found, expired, replaced, withdrawn, accepted, declined, too-many-requests and bot pages, headers for `/q/*` in `next.config.ts`. The client's IP comes from the standard forwarded-for header (first address) and is hashed before any storage; the raw IP is stored only on the acceptance record itself (as proof) and scrubbed on anonymise.
- **Staff app**: client link panel and the facts additions; no other change.

## Privacy and security

- The link grants one quote and nothing else. 256 bits of randomness; lookup is an exact match on the unique column; wrong codes cost the same as unknown codes. No list, search or "recent" endpoint exists on the portal.
- The portal page shows the client's name and the property address but not their email or phone, and never the internal note, the staff names, other customers or the audit history.
- The raw IP and browser are stored only on an acceptance (proof) and are scrubbed when the customer is anonymised, together with the token. Hashed IPs are the only thing the rate limiter keeps.
- The portal app holds a full database connection (the same as the staff app) but exposes only the five public functions. This is the main residual risk and is listed under Known limitations.
- Every response from `/q/*` is `no-store`, `noindex` and `no-referrer`.

## Testing

- **Unit tests:** `isPreviewBot` (the listed bots and a normal browser), `hashIp`, token shape (43 characters, URL-safe, different each time), the public view-state decision (valid, expired, replaced, withdrawn, accepted, declined).
- **Database tests** (dev database, rolled-back transactions): token created on issue; revoke and re-create; every public function with a wrong, revoked and valid token (the not-found result is identical); view tracking sets first and last viewed only for Issued, Accepted and Declined quotes and never for a revoked link; client accept (add-ons, start date, agreement rule, lead activation, paused or archived customer left unchanged, actor type CUSTOMER, no names in the audit, double accept records once, expired and withdrawn refused, past start date refused); client decline; the rate limiter (allows up to the limit, refuses over it, separate buckets, old windows cleaned); anonymise nulls the token and the proof columns; the shared acceptance routine still behaves exactly as before for staff (the 3a tests keep passing unchanged); the database protections for the new column and table.
- **Real browser (both apps):** staff issue a quote and copy the link; open it in a clean window (no staff session): the document, the form, errors keep what was typed, accept with an add-on, confirmation, PDF; the staff page shows the acceptance, last viewed, the agreed scope and the active customer; decline path; expired (set the date back), replaced (revise and issue), withdrawn, revoked and wrong code all show the right page and the not-found pages look identical; double click on Accept; rate limit page (lower the limit through a test override or repeated requests); link preview bot user-agent gets the bare page and records no view; response headers on `/q/*`; phone width; no staff data visible to the client.

## Known limitations and follow-ups

- The portal's database connection is as powerful as the staff app's. Before real clients use the link, create a low-privilege database login for the portal (it needs read on quotes, scope items, lines, services and organisation data, and update on a few quote columns) and move the portal to it.
- There is no email or alert when a client accepts; staff look at the Quotes list.
- A link that was forwarded to someone else works for them too (the typed name and the IP record who accepted).
- The Revise button and the send, accept and decline buttons are still offered on an anonymised customer's quote (the system refuses them). Fix with the 3b screens if cheap.

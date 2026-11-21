# Module 3: Quotes (design)

Status: Phase 3a implemented and verified (branch module-3-quotes); awaiting owner merge. Phase 3b (client link) not started.

Date: 2026-11-19.

## Goal

Staff build a quote on site, on a phone, for one customer and one property, issue it, share it
(PDF now, a private client link in phase 3b), and record or receive the client's acceptance.
Accepting a quote makes the customer active and makes the quote the property's agreed scope, which
is the record ACE stands on when extra work is asked for later.

## Decisions taken with the owner

1. **Both ways to accept from the start:** staff record an acceptance, and the client can press
   Accept on a private link. Built as two phases (3a and 3b), each its own pull request.
2. **Delivery is manual:** staff copy the link or send the PDF by WhatsApp or email themselves. The
   app sends no email in this module.
3. **One property per quote.** A client with two properties gets two quotes.
4. **Prices are free-form lines, separate from scope.** The owner gives one combined price for the
   standard services (driven by the amount of work) and a separate price for weed treatment
   (driven by the area). There is no price on a service.
5. **A quote can be monthly, once-off, or both.** Recurring work has a visit frequency but is always
   billed as one monthly amount.
6. **Two standard sets of terms** (monthly contract, once-off), edited by the owner in the app and
   frozen into each quote when it is issued.
7. **Payment:** monthly work is paid in advance on or before the 30th; once-off work is paid before
   the work is completed. Clients pay by EFT. ACE is not VAT registered.
8. **Online only.** Staff almost always have mobile signal on site, so the builder is an ordinary
   online page that saves as you go. Offline saving is not built.
9. The layout is modernised. The information in the owner's current quote is kept.

## Out of scope

Sending email or WhatsApp from the app, deposits and invoices (Module 5 reads accepted quotes),
drawn signatures, one-time codes for the client link, crew-facing scope view (Module 6), client
login (Module 4).

## Phases

- **3a (first pull request):** quote wording settings, longer service descriptions, database
  tables, builder, quotes list, issue, PDF, revise, withdraw, staff-recorded accept and decline,
  owner reversal of an acceptance, lead activation, agreed scope on the property page, removal of
  the two temporary property fields, and the privacy extension (anonymise, export, privacy guard).
- **3b (second pull request):** the private client link (public page on the portal app), client
  accept and decline, "last viewed", rate limiting, the accepted-copy PDF, and the link controls on
  the staff quote page.

## Quote content

A quote is for one customer and one property and contains:

- **Reference and dates.** `QUO-2026-0104`: the year, then a running number (4 digits, more when
  needed). A revision adds a mark, `QUO-2026-0104 R2`. The number is given only when the quote is
  issued, so drafts leave no gaps. An issue date and a "valid until" date (30 days by default,
  changeable per quote).
- **Prepared for / prepared by.** Customer and contact details and the property address (frozen at
  issue), and ACE's business details.
- **Scope.** Every active service appears as a row, marked Included (highlighted) or Not included
  (printed as "Not included, quoted separately on request"). Each row carries its own copy of the
  service's name and wording. The document also prints the standard exclusions (see wording).
- **Price lines**, written by the staff member, each with a description and one of:
  - **Monthly**: an amount per month and a visit frequency (weekly, every two weeks, monthly).
  - **Once-off**: a single amount (for example a clean-up before a contract starts).
  - **Optional add-on**: an amount the client may take or leave, monthly or once-off, with a
    frequency or "as required". It is left out of the main total.
  - **Included**: no charge (for example green waste removal and service reporting).
- **Totals, worked out and never typed:** monthly total, once-off total, monthly total with the
  chosen optional add-ons. "All amounts in ZAR. ACE Garden Services is not VAT registered, no VAT
  is charged." comes from the organisation settings (VAT switch off).
- **Terms.** The monthly set if the quote has any monthly price line, the once-off set if it has any
  once-off price line, both if it has both, plus the common clauses. Frozen copies.
- **Internal note.** Never shown to the client.
- **The acceptance block**, which differs between the printed copy (signature lines) and the client
  link (name, start date, add-ons, tick box, Accept button).

## Data model

All new tables follow the existing hardening: Row Level Security on with no policies, privileges
revoked from `anon` and `authenticated`, only server code reads or writes. Money is whole cents. The
migrations (one per phase) need the owner's explicit approval before they are applied.

### quote_wording (one row, owner-edited)

| Field                                     | Notes                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| id                                        | `singleton`                                                             |
| tagline                                   | text                                                                    |
| standardExclusions                        | list of text lines                                                      |
| monthlyTerms                              | list of `{ heading, body }` clauses                                     |
| onceOffTerms                              | list of `{ heading, body }` clauses                                     |
| commonTerms                               | list of `{ heading, body }` clauses (liability, force majeure, banking) |
| everyVisitPoints                          | list of text lines (the "Every visit on record" block)                  |
| defaultValidityDays                       | whole number, 30                                                        |
| registrationNumber, phone, email, website | business details printed on quotes                                      |
| updatedAt, updatedById                    |                                                                         |

Lists are stored as validated JSON. The migration seeds the row with the defaults below.

### quotes

| Field                                             | Notes                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| id                                                | uuid                                                                                       |
| customerId, propertyId                            | required; the property must belong to the customer                                         |
| status                                            | `DRAFT`, `ISSUED`, `ACCEPTED`, `DECLINED`, `REPLACED`, `WITHDRAWN`                         |
| numberYear, numberSeq, revision                   | null while a draft; unique together once issued. Revision starts at 1                      |
| revisionOfId                                      | the quote this one revises (null for an original)                                          |
| draftVersion                                      | whole number, increases on every draft save (guards two devices editing one draft)         |
| validUntil                                        | date                                                                                       |
| internalNote                                      | text                                                                                       |
| createdById, createdAt, updatedAt                 |                                                                                            |
| issuedAt, issuedById                              | set when issued                                                                            |
| sentAt, sentMethod                                | "Mark as sent": how the quote was shared (`WHATSAPP`, `EMAIL`, `HAND`, `OTHER`)            |
| recipientName, recipientEmail, recipientPhone     | the contact the quote is addressed to, frozen at issue (personal)                          |
| siteLabel, siteAddress                            | the property label and one-line address, frozen at issue (personal)                        |
| wordingSnapshot                                   | JSON: tagline, exclusions, the terms sets that apply, every-visit points, business details |
| contentHash                                       | SHA-256 of the canonical content at issue (proves what was accepted)                       |
| acceptedAt, acceptedMethod                        | `WHATSAPP`, `EMAIL`, `PHONE`, `IN_PERSON`, `SIGNED_COPY`, `CLIENT_LINK`                    |
| acceptedByName, acceptedStartDate, acceptanceNote | who accepted (typed name), service start date, staff note (personal)                       |
| acceptedByStaffId                                 | the staff member who recorded it (null when the client accepted on the link)               |
| acceptedIp, acceptedUserAgent                     | only for `CLIENT_LINK` (personal)                                                          |
| declinedAt, declineReason                         | optional reason (personal)                                                                 |
| withdrawnAt                                       |                                                                                            |
| reversedAt, reversalNote                          | the last acceptance reversal (owner), note is personal                                     |
| agreementEndedAt, agreementReplacedById           | set when a later accepted monthly quote replaces this one as the property's agreement      |

Expired is not stored: a quote is "expired" when it is `ISSUED` and today's date (South African
time) is after `validUntil`. Phase 3b adds the link columns (`linkToken`, `linkCreatedAt`,
`firstViewedAt`, `lastViewedAt`) in its own migration.

### quote_scope_items

id, quoteId, serviceId (the catalogue service), sortOrder, included (boolean), name, description,
kind (copies of the service's wording). Copied when the draft is created and refreshed from the
catalogue when the quote is issued: a service added since is added as Not included, and a service
switched off since stays on the quote only if it was included.

### quote_lines

id, quoteId, sortOrder, lineKind (`PRICED`, `OPTIONAL`, `INCLUDED`), billing (`MONTHLY` or
`ONCE_OFF`; empty for `INCLUDED`), frequency (`WEEKLY`, `FORTNIGHTLY`, `MONTHLY`, `AS_REQUIRED`;
required for a `MONTHLY` priced line), description (up to 300 characters), amountCents (whole
number above zero for `PRICED` and `OPTIONAL`, empty for `INCLUDED`), chosen (boolean, whether the
client took an `OPTIONAL` line; set on acceptance).

### quote_counters

year (primary key), lastSeq. The next number is taken with one atomic statement
(`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), so two quotes issued at the same moment can
never get the same number. The year is the South African year of issue.

### Database protections

Checks: status and kind values by enum; amount above zero for priced and optional lines and null
for included lines; `numberYear` and `numberSeq` both set or both null; a draft has no number;
monthly priced lines have a frequency. The unique index on (`numberYear`, `numberSeq`, `revision`).

### Changes to existing tables

- **properties:** `agreedMonthlyFeeCents` and `extrasNote` are removed (with their check
  constraint), together with their form fields, the CSV import columns and the import template. They
  were temporary. `frequency` and `preferredDay` stay: they are scheduling preferences that Module 6
  will use. There is no real data in the dev database, and the live database starts fresh.
- **services:** the description limit goes from 300 to 800 characters and the text is treated as one
  bullet per line wherever it is shown on a quote. The seven seeded descriptions are single
  sentences; the owner replaces them with the real bullet wording in the Services page.

## Status rules

| From                                | To               | Who            | What it does                                                         |
| ----------------------------------- | ---------------- | -------------- | -------------------------------------------------------------------- |
| (new)                               | DRAFT            | owner, manager | Starts a draft; scope rows copied from the catalogue                 |
| DRAFT                               | ISSUED           | owner, manager | Finish. Validates, gives the number, freezes content and wording     |
| ISSUED                              | ACCEPTED         | owner, manager | Staff record acceptance (3a). The client link does it too (3b)       |
| ISSUED                              | DECLINED         | owner, manager | Records a decline with an optional reason (client link too in 3b)    |
| ISSUED                              | WITHDRAWN        | owner, manager | Staff cancel it before it is answered                                |
| ISSUED, ACCEPTED, DECLINED, expired | (revision DRAFT) | owner, manager | **Revise** copies it into a new draft                                |
| ISSUED                              | REPLACED         | automatic      | When its revision is issued                                          |
| ACCEPTED                            | ISSUED           | owner only     | Reverse an acceptance with a note. The customer stays active         |
| DRAFT                               | (deleted)        | owner, manager | A never-issued draft may be deleted. Issued quotes are never deleted |

- A draft is editable and saves as you go. Everything else is read only.
- An accepted quote is never edited. Later or extra work is a **new quote** for the same property,
  so the original scope remains as the record.
- An expired quote cannot be accepted; revise it to give it new dates.
- Revising an accepted quote creates a draft for the new version; the accepted one stays accepted
  until the revision is accepted (then its agreement is ended, see the agreement rule below).
- A revision keeps the number and increases `revision`. When a revision is issued, only a source
  quote that is `ISSUED` becomes `REPLACED`. A source that is `ACCEPTED`, `DECLINED` or `WITHDRAWN`
  is left as it is.
- A revision draft cannot be started while any draft revision exists anywhere in the same numbered
  quote chain.

### Issue (Finish) checks, in plain words

At least one service is included. At least one monthly or once-off price line exists (optional add-ons alone are not enough). Every priced or optional line has
an amount above zero. Every monthly priced line has a frequency. The valid-until date is today or
later. The property belongs to the customer and neither is archived or anonymised.

### Acceptance (staff-recorded)

Fields: how it was accepted, the date, who accepted (a contact's name, or typed), which optional
add-ons were chosen, the service start date (today or later), a note. Recording it, in one
transaction: sets `ACCEPTED`, stores the chosen add-ons, makes a lead active
(`activateCustomer`, logged as "activated by quote acceptance"; a paused or archived customer is
flagged to staff and left unchanged), and applies the **agreement rule**:

> The property's **current monthly agreement** is its most recent `ACCEPTED` quote that has a
> monthly priced line. When a new quote with a monthly priced line is accepted for the same
> property, each earlier agreement gets `agreementEndedAt` and `agreementReplacedById`, and one
> `quote.agreement_ended` audit line is written for each. An accepted once-off quote is never ended
> or replaced; it stays listed.

Accepting, declining and reversing are refused for an anonymised customer's quote. Accepting and
reversing take locks in the order customer, then property, then quote, so two staff accepting quotes
for one property take turns.

The property page shows the current monthly agreement (its included services, price lines and start
date) and a list of accepted once-off quotes. This is the agreed scope that Module 6 will show crew.

## Quote wording (owner only) and defaults

A page, `/settings/quote-wording`, owner only. It edits the one `quote_wording` row. Changes apply to
future quotes only. Defaults seeded by the migration (the business details and clauses come from the
owner's current quote; the once-off terms are drafted from what the owner described and are for the
owner to review):

- **Tagline:** "We don't cut corners. We define them."
- **Business details:** Terra Undecim Trading (Pty) Ltd t/a ACE Garden Services, Reg 2026/295342/07,
  Tel 079 296 0578, info@acegardens.co.za, www.acegardens.co.za.
- **Standard exclusions:** "Tree work, landscaping and redesign." / "Plants, compost and fertiliser
  (supplied at cost on written approval)." / "Other seasonal treatments: fertilising, scarifying,
  top-dressing and pest spraying."
- **Monthly terms:**
  - Payment: "Payable in advance on or before the 30th of each month."
  - Late payment: "Accounts not settled by the 5th of the following month attract a R100.00 late
    payment fee."
  - Annual escalation: "Service fees are reviewed annually each March; the projected escalation
    rate ranges between 6 and 8%."
  - Termination: "Either party may terminate this agreement without cause on 30 (thirty) days'
    written notice. On termination, the Client's obligation is limited to payment for services
    rendered up to the termination date, plus one (1) month's notice period at the contracted rate."
  - Scheduled closures: "In line with labour legislation, our teams take annual leave: two (2) weeks
    in July and one (1) week over the December/January festive season. Full monthly fees remain
    payable during these periods."
- **Once-off terms:**
  - Payment: "Once-off work is payable before the work is completed."
  - Scope: "Work outside the scope described in this quotation is quoted separately on request."
- **Common terms:**
  - Limitation of liability: "In the event of accidental damage caused by ACE Garden Services,
    written notification must be submitted within 5 (five) working days of the incident. All claims
    will be directed to ACE Garden Services' insurer. No cash settlements will be made directly by
    ACE Garden Services. The Client's full cooperation is required; failure to cooperate may result
    in claims being delayed or declined by the insurer."
  - Force majeure: "Neither party shall be held liable for delays or failure to perform obligations
    arising from causes beyond their reasonable control, including but not limited to natural
    disasters, severe weather events, or government-imposed restrictions."
  - Banking details: "Banking details will be confirmed by way of an official bank account
    confirmation letter on acceptance of this quotation."
- **Every visit on record:** "Your service is scheduled to a fixed day every week." / "Team clocks in
  and out with a GPS time stamp." / "Before and after photos on every visit." / "A service report is
  emailed to you after each visit." / "Branded ACE overalls and cap." / "Vetted staff with ACE ID." /
  "Same team every visit." (This is the owner's own sales text. Several of these promises depend on
  the Jobs module, which is built later; the owner can switch the block off or edit it.)
- **Default validity:** 30 days.

## Screens (staff app, phone first, 375px wide, no sideways scroll)

- **Quotes list** (`/quotes`): filters (Draft, Issued, Accepted, Declined, Expired, Replaced,
  Withdrawn, All), search by reference or customer name, newest first. A **Quotes** tab on the
  customer page. The property page gets the agreed scope panel.
- **New quote:** choose a customer and a property, or **Quick add**: a prospect's name, phone,
  address and optionally email creates a lead with one contact and one property (a duplicate email
  or phone warns, as in Module 1; no consent is claimed). Property details (lawn size, access notes)
  are shown at the top for reference.
- **Builder** (draft), one page with four steps and large tap targets:
  1. **Scope:** every active service as a big on/off switch. Switching on an optional extra
     (weed treatment) suggests an optional price line.
  2. **Price lines:** add a line with type chips (Monthly, Once-off, Optional, Included),
     description, frequency chips, and the amount in rand. When core services are on and no monthly
     line exists yet, it suggests "Garden maintenance, as per scope", weekly.
  3. **Details:** valid-until, internal note.
  4. **Review:** live totals, a preview of the document, **Finish and issue**.
     Everything saves as you go (debounced, whole draft with `draftVersion`). The builder saves one
     request at a time and shows a Saved, Saving or Could not save indicator. Nothing typed is lost
     on a failed save, and it retries every 5 seconds. On a version conflict (the draft was changed
     from another device) it stops and tells the person to reload instead of overwriting.
     **Finish** only issues when the newest changes are saved. A never-issued draft can be deleted.
- **Quote page** (issued and later): the document, status, a panel of the actions that apply (Mark
  as sent, Record acceptance, Decline, Withdraw, Revise, Reverse acceptance for the owner, Download
  PDF), and the history of the quote.
- **PDF:** generated on the server with a PDF library that runs on the hosting platform without
  extra services (React-based). It uses the built-in Helvetica font, so no font files are bundled.
  The route is staff-only. It shows the frozen content, never live customer data.
- **Quote wording** page (owner only; managers cannot open it), as above, with a simple list editor for clauses (add, edit,
  reorder with up/down buttons, remove).

## Privacy and security

- Every page, action and route calls `requireStaff(["OWNER","MANAGER"])` first (the wording page:
  owner only). Every core function calls `assertRole` first. Crew get no access to quotes or prices.
- Audit lines hold field names, ids and fixed words only, never personal values or free text:
  `quote.created`, `quote.issued`, `quote.revised`, `quote.sent`, `quote.accepted`,
  `quote.declined`, `quote.withdrawn`, `quote.reversed`, `quote.replaced`, `quote.agreement_ended`,
  `quote.deleted_draft`,
  `quote_wording.updated`. Draft autosaves are not audited. Customer activation records
  "activated by quote acceptance".
- **Anonymise** (owner) is extended: it wipes `recipientName`, `recipientEmail`, `recipientPhone`,
  `siteLabel`, `siteAddress`, `acceptedByName`, `acceptanceNote`, `acceptedIp`, `acceptedUserAgent`,
  `declineReason`, `reversalNote` and `internalNote` on the customer's quotes (and in 3b revokes
  their links). The money, the lines, the wording and the content hash stay. The privacy guard test
  is extended so every new quote column must be classified as scrubbed or kept, with a reason. The
  customer data **export** includes the customer's quotes.
- Terms and numbers are frozen at issue, so changing the wording or the catalogue later never
  changes an issued quote.

## Phase 3b: the private client link

- Each issued quote gets a link on the client portal address: `portal.acegardens.co.za/q/<code>`.
  The code is 256 bits of randomness, one per quote, covering that one quote. It is stored as
  issued (so staff can copy it again later; it is a bearer secret like a shared-file link). Staff can
  revoke it and create a new one.
- The page shows the quote document. It tells the client plainly when the quote has expired, been
  replaced (with a button to the new one), been withdrawn, or already answered.
- **Accept:** tick the optional add-ons wanted, type a full name, choose a start date (today or
  later), tick "I accept this quotation and the terms", press Accept. **Decline** takes an optional
  reason. Then a confirmation and a PDF of the accepted quote.
- Recorded as proof: time, typed name, add-ons chosen, start date, IP address, browser, and the
  quote's content hash. Pressing Accept twice records one acceptance (the status change is a
  conditional update). Acceptance by the client runs the same activation and agreement rules as
  staff acceptance, recorded with a client actor type.
- Wrong, expired and revoked codes all return the same "not found" page. Requests are rate limited,
  the page is not indexed, uses no-store caching and `Referrer-Policy: no-referrer`, and no personal
  data from other customers can be reached from it. Opening the page records only `firstViewedAt`
  and `lastViewedAt` (no IP).
- No email or push alert: an accepted quote appears as **Accepted** in the Quotes list.

## Testing

- **Unit tests:** money totals (monthly, once-off, with options), line and issue validation, status
  rules, reference formatting and expiry, the wording schema, the PDF content mapping.
- **Database tests** (`npm run test:db`, rolled-back transactions, dev database only): every
  function refuses crew; create, save draft (version conflict), issue, number allocation (two
  issues at once never share a number, a new year restarts at 1), revise and replace, withdraw,
  decline, accept (add-ons, start date, lead activation, paused customer flagged, agreement rule),
  reverse, delete draft, a save that changes nothing writes nothing, audit lines contain no personal
  values, anonymise scrubs every personal quote column, the extended privacy guard, and the database
  protections (RLS on, public roles revoked, check constraints).
- **Real browser, phone width:** build and issue a quote on a phone, quick add, revise, accept,
  download the PDF, owner reversal, crew cannot reach anything. For 3b also: the client link
  (valid, expired, replaced, revoked, wrong code), accept and decline, double click on Accept, no
  data in the page for a wrong code, and the response headers.

## Risks and notes for the owner

- A typed name with a tick is a normal way to accept online, and the proof recorded above is strong
  for a garden-service agreement. The terms themselves (liability, notice, fees) are the owner's
  and are used as written; a one-time legal read of them is sensible but not something the software
  can do.
- The "Every visit on record" promises (GPS clock-in, before and after photos, emailed service
  reports) are only true once Module 6 and later are built. They are editable and can be switched off.

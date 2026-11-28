# Module 5: Invoices, payments and statements

Status: Stage 5a (staff side) implemented, browser check pending (branch module-5-invoices). Stage 5b (portal) not started. Design approved by the owner in three parts (2026-11-27).

## Goal

ACE can bill clients by EFT: a monthly run on the 20th drafts one invoice per active monthly client for the owner to review and issue; once-off invoices are made on demand; payments are recorded and allocated; statements show what is owed. Clients (stage 5b) see their invoices and statements in the portal and can tell ACE "I have paid".

## Decisions (made with the owner)

1. **Pre or Post billing** is a switch on each customer (default **Pre** for every new customer). A complex managed by an agency uses its own setting.
2. **The 20th run.** A manager presses "Create this month's invoices" (normally on the 20th). For a run in month M:
   - **Pre** clients: service month M+1, due the **last day of M**.
   - **Post** clients: service month M, due the **25th of M**.
3. **Review before sending.** The run only creates **drafts**. The owner or manager reviews, edits, skips and issues them. A fully automatic run is NOT built now; the run is a single idempotent function so a later on/off switch can call it.
4. **Agencies.** Each complex gets its own invoice (own number and amount), addressed to its bill-to customer (the agency when "Bills go to" the agency is on, else the complex itself). The agency gets all invoices of one issue in one email and one combined statement with a breakdown per complex.
5. **Payments.** EFT only. Staff record payments (date, amount, reference, note), full or part, and allocate them to invoices (oldest first by default). The payment reference printed on invoices and statements is the **bill-to customer's number** (for example C-0123), so one EFT from an agency can cover many invoices.
6. **Proof of payment** (stage 5b): in the portal a client presses **I have paid** on an invoice and adds the date and their bank reference (no file). Staff match it to the bank statement and confirm or dismiss it. Staff can also record any payment without a client report.
7. **Part months.** The first month of a new agreement is pre-filled as a pro-rata amount by days from the accepted start date; the owner can edit it.
8. **Once-off work** is invoiced on demand with "New invoice" on a customer, pre-filled from an accepted once-off quote or typed as free lines. Default due date is issue date plus 14 days (a setting), editable per invoice. Once-off invoices are not part of the run.
9. **Late fee.** When the run drafts an invoice for a client who has an issued invoice that is overdue and has no late fee charged against it yet, the draft includes a suggested **R100 "Late payment fee"** line per such invoice (amount from settings). The owner can delete it before issuing.
10. **Statements** are produced on demand (staff, and in 5b the paying party in the portal) with opening balance, invoices, payments and closing balance, as a PDF too. They are not emailed automatically.
11. **Delivery.** Issued invoices are emailed to the bill-to customer's contacts who receive invoices, with the PDF attached, and are visible in the portal (5b). A failed or unconfigured email never undoes an issue.

## Stages

- **5a (staff side):** the Pre or Post switch, the owner-only invoice settings (bank details, defaults), the run, draft review, issue, PDF and email, once-off invoices, payments and allocations, voiding, "reported payments" screen (the table exists in 5a, the portal button arrives in 5b), statements.
- **5b (portal):** invoices list and PDFs, statements for the paying party, the I have paid button, the exact new database permissions for the portal role.

## Out of scope

A fully automatic run switch; card payments; credit notes beyond void-and-reissue; a bulk price-change tool (the March escalation is handled by revising the accepted quote or editing draft amounts); file uploads for proof of payment; emailing statements automatically; VAT (ACE is not VAT registered, printed on every invoice and statement).

## Data model (hand-written migration per stage, applied only after the owner approves)

- **customers:** `billingTiming` enum `PRE | POST`, not null, default `PRE`.
- **invoice_settings** (singleton, owner-edited): `bankName`, `accountHolder`, `accountNumber`, `branchCode`, `accountType`, `onceOffDueDays` (default 14), `lateFeeCents` (default 10000), `updatedAt`, `updatedById`.
- **invoice_counters:** `year` (primary key), `lastSeq` (the number counter, taken with one atomic statement per year as quotes do).
- **invoices:**
  - `id`, `customerId` (the client the work is for), `billToCustomerId` (the payer), `kind` (`MONTHLY | ONCE_OFF`), `serviceMonth` (date, first of the month, null for once-off), `status` (`DRAFT | ISSUED | VOID`), `numberYear`, `numberSeq` (null while draft; reference `INV-<year>-<4 digit seq>`), `dueDate`, `issuedAt`, `issuedById`, `createdAt`, `createdById`, `draftVersion`, `sourceQuoteId` (null), `totalCents` (set at issue; the sum of line amounts), `recipientName`, `recipientAddress` (frozen at issue, personal data), `bankSnapshot` (json, frozen at issue), `contentHash`, `emailStatus` (`NONE | SENT | FAILED`), `emailedAt`, `voidedAt`, `voidReason`, `voidedById`.
  - Unique `(numberYear, numberSeq)`. A **partial unique index** on `(customerId, serviceMonth)` where `kind = 'MONTHLY'` and `status <> 'VOID'` makes the run idempotent.
  - CHECK: a non-draft invoice has a number, due date, issue date and total; `billToCustomerId` is set.
- **invoice_lines:** `id`, `invoiceId`, `sortOrder`, `propertyId` (null), `kind` (`SERVICE | OPTIONAL | LATE_FEE | ADJUSTMENT | ONCE_OFF`), `description`, `amountCents` (non-zero integer; negative allowed only for `ADJUSTMENT`), `sourceQuoteLineId` (null), `forInvoiceId` (null; the overdue invoice a late fee is charged against).
- **payments:** `id`, `payerCustomerId`, `receivedOn` (date), `amountCents` (> 0), `reference`, `note`, `recordedById`, `createdAt`, `voidedAt`, `voidReason`, `voidedById`.
- **payment_allocations:** `id`, `paymentId`, `invoiceId`, `amountCents` (> 0); unique `(paymentId, invoiceId)`.
- **payment_reports** (5a creates the table, 5b writes it): `id`, `invoiceId`, `reportedByContactId`, `paidOn` (date), `reference` (typed text, personal), `status` (`WAITING | CONFIRMED | DISMISSED`), `createdAt`, `resolvedAt`, `resolvedById`.
- All new tables: Row Level Security on and rights revoked from `anon` and `authenticated`, as in earlier migrations. The portal role's grants for 5b are written in the 5b migration and frozen by the exact-privileges test.

## Behaviour and rules

- **Money:** whole cents; no VAT; "ACE Garden Services is not VAT registered, no VAT is charged." printed.
- **Status shown:** Draft, Unpaid, Part paid, Paid, Overdue, Void. Only Draft, Issued and Void are stored. Balance = `totalCents` minus the sum of allocations from payments that are not voided. Overdue = Issued, balance above zero, due date before today in South African time.
- **The run** (`createMonthlyDrafts(store, actor, runMonth)`): for every ACTIVE customer that has at least one property agreement (an accepted monthly quote with `agreementEndedAt` null), whose agreement has started by the end of the service month, and that has no non-void monthly invoice for that service month: create a draft. Lines: one per priced monthly quote line and per chosen optional monthly quote line, labelled with the property; first-month pro-rata by days when the accepted start date is inside the service month after the 1st (rounded to the cent); plus the late-fee suggestion lines. Bill-to is the customer's agency when `managedById` is set and `billsToManager` is on, else the customer. Due date by the customer's Pre or Post setting. Returns counts (created, skipped with reasons). Paused, archived, anonymised and lead customers are skipped.
- **Draft review:** edit lines (description, amount, add or remove), due date, skip (delete) a draft; guarded by `draftVersion`. Issuing allocates the number, freezes recipient, address, bank details and total, writes `contentHash`, and writes the audit line; then the emails go out after the commit (try and catch per invoice, a fixed phrase in the log, audit `invoice.emailed` or `invoice.email_failed`). "Issue all drafts" issues each in its own transaction so one failure does not block the rest.
- **Once-off invoices:** `createOnceOffDraft(customerId, fromQuoteId?)` pre-fills from an accepted quote's priced once-off lines and chosen once-off options.
- **Void:** an unpaid issued invoice can be voided with a reason; one with allocations is refused until its payments are un-allocated or voided. If an invoice carrying a late-fee line is voided, that fee no longer counts as charged against the overdue invoice, so the next run may suggest it again.
- **Payments:** `recordPayment` (payer, date, amount, reference, note, allocations), `allocate`, `unallocate`, `voidPayment`. An allocation must be for an issued invoice whose bill-to is the payer, at most the payment's unallocated amount and at most the invoice's balance; unallocated money is a credit on the statement. Lock order: involved customers by id, then invoices by id, then the payment.
- **Reported payments (stage 5b writes them):** staff see "Waiting" reports on an invoice and a list; **Confirm** opens the record-payment form pre-filled; **Dismiss** closes the report.
- **Statement:** for a bill-to customer and a period: opening balance, invoices (with the complex named for an agency), payments, allocations, credit on account and closing balance. Opening balance and closing balance are derived, never stored.
- **Anonymise:** financial records are kept (numbers, dates, amounts, totals, allocations) but `recipientName`, `recipientAddress`, payment `reference` and `note` and report `reference` are scrubbed; the privacy-coverage test classifies every new column; the data export includes the customer's invoices and payments (without scrubbed fields).
- **Audit:** fixed words, ids and counts only (never names, addresses, references, amounts typed by a client, email addresses).

## Staff screens (staff app, owner and manager only; crew never)

- **Customer page:** a **Billing timing** switch (Pre or Post) and an **Invoices** tab (invoices, balance, record payment).
- **Invoices** (main menu): the run button with a month selector, the draft list with warnings (no email on file, first month, late-fee suggestion, bill-to agency), invoice view and edit, issue and issue-all, void, resend email, PDF download.
- **Payments:** record payment, allocate, void; **Reported payments** list (5a screen, empty until 5b).
- **Statements:** per bill-to customer, period selector, PDF.
- **Settings (owner only):** invoice settings (bank details, due days, late fee amount). Changes apply to invoices issued afterwards; issued invoices keep the bank details frozen at issue.

## Technical design

- **Core** (`packages/core/src/invoices/`): pure maths (`dates.ts`: run month, service month, due dates, pro-rata; `money.ts` totals and balances), `settings.ts`, `drafts.ts`, `run.ts`, `issue.ts`, `payments.ts`, `statements.ts`, `document.ts` (the PDF content as plain data like quotes), `activity.ts`, and email templates in `portal/email` (or a sibling `email` folder): the invoice email with attachments.
- **Email:** `sendEmail` gains optional attachments (Resend's attachments field, base64) with size limits; templates remain fixed-subject and non-personal ("Your ACE invoice" or "Your ACE invoices").
- **PDF and screen:** the invoice document component and PDF layout live in `@ace/ui` like the quote ones; the staff app renders the PDF route and builds the email attachments.
- **Barrels:** staff functions with `assertRole` are exported from `@ace/core`; nothing role-less is exported.
- **Stage 5b:** portal functions in `packages/core/src/portal/` using the signed-in scope (no staff Actor), explicit selects, and the exact column grants for `ace_portal` listed in that stage's migration; pages under `apps/portal` with the same headers and session rules as Module 4.

## Privacy and security

- Every staff page, action and route starts with the staff sign-in check; invoices and payments are visible only to owner and manager (crew never).
- In 5b a person sees only invoices whose customer is in their live scope; the statement and "I have paid" are limited to the paying party (the bill-to customer's own contacts), so a complex's trustees see their complex's invoices and status but never an agency's statement.
- The same-not-found rule applies to any invoice id outside the scope.
- Bank details are printed on invoices by design (not secret) and are edited only by the owner; they are frozen on each issued invoice.
- Emails carry invoices only to the bill-to contacts on file and contain no secrets or links with secrets.

## Testing

- **Unit:** run and due-date maths (Pre and Post, year ends, 28 to 31 day months), pro-rata rounding, totals, balances and overdue status, statement maths, invoice number formatting.
- **Database (dev database, rolled-back transactions; keep each test to at most two issued quotes because issuing a quote is slow):** the run (Pre and Post dates, idempotent re-run, skipped customers, agency bill-to, pro-rata, optional lines, late-fee suggestion once per overdue invoice), draft edit guard, issue (number, freeze, contentHash, due date), void rules, payments and allocations (limits, credit on account, void payment), statements (single customer and agency with complexes), anonymise and export, privacy-coverage classification, the partial unique index, and lock order.
- **Real browser:** staff set a client to Post, run the month, edit a draft, issue and see the email in the dev log, record and allocate a payment, void, open a statement and the PDF; phone width; in 5b the portal views and the I have paid flow, and one real run through the actual `ace_portal` login (with the owner's approval).

## Known limitations and go-live

- **Go-live:** enter the bank details in settings before the first run; Resend and the portal address checklist from Module 4 still apply.
- Annual price escalation is manual (revise the quote or edit the drafts).
- Only void-and-reissue corrects an issued invoice; there are no credit notes.
- The run does not account for a client who paused mid-month; the owner reviews the drafts.
- Statements are on demand only; unallocated payments are a credit shown on the statement but are not refunded or applied automatically.

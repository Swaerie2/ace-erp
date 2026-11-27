# Company profile addendum: logo and company details on every document

Status: owner request 2026-11-27, during Module 5a (branch `module-5-invoices`). Added to the Module 5 invoices work because the documents are built there.

## What the owner asked for
"In settings, add a logo which then pulls through to all the documents along with relevant information of the company."

## Decisions taken on the owner's behalf (to be reported at hand-over)
1. **One new owner-only settings page, "Company profile"** (`/settings/company`): upload, replace and remove the logo; edit the company's physical address. It also SHOWS the company details that already exist (legal name, trading name, registration number, phone, email, website) read-only, with a link to Quote wording, where the four contact details are edited today. They are not moved, so the quote wording screen, its tests and the frozen quote wording are untouched.
2. **Logo storage:** a new one-row table `company_logo` (image bytes, content type, updated time), kept apart from `organisation_settings` so the bytes are never read by accident. PNG or JPEG only (what the PDF library can draw), at most 500 KB, checked by the file's own first bytes (not the file name), sane pixel size. No SVG (scripts, and the PDF library cannot draw it).
3. **The logo is read live, not frozen.** An old invoice reprinted after the logo changes shows the new logo. The company details and bank details stay frozen on the invoice as before (the address is added to that frozen copy, so an invoice issued before the address was entered simply has none).
4. **Where it appears:** invoice and statement PDFs and on-screen views, quote PDFs and on-screen views (staff screens, the portal quote pages and the private quote link), and the company address in the header block of each. Emails stay plain text (no images in email).
5. **The portal's database login** gets a column-level read on the logo table only (same pattern as every other portal grant), because quote PDFs are made by the portal app for clients. The frozen `EXPECTED_PORTAL_GRANTS` catalogue test is updated with exactly that one addition and nothing else.
6. **Logo route:** `GET /company-logo` in the staff app (signed-in staff) and in the portal app (public and cacheable: a logo is not secret and the private quote link has no sign-in), `Cache-Control` with a `?v=<updated time>` cache buster, `Content-Type` from the stored type, `X-Content-Type-Options: nosniff`.
7. **Audit:** `company.logo_set`, `company.logo_removed`, `company.address_changed` with fixed words only (changed field names, never the address text).
8. The migration needs the owner's explicit yes before it is applied to the database (same gate as Task 2).

## Tasks (executed after Task 12, in this order)
- **Task 18:** schema, migration SQL (NOT applied), portal grant, frozen catalogue test. Then the controller asks the owner and applies it.
- **Task 19:** core: logo inspection and storage functions, address settings, address in the frozen snapshots (invoice and quote wording), documents carry the address and a logo URL, PDFs take the logo bytes.
- **Task 20:** apps: `/settings/company`, the two logo routes, the PDF routes and screens pass the logo through, the menu link, docs.

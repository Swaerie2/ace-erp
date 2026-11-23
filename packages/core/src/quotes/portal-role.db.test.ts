import { describe, expect, it } from "vitest";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { hashIp } from "./bots";
import {
  acceptViaLink,
  checkRateLimit,
  declineViaLink,
  getPublicQuote,
  recordLinkView,
} from "./public";
import { addDays, todaySA } from "./reference";
import { findQuote } from "./store";
import { makeIssued, monthlyLine, optionalLine } from "./test-helpers";

type Tx = Parameters<Parameters<typeof withRollback>[0]>[0];
const AS_PORTAL = `SET LOCAL ROLE "ace_portal"`;
const start = () => addDays(todaySA(), 4);
const ctx = { ip: "203.0.113.20", userAgent: "Test Browser" };

async function privilege(tx: Tx, sql: string): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ ok: boolean }[]>(`select (${sql}) as ok`);
  return rows[0]?.ok === true;
}
const column = (table: string, col: string, priv: "SELECT" | "UPDATE" | "INSERT") =>
  `has_column_privilege('ace_portal', '${table}', '${col}', '${priv}')`;
const tablePriv = (table: string, priv: string) =>
  `has_table_privilege('ace_portal', '${table}', '${priv}')`;

/**
 * Every privilege the role holds directly, read from the catalogue, as sorted text such as
 * `public.quotes.validUntil:UPDATE` (a column grant), `public.quote_lines:SELECT` (a table grant) or
 * `schema public:USAGE`. Covers all schemas and every kind of relation (tables, views, sequences),
 * schemas and functions, so a grant widened anywhere shows up.
 */
async function grantsOfPortal(tx: Tx): Promise<string[]> {
  const rows = await tx.$queryRawUnsafe<{ p: string }[]>(`
    select n.nspname || '.' || c.relname || ':' || a.privilege_type as p
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where a.grantee = 'ace_portal'::regrole::oid
    union all
    select n.nspname || '.' || c.relname || '.' || att.attname || ':' || a.privilege_type
      from pg_attribute att
      join pg_class c on c.oid = att.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(att.attacl) a
     where a.grantee = 'ace_portal'::regrole::oid
    union all
    select 'schema ' || n.nspname || ':' || a.privilege_type
      from pg_namespace n
      cross join lateral aclexplode(n.nspacl) a
     where a.grantee = 'ace_portal'::regrole::oid
    union all
    select 'function ' || n.nspname || '.' || f.proname || ':' || a.privilege_type
      from pg_proc f
      join pg_namespace n on n.oid = f.pronamespace
      cross join lateral aclexplode(f.proacl) a
     where a.grantee = 'ace_portal'::regrole::oid
  `);
  return rows.map((r) => r.p).sort();
}

// Checked by eye against migrations/20261121120000_client_link and 20261123120000_client_portal: exactly
// what they grant, no more. Sorted with the default JavaScript sort.
const EXPECTED_PORTAL_GRANTS: string[] = [
  "public.audit_log.id:SELECT",
  "public.audit_log:INSERT",
  "public.contacts.customerId:SELECT",
  "public.contacts.email:SELECT",
  "public.contacts.id:SELECT",
  "public.contacts.lastSignedInAt:SELECT",
  "public.contacts.lastSignedInAt:UPDATE",
  "public.contacts.name:SELECT",
  "public.contacts.name:UPDATE",
  "public.contacts.phone:SELECT",
  "public.contacts.phone:UPDATE",
  "public.contacts.portalAccess:SELECT",
  "public.contacts.portalAccess:UPDATE",
  "public.contacts.portalInvitedAt:SELECT",
  "public.contacts.portalInvitedAt:UPDATE",
  "public.contacts.portalWelcomedAt:SELECT",
  "public.contacts.portalWelcomedAt:UPDATE",
  "public.contacts.receivesQuotes:SELECT",
  "public.contacts.role:SELECT",
  "public.contacts.updatedAt:UPDATE",
  "public.customers.anonymisedAt:SELECT",
  "public.customers.archivedAt:SELECT",
  "public.customers.billingCity:SELECT",
  "public.customers.billingCity:UPDATE",
  "public.customers.billingLine1:SELECT",
  "public.customers.billingLine1:UPDATE",
  "public.customers.billingLine2:SELECT",
  "public.customers.billingLine2:UPDATE",
  "public.customers.billingPostalCode:SELECT",
  "public.customers.billingPostalCode:UPDATE",
  "public.customers.billingSuburb:SELECT",
  "public.customers.billingSuburb:UPDATE",
  "public.customers.billsToManager:SELECT",
  "public.customers.companyName:SELECT",
  "public.customers.consentAt:SELECT",
  "public.customers.consentAt:UPDATE",
  "public.customers.consentNote:UPDATE",
  "public.customers.consentSource:SELECT",
  "public.customers.consentSource:UPDATE",
  "public.customers.displayName:SELECT",
  "public.customers.id:SELECT",
  "public.customers.managedById:SELECT",
  "public.customers.status:SELECT",
  "public.customers.status:UPDATE",
  "public.customers.type:SELECT",
  "public.customers.updatedAt:UPDATE",
  "public.portal_codes:DELETE",
  "public.portal_codes:INSERT",
  "public.portal_codes:SELECT",
  "public.portal_codes:UPDATE",
  "public.portal_sessions:DELETE",
  "public.portal_sessions:INSERT",
  "public.portal_sessions:SELECT",
  "public.portal_sessions:UPDATE",
  "public.properties.addressLine1:SELECT",
  "public.properties.addressLine2:SELECT",
  "public.properties.archivedAt:SELECT",
  "public.properties.city:SELECT",
  "public.properties.customerId:SELECT",
  "public.properties.id:SELECT",
  "public.properties.label:SELECT",
  "public.properties.postalCode:SELECT",
  "public.properties.suburb:SELECT",
  "public.properties.updatedAt:UPDATE",
  "public.public_link_hits:DELETE",
  "public.public_link_hits:INSERT",
  "public.public_link_hits:SELECT",
  "public.public_link_hits:UPDATE",
  "public.quote_lines.chosen:UPDATE",
  "public.quote_lines:SELECT",
  "public.quote_scope_items:SELECT",
  "public.quotes.acceptanceNote:UPDATE",
  "public.quotes.acceptedAt:SELECT",
  "public.quotes.acceptedAt:UPDATE",
  "public.quotes.acceptedByContactId:UPDATE",
  "public.quotes.acceptedByName:SELECT",
  "public.quotes.acceptedByName:UPDATE",
  "public.quotes.acceptedByStaffId:UPDATE",
  "public.quotes.acceptedIp:UPDATE",
  "public.quotes.acceptedMethod:SELECT",
  "public.quotes.acceptedMethod:UPDATE",
  "public.quotes.acceptedStartDate:SELECT",
  "public.quotes.acceptedStartDate:UPDATE",
  "public.quotes.acceptedUserAgent:UPDATE",
  "public.quotes.agreementEndedAt:SELECT",
  "public.quotes.agreementEndedAt:UPDATE",
  "public.quotes.agreementReplacedById:SELECT",
  "public.quotes.agreementReplacedById:UPDATE",
  "public.quotes.contentHash:SELECT",
  "public.quotes.customerId:SELECT",
  "public.quotes.declineReason:SELECT",
  "public.quotes.declineReason:UPDATE",
  "public.quotes.declinedAt:SELECT",
  "public.quotes.declinedAt:UPDATE",
  "public.quotes.declinedByClient:SELECT",
  "public.quotes.declinedByClient:UPDATE",
  "public.quotes.firstViewedAt:SELECT",
  "public.quotes.firstViewedAt:UPDATE",
  "public.quotes.id:SELECT",
  "public.quotes.issuedAt:SELECT",
  "public.quotes.lastViewedAt:SELECT",
  "public.quotes.lastViewedAt:UPDATE",
  "public.quotes.linkToken:SELECT",
  "public.quotes.numberSeq:SELECT",
  "public.quotes.numberYear:SELECT",
  "public.quotes.propertyId:SELECT",
  "public.quotes.recipientName:SELECT",
  "public.quotes.revision:SELECT",
  "public.quotes.revisionOfId:SELECT",
  "public.quotes.siteAddress:SELECT",
  "public.quotes.siteLabel:SELECT",
  "public.quotes.status:SELECT",
  "public.quotes.status:UPDATE",
  "public.quotes.updatedAt:UPDATE",
  "public.quotes.validUntil:SELECT",
  "public.quotes.withdrawnAt:SELECT",
  "public.quotes.wordingSnapshot:SELECT",
  "schema public:USAGE",
];

describe.skipIf(!dbTestsEnabled)("the ace_portal role: exact privileges", () => {
  it("holds exactly the privileges the two portal migrations grant, and nothing else", async () => {
    await withRollback(async (tx) => {
      expect(await grantsOfPortal(tx)).toEqual(EXPECTED_PORTAL_GRANTS);
    });
  });

  it("is a role that cannot log in", async () => {
    await withRollback(async (tx) => {
      const rows = await tx.$queryRaw<
        { rolcanlogin: boolean }[]
      >`select rolcanlogin from pg_roles where rolname = 'ace_portal'`;
      expect(rows[0]?.rolcanlogin).toBe(false);
    });
  });

  it("can read only the granted quote columns and change only the granted ones", async () => {
    await withRollback(async (tx) => {
      const readable = [
        "id",
        "customerId",
        "propertyId",
        "status",
        "numberYear",
        "numberSeq",
        "revision",
        "revisionOfId",
        "validUntil",
        "issuedAt",
        "recipientName",
        "siteLabel",
        "siteAddress",
        "wordingSnapshot",
        "contentHash",
        "acceptedAt",
        "acceptedMethod",
        "acceptedByName",
        "acceptedStartDate",
        "declinedAt",
        "declineReason",
        "declinedByClient",
        "withdrawnAt",
        "agreementEndedAt",
        "agreementReplacedById",
        "linkToken",
        "firstViewedAt",
        "lastViewedAt",
      ];
      const hidden = [
        "internalNote",
        "reversalNote",
        "createdById",
        "issuedById",
        "acceptedByStaffId",
        "sentAt",
        "sentMethod",
        "draftVersion",
        "recipientEmail",
        "recipientPhone",
        "acceptanceNote",
        "acceptedIp",
        "acceptedUserAgent",
        "reversedAt",
        "acceptedByContactId",
      ];
      const writable = [
        "status",
        "acceptedAt",
        "acceptedMethod",
        "acceptedByName",
        "acceptedStartDate",
        "acceptanceNote",
        "acceptedByStaffId",
        "acceptedIp",
        "acceptedUserAgent",
        "declinedAt",
        "declineReason",
        "declinedByClient",
        "acceptedByContactId",
        "agreementEndedAt",
        "agreementReplacedById",
        "firstViewedAt",
        "lastViewedAt",
        "updatedAt",
      ];
      const notWritable = [
        "internalNote",
        "recipientName",
        "recipientEmail",
        "recipientPhone",
        "siteAddress",
        "wordingSnapshot",
        "contentHash",
        "linkToken",
        "numberSeq",
        "customerId",
        "revision",
      ];
      for (const c of readable) {
        expect(await privilege(tx, column("quotes", c, "SELECT")), `select ${c}`).toBe(true);
      }
      for (const c of hidden) {
        expect(await privilege(tx, column("quotes", c, "SELECT")), `select ${c}`).toBe(false);
      }
      for (const c of writable) {
        expect(await privilege(tx, column("quotes", c, "UPDATE")), `update ${c}`).toBe(true);
      }
      for (const c of notWritable) {
        expect(await privilege(tx, column("quotes", c, "UPDATE")), `update ${c}`).toBe(false);
      }
      expect(await privilege(tx, tablePriv("quotes", "INSERT"))).toBe(false);
      expect(await privilege(tx, tablePriv("quotes", "DELETE"))).toBe(false);
    });
  });

  it("has no access to anything else it does not need", async () => {
    await withRollback(async (tx) => {
      for (const table of [
        "staff_users",
        "services",
        "quote_wording",
        "quote_counters",
        "organisation_settings",
      ]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(tx, tablePriv(table, p)), `${p} on ${table}`).toBe(false);
        }
      }
      // contacts: column grants only; no whole-table rights, no insert or delete
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await privilege(tx, tablePriv("contacts", p)), `${p} on contacts`).toBe(false);
      }
      for (const c of [
        "id",
        "customerId",
        "name",
        "role",
        "email",
        "phone",
        "receivesQuotes",
        "portalAccess",
        "portalInvitedAt",
        "portalWelcomedAt",
        "lastSignedInAt",
      ]) {
        expect(await privilege(tx, column("contacts", c, "SELECT")), `select contacts.${c}`).toBe(
          true,
        );
      }
      for (const c of ["receivesInvoices", "createdAt"]) {
        expect(await privilege(tx, column("contacts", c, "SELECT")), `select contacts.${c}`).toBe(
          false,
        );
      }
      for (const c of [
        "name",
        "phone",
        "portalAccess",
        "portalInvitedAt",
        "portalWelcomedAt",
        "lastSignedInAt",
        "updatedAt",
      ]) {
        expect(await privilege(tx, column("contacts", c, "UPDATE")), `update contacts.${c}`).toBe(
          true,
        );
      }
      for (const c of ["email", "role", "customerId", "receivesQuotes", "receivesInvoices"]) {
        expect(await privilege(tx, column("contacts", c, "UPDATE")), `update contacts.${c}`).toBe(
          false,
        );
      }
      // customers
      for (const c of [
        "id",
        "status",
        "anonymisedAt",
        "displayName",
        "type",
        "companyName",
        "archivedAt",
        "billingLine1",
        "billingPostalCode",
        "consentAt",
        "consentSource",
        "managedById",
        "billsToManager",
      ]) {
        expect(await privilege(tx, column("customers", c, "SELECT")), `select customers.${c}`).toBe(
          true,
        );
      }
      for (const c of [
        "notes",
        "number",
        "registrationNumber",
        "sourceNote",
        "consentNote",
        "createdById",
      ]) {
        expect(await privilege(tx, column("customers", c, "SELECT")), `select customers.${c}`).toBe(
          false,
        );
      }
      for (const c of [
        "status",
        "updatedAt",
        "billingLine1",
        "billingLine2",
        "billingSuburb",
        "billingCity",
        "billingPostalCode",
        "consentAt",
        "consentSource",
        "consentNote",
      ]) {
        expect(await privilege(tx, column("customers", c, "UPDATE")), `update customers.${c}`).toBe(
          true,
        );
      }
      for (const c of [
        "displayName",
        "companyName",
        "notes",
        "type",
        "managedById",
        "billsToManager",
        "anonymisedAt",
        "archivedAt",
      ]) {
        expect(await privilege(tx, column("customers", c, "UPDATE")), `update customers.${c}`).toBe(
          false,
        );
      }
      // properties: the address is readable, the access notes are not, nothing but the lock column is writable
      for (const c of [
        "id",
        "customerId",
        "archivedAt",
        "label",
        "addressLine1",
        "addressLine2",
        "suburb",
        "city",
        "postalCode",
      ]) {
        expect(
          await privilege(tx, column("properties", c, "SELECT")),
          `select properties.${c}`,
        ).toBe(true);
      }
      for (const c of ["accessNotes", "mapUrl", "terrainNotes", "lawnSizeSqm"]) {
        expect(
          await privilege(tx, column("properties", c, "SELECT")),
          `select properties.${c}`,
        ).toBe(false);
      }
      expect(await privilege(tx, column("properties", "updatedAt", "UPDATE"))).toBe(true);
      for (const c of ["label", "addressLine1", "accessNotes"]) {
        expect(
          await privilege(tx, column("properties", c, "UPDATE")),
          `update properties.${c}`,
        ).toBe(false);
      }
      // audit log: insert plus read of the id only
      expect(await privilege(tx, tablePriv("audit_log", "INSERT"))).toBe(true);
      expect(await privilege(tx, column("audit_log", "id", "SELECT"))).toBe(true);
      for (const c of ["after", "before", "actorId", "ip", "userAgent"]) {
        expect(await privilege(tx, column("audit_log", c, "SELECT")), `select audit_log.${c}`).toBe(
          false,
        );
      }
      expect(await privilege(tx, tablePriv("audit_log", "UPDATE"))).toBe(false);
      expect(await privilege(tx, tablePriv("audit_log", "DELETE"))).toBe(false);
      // quote lines and scope items
      expect(await privilege(tx, tablePriv("quote_lines", "SELECT"))).toBe(true);
      expect(await privilege(tx, column("quote_lines", "chosen", "UPDATE"))).toBe(true);
      expect(await privilege(tx, column("quote_lines", "amountCents", "UPDATE"))).toBe(false);
      expect(await privilege(tx, tablePriv("quote_lines", "INSERT"))).toBe(false);
      expect(await privilege(tx, tablePriv("quote_scope_items", "SELECT"))).toBe(true);
      expect(await privilege(tx, tablePriv("quote_scope_items", "UPDATE"))).toBe(false);
      // the rate-limit table and the two sign-in tables
      for (const table of ["public_link_hits", "portal_codes", "portal_sessions"]) {
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          expect(await privilege(tx, tablePriv(table, p)), `${p} on ${table}`).toBe(true);
        }
      }
    });
  });
});

describe.skipIf(!dbTestsEnabled)("the ace_portal role: refused statements", () => {
  const refused: [string, string][] = [
    ["reading every contact column", `select * from contacts limit 1`],
    ["reading staff users", `select * from staff_users limit 1`],
    ["reading a customer's internal notes", `select "notes" from customers limit 1`],
    ["reading a property's access notes", `select "accessNotes" from properties limit 1`],
    ["reading the internal note", `select "internalNote" from quotes limit 1`],
    ["reading the audit details", `select "after" from audit_log limit 1`],
    ["changing a customer's name", `update customers set "displayName" = 'x'`],
    ["changing who manages a customer", `update customers set "managedById" = null`],
    ["changing a contact's email", `update contacts set "email" = 'x@example.com'`],
    ["changing a property's access notes", `update properties set "accessNotes" = 'x'`],
    [
      "adding a contact",
      `insert into contacts ("id", "customerId", "name", "updatedAt") values (gen_random_uuid(), gen_random_uuid(), 'x', now())`,
    ],
    ["deleting contacts", `delete from contacts`],
    ["deleting quotes", `delete from quotes`],
    ["deleting audit lines", `delete from audit_log`],
    ["reading the wording table", `select * from quote_wording limit 1`],
  ];
  for (const [label, sql] of refused) {
    it(`refuses ${label}`, async () => {
      await expect(
        withRollback(async (tx) => {
          await tx.$executeRawUnsafe(AS_PORTAL);
          await tx.$queryRawUnsafe(sql);
        }),
      ).rejects.toThrow(
        /permission denied for (table|column|relation)|violates row-level security/i,
      );
    });
  }
});

describe.skipIf(!dbTestsEnabled)("the public functions run as ace_portal", () => {
  it("shows a quote, records a view, accepts, and keeps the audit and the rate limiter working", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, {
        status: "LEAD",
        draft: { lines: [monthlyLine(), optionalLine()] },
      });
      const row = await findQuote(tx, q.id);
      const token = row.linkToken ?? "";
      const optionId = row.lines[1]?.id ?? "";
      expect(optionId).toBeTruthy();

      await tx.$executeRawUnsafe(AS_PORTAL);
      const view = await getPublicQuote(tx, token);
      expect(view.found && view.state).toBe("OPEN");
      await recordLinkView(tx, token);
      expect((await checkRateLimit(tx, "view", hashIp("198.51.100.50"))).allowed).toBe(true);
      const result = await acceptViaLink(
        tx,
        token,
        { acceptedBy: "A. Client", startDate: start(), chosenLineIds: [optionId] },
        ctx,
      );
      expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null });
      // The accepted-state read (who accepted, the start date, the chosen add-on) also works as the role.
      const accepted = await getPublicQuote(tx, token);
      expect(accepted.found && accepted.state).toBe("ACCEPTED");
      expect(accepted.found && accepted.acceptance?.name).toBe("A. Client");
      expect(accepted.found && accepted.acceptance?.startDate).toBeTruthy();
      expect(accepted.found && accepted.acceptance?.chosen).toHaveLength(1);
      await tx.$executeRawUnsafe(`RESET ROLE`);

      const after = await findQuote(tx, q.id);
      expect(after).toMatchObject({ status: "ACCEPTED", acceptedMethod: "CLIENT_LINK" });
      expect(after.firstViewedAt).toBeInstanceOf(Date);
      expect(after.lines.map((l) => l.chosen)).toEqual([false, true]);
      expect((await tx.customer.findUniqueOrThrow({ where: { id: q.customerId } })).status).toBe(
        "ACTIVE",
      );
      expect(
        await tx.auditLog.count({
          where: { entityId: q.id, action: "quote.accepted", actorType: "CUSTOMER" },
        }),
      ).toBe(1);
    });
  });

  it("declines and answers unknown codes as the role", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const token = (await findQuote(tx, q.id)).linkToken ?? "";
      await tx.$executeRawUnsafe(AS_PORTAL);
      expect(await getPublicQuote(tx, "A".repeat(43))).toEqual({ found: false });
      expect(await declineViaLink(tx, token, { reason: "No thanks" }, ctx)).toEqual({
        outcome: "DECLINED",
      });
      await tx.$executeRawUnsafe(`RESET ROLE`);
      expect(await findQuote(tx, q.id)).toMatchObject({
        status: "DECLINED",
        declinedByClient: true,
      });
    });
  });
});

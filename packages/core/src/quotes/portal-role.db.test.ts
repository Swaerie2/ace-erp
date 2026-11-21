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

// Checked by eye against migrations/20261121120000_client_link/migration.sql: exactly what it grants, no more.
const EXPECTED_PORTAL_GRANTS: string[] = [
  "public.audit_log.id:SELECT",
  "public.audit_log:INSERT",
  "public.customers.anonymisedAt:SELECT",
  "public.customers.id:SELECT",
  "public.customers.status:SELECT",
  "public.customers.status:UPDATE",
  "public.customers.updatedAt:UPDATE",
  "public.properties.archivedAt:SELECT",
  "public.properties.customerId:SELECT",
  "public.properties.id:SELECT",
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
  it("holds exactly the privileges the client link migration grants, and nothing else", async () => {
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
        "contacts",
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
      // customers: only id, status, anonymisedAt readable; only status and updatedAt writable
      for (const c of ["id", "status", "anonymisedAt"]) {
        expect(await privilege(tx, column("customers", c, "SELECT"))).toBe(true);
      }
      for (const c of [
        "displayName",
        "companyName",
        "notes",
        "billingLine1",
        "number",
        "consentAt",
      ]) {
        expect(await privilege(tx, column("customers", c, "SELECT")), `select customers.${c}`).toBe(
          false,
        );
        expect(await privilege(tx, column("customers", c, "UPDATE")), `update customers.${c}`).toBe(
          false,
        );
      }
      for (const c of ["status", "updatedAt"]) {
        expect(await privilege(tx, column("customers", c, "UPDATE"))).toBe(true);
      }
      // properties
      for (const c of ["id", "customerId", "archivedAt"]) {
        expect(await privilege(tx, column("properties", c, "SELECT"))).toBe(true);
      }
      for (const c of ["label", "addressLine1", "accessNotes", "mapUrl"]) {
        expect(
          await privilege(tx, column("properties", c, "SELECT")),
          `select properties.${c}`,
        ).toBe(false);
      }
      expect(await privilege(tx, column("properties", "updatedAt", "UPDATE"))).toBe(true);
      expect(await privilege(tx, column("properties", "label", "UPDATE"))).toBe(false);
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
      // the rate-limit table
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        expect(await privilege(tx, tablePriv("public_link_hits", p))).toBe(true);
      }
    });
  });
});

describe.skipIf(!dbTestsEnabled)("the ace_portal role: refused statements", () => {
  const refused: [string, string][] = [
    ["reading contacts", `select * from contacts limit 1`],
    ["reading staff users", `select * from staff_users limit 1`],
    ["reading a customer's name", `select "displayName" from customers limit 1`],
    ["reading the internal note", `select "internalNote" from quotes limit 1`],
    ["reading the audit details", `select "after" from audit_log limit 1`],
    ["changing a customer's name", `update customers set "displayName" = 'x'`],
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

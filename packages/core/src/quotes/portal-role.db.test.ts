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
import { makeIssued } from "./test-helpers";

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

describe.skipIf(!dbTestsEnabled)("the ace_portal role: exact privileges", () => {
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
      ).rejects.toThrow(/permission denied|violates row-level security/i);
    });
  }
});

describe.skipIf(!dbTestsEnabled)("the public functions run as ace_portal", () => {
  it("shows a quote, records a view, accepts, and keeps the audit and the rate limiter working", async () => {
    await withRollback(async (tx) => {
      const q = await makeIssued(tx, { status: "LEAD" });
      const row = await findQuote(tx, q.id);
      const token = row.linkToken ?? "";

      await tx.$executeRawUnsafe(AS_PORTAL);
      const view = await getPublicQuote(tx, token);
      expect(view.found && view.state).toBe("OPEN");
      await recordLinkView(tx, token);
      expect((await checkRateLimit(tx, "view", hashIp("198.51.100.50"))).allowed).toBe(true);
      const result = await acceptViaLink(
        tx,
        token,
        { acceptedBy: "A. Client", startDate: start(), chosenLineIds: [] },
        ctx,
      );
      expect(result).toEqual({ outcome: "ACCEPTED", customerFlag: null });
      await tx.$executeRawUnsafe(`RESET ROLE`);

      const after = await findQuote(tx, q.id);
      expect(after).toMatchObject({ status: "ACCEPTED", acceptedMethod: "CLIENT_LINK" });
      expect(after.firstViewedAt).toBeInstanceOf(Date);
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

import { describe, expect, it } from "vitest";
import { listCustomerActivity } from "../customers/customers";
import { listQuoteActivity } from "../quotes/activity";
import { getQuote } from "../quotes/drafts";
import { addDays, todaySA } from "../quotes/reference";
import { manager, token } from "../quotes/test-helpers";
import { dbTestsEnabled, withRollback } from "../testing/rollback";
import { grantAccessAfterAcceptance } from "./access";
import { acceptPortalQuote } from "./quotes";
import { addPortalContact, issueFor, makeClient, scopeOf } from "./test-helpers";
import { completeWelcome } from "./welcome";

describe.skipIf(!dbTestsEnabled)("what staff see of portal acts", () => {
  it("shows who accepted in the portal and for which agency, and names the client and the system in the history", async () => {
    await withRollback(async (tx) => {
      const agency = await makeClient(tx, { name: `ZZ E2E Agency ${token()}`, welcomed: false });
      const complex = await makeClient(tx, { managedById: agency.customerId });
      const uninvited = await addPortalContact(tx, complex.customerId, { access: false });
      const q = await issueFor(tx, complex);

      const result = await acceptPortalQuote(
        tx,
        await scopeOf(tx, agency.email),
        q,
        { acceptedBy: "ZZ E2E Agency Person", startDate: addDays(todaySA(), 4), chosenLineIds: [] },
        { ip: null, userAgent: "ZZ Test Browser" },
      );
      expect(result.outcome).toBe("ACCEPTED");
      const quote = await getQuote(tx, manager, q);
      expect(quote?.acceptedByContact).toMatchObject({
        id: agency.contactId,
        customerId: agency.customerId,
        customer: { id: agency.customerId, displayName: agency.name },
      });
      const history = await listQuoteActivity(tx, manager, q);
      expect(history.find((e) => e.action === "quote.accepted")?.actorName).toBe("Client (portal)");

      expect((await grantAccessAfterAcceptance(tx, q)).map((i) => i.contactId)).toEqual([
        uninvited.contactId,
      ]);
      const complexActivity = await listCustomerActivity(tx, manager, complex.customerId);
      const granted = complexActivity.find((e) => e.action === "customer.portal_access_granted");
      expect(granted).toMatchObject({ actorType: "SYSTEM", actorName: "System" });

      await completeWelcome(tx, await scopeOf(tx, agency.email), {
        contactId: agency.contactId,
        name: "ZZ E2E Agency Person",
        phone: null,
        billingLine1: null,
        billingLine2: null,
        billingSuburb: null,
        billingCity: null,
        billingPostalCode: null,
        consent: "on",
      });
      const agencyActivity = await listCustomerActivity(tx, manager, agency.customerId);
      const welcomed = agencyActivity.find((e) => e.action === "customer.portal_welcomed");
      expect(welcomed).toMatchObject({ actorType: "CUSTOMER", actorName: "Client" });
      const created = agencyActivity.find((e) => e.action === "customer.created");
      expect(created?.actorType).toBe("STAFF");
    });
  });
});

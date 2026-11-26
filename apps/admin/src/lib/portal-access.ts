import "server-only";
import { getDb, grantPortalAccess, inTx, portalSignInUrl, sendEmail } from "@ace/core";
import { after } from "next/server";

/**
 * After an acceptance has committed: gives the customer's quote contacts portal access and emails them the
 * welcome. Runs after the response, in its own transaction. A failure is logged with fixed words only and
 * never touches the acceptance (staff can press Invite to portal on the contact).
 */
export function grantPortalAccessLater(quoteId: string): void {
  after(async () => {
    try {
      await grantPortalAccess(inTx, getDb(), quoteId, {
        send: (message) => sendEmail(message),
        signInUrl: portalSignInUrl(),
      });
    } catch {
      console.error("Portal access could not be given after an acceptance.");
    }
  });
}

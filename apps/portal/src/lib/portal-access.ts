import "server-only";
import { getPortalDb, grantPortalAccess, inPortalTx, portalSignInUrl, sendEmail } from "@ace/core";
import { after } from "next/server";

/**
 * After a client acceptance (link or portal) has committed: gives the customer's quote contacts portal
 * access and emails them the welcome, after the response, through the portal's own database login.
 * A failure is logged with fixed words only and never touches the acceptance.
 */
export function grantPortalAccessLater(quoteId: string): void {
  after(async () => {
    try {
      await grantPortalAccess(inPortalTx, getPortalDb(), quoteId, {
        send: (message) => sendEmail(message),
        signInUrl: portalSignInUrl(),
      });
    } catch {
      console.error("Portal access could not be given after an acceptance.");
    }
  });
}

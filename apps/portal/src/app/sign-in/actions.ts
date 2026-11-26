"use server";

import { getPortalDb } from "@ace/core";
import {
  normaliseEmail,
  requestSignInCode,
  sendEmail,
  signInCodeEmail,
  verifySignInCode,
  type SignInCodeMessage,
} from "@ace/core/portal";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { BAD_REQUEST, formValues, guardAction } from "@/lib/form";
import type { FormState } from "@/lib/form-state";
import {
  clearPendingEmail,
  readPendingEmail,
  setPendingEmail,
  setSessionCookie,
} from "@/lib/session";
import { getVisitor } from "@/lib/visitor";

const TOO_MANY_CODES = "Too many code requests. Please wait an hour and try again.";
/** The one answer to every refused code, whatever the reason: it must not show whether an email is on file. */
const CODE_NOT_ACCEPTED =
  "That code is not right or has expired. Check the latest email, or ask for a new code.";

/**
 * Only QUEUES the email (`after` runs it once the reply has gone), so the reply takes the same time whether
 * or not the email is on file. This function owns its own try/catch and logs fixed words only: never the
 * error, the address or the code.
 */
function queueSignInCode(message: SignInCodeMessage): Promise<void> {
  after(async () => {
    try {
      await sendEmail(signInCodeEmail(message));
    } catch {
      console.error("A sign-in code email could not be sent.");
    }
  });
  return Promise.resolve();
}

export async function requestCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const visitor = await getVisitor();
  // Link previews, crawlers and clients with no browser string never get a code.
  if (visitor.isBot) return { error: BAD_REQUEST, values, nonce: Date.now() };
  const typed = values.email ?? "";
  const result = await requestSignInCode(
    getPortalDb(),
    { email: typed, ipHash: visitor.ipHash },
    { send: queueSignInCode },
  );
  if (result.outcome === "INVALID_EMAIL") {
    return { fieldErrors: { email: "Enter a valid email address." }, values, nonce: Date.now() };
  }
  if (result.outcome === "LIMITED") return { error: TOO_MANY_CODES, values, nonce: Date.now() };
  // SENT and NO_MATCH: exactly the same cookie, page and words, so nobody can tell which it was.
  await setPendingEmail(normaliseEmail(typed) ?? "");
  redirect("/sign-in/code");
}

export async function verifyCodeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  // Bots are refused, and every try counts against the visitor's "act" allowance in this OWN statement,
  // before the check below (which takes no visitor). The typed code is never sent back to the browser.
  const guarded = await guardAction({});
  if ("refused" in guarded) return guarded.refused;
  const email = await readPendingEmail();
  if (!email) redirect("/sign-in");
  // The plain portal client, never inside a transaction: the check opens its own.
  const result = await verifySignInCode(getPortalDb(), { email, code: values.code ?? "" });
  if (result.outcome !== "OK") return { error: CODE_NOT_ACCEPTED, nonce: Date.now() };
  await setSessionCookie(result.token, result.expiresAt);
  await clearPendingEmail();
  redirect(result.needsWelcome ? "/welcome" : "/");
}

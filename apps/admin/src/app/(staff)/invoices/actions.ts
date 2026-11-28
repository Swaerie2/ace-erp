"use server";

import {
  billingTimingSchema,
  checkInvoiceEmailable,
  createMonthlyDrafts,
  createOnceOffDraft,
  createStartMonthDrafts,
  deleteInvoiceDraft,
  dismissPaymentReport,
  DomainError,
  draftInputFromForm,
  ForbiddenError,
  getDb,
  inTx,
  INVOICE_MESSAGES,
  InvoiceDraftConflictError,
  issueAllDrafts,
  issueInvoice,
  MANAGEMENT,
  reasonSchema,
  runMonthSchema,
  saveInvoiceDraft,
  setBillingTiming,
  voidInvoice,
  type Actor,
  type IssueAllResult,
  type RunResult,
  type StartMonthResult,
} from "@ace/core";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toActor } from "@/lib/actor";
import { requireStaff } from "@/lib/auth";
import { failure, formValues, type FormState } from "@/lib/form";
import { emailInvoicesLater } from "@/lib/invoice-email";

const idSchema = z.uuid();
/** A draft version posted back by a form (whole number, 1 or more). */
const versionSchema = z.coerce.number().int().min(1).max(2_147_483_647);
const BAD_REQUEST = "Something went wrong. Refresh the page and try again.";
/** The most drafts one press of "Issue all" works through, so a request cannot run past its time limit. */
const ISSUE_BATCH = 50;
/** More ids than the review list can show (500) are never read. */
const MAX_POSTED_IDS = 500;
/** The part-month box lists at most 200 clients. */
const MAX_PART_MONTH_IDS = 200;

/**
 * For buttons that cannot show an error themselves: a refused role goes to /forbidden, a refusal the user can
 * fix becomes a fixed notice code (never typed text), anything unexpected is re-thrown.
 */
function refusal(error: unknown): void {
  if (error instanceof ForbiddenError) redirect("/forbidden");
  if (!(error instanceof DomainError)) throw error;
}

function codeFor(error: unknown): string {
  refusal(error);
  const message = error instanceof DomainError ? error.message : "";
  if (message === INVOICE_MESSAGES.quoteInvoiced) return "quote-invoiced";
  if (message === INVOICE_MESSAGES.archived) return "archived";
  if (message === INVOICE_MESSAGES.runMonth) return "run-month";
  if (message === INVOICE_MESSAGES.reportResolved) return "report-resolved";
  return "cannot";
}

/** The Pre or Post switch on the customer's Invoices tab. */
export async function setBillingTimingAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("customerId"));
  if (!id.success) redirect("/customers");
  const timing = billingTimingSchema.safeParse(formData.get("billingTiming"));
  let code = "timing-saved";
  if (!timing.success) {
    code = "timing-generic";
  } else {
    try {
      await inTx((tx) => setBillingTiming(tx, actor, id.data, timing.data));
    } catch (error) {
      refusal(error);
      code = "timing-generic";
    }
  }
  redirect(`/customers/${id.data}?tab=invoices&notice=${code}`);
}

/**
 * Part-month drafts for clients whose first month no run can bill. Never throws: a refused role still goes to
 * /forbidden, anything else counts as one failure (fixed words in the log, nothing else).
 */
async function startMonthDrafts(
  actor: Actor,
  only?: string[],
): Promise<{ created: number; failed: number }> {
  let result: StartMonthResult;
  try {
    result = await createStartMonthDrafts(getDb(), actor, { run: inTx, ...(only ? { only } : {}) });
  } catch (error) {
    if (error instanceof ForbiddenError) redirect("/forbidden");
    console.error("Part-month invoice drafts could not be created.");
    return { created: 0, failed: 1 };
  }
  return { created: result.created.length, failed: result.failed };
}

/**
 * "Create this month's invoices": drafts only, each customer in its own transaction. Then the part-month
 * drafts for clients who accepted after the run for their first month (the run itself is unchanged).
 */
export async function runMonthAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const month = runMonthSchema.safeParse(formData.get("runMonth"));
  if (!month.success) redirect("/invoices?notice=run-month");
  let result: RunResult;
  try {
    result = await createMonthlyDrafts(getDb(), actor, month.data, { run: inTx });
  } catch (error) {
    redirect(`/invoices?notice=${codeFor(error)}`);
  }
  const part = await startMonthDrafts(actor);
  const failed = result.skipped.filter((s) => s.reason === "failed").length;
  redirect(
    `/invoices?notice=run&created=${result.created.length}&skipped=${result.skipped.length - failed}&failed=${failed}&part=${part.created}&partFailed=${part.failed}`,
  );
}

/** "Create part-month invoices": the clients the box on the Invoices page listed (posted as `customerId`). */
export async function startMonthAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const ids = [
    ...new Set(
      formData
        .getAll("customerId")
        .slice(0, MAX_PART_MONTH_IDS)
        .flatMap((v) => {
          const id = idSchema.safeParse(v);
          return id.success ? [id.data.toLowerCase()] : [];
        }),
    ),
  ];
  if (ids.length === 0) redirect("/invoices");
  const part = await startMonthDrafts(actor, ids);
  redirect(`/invoices?notice=part-month&created=${part.created}&failed=${part.failed}`);
}

/**
 * "Issue all drafts": the drafts the page showed (posted as `draftId`), oldest first, at most ISSUE_BATCH per
 * press, each in its own transaction. The emails go after the response, only for the invoices actually issued.
 */
export async function issueAllAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  if (formData.get("confirm") !== "yes") redirect("/invoices");
  // Each value is "id:version" (the version the page showed); a bare id still works, without the check.
  const posted = formData.getAll("draftId").slice(0, MAX_POSTED_IDS);
  const expectedVersions: Record<string, number> = {};
  const ids = [
    ...new Set(
      posted.flatMap((v) => {
        if (typeof v !== "string") return [];
        const [idText, versionText, ...rest] = v.split(":");
        const id = idSchema.safeParse(idText);
        if (!id.success || rest.length > 0) return [];
        const key = id.data.toLowerCase();
        if (versionText !== undefined) {
          const version = versionSchema.safeParse(versionText);
          if (!version.success) return [];
          expectedVersions[key] = version.data;
        }
        return [key];
      }),
    ),
  ];
  if (ids.length === 0) redirect("/invoices");
  // The page lists drafts oldest first, so the first ISSUE_BATCH ids are the oldest ones.
  const batch = ids.slice(0, ISSUE_BATCH);
  const remaining = ids.length - batch.length;
  let result: IssueAllResult;
  try {
    result = await issueAllDrafts(getDb(), actor, { run: inTx, only: batch, expectedVersions });
  } catch (error) {
    redirect(`/invoices?notice=${codeFor(error)}`);
  }
  // Each issue has committed in its own transaction by now; the email never undoes one.
  emailInvoicesLater(
    actor,
    result.issued.map((i) => i.id),
  );
  redirect(
    `/invoices?notice=issued-all&issued=${result.issued.length}&failed=${result.failed.length}&remaining=${remaining}`,
  );
}

/** "New invoice" on a customer: an empty once-off draft, or one pre-filled from an accepted quote. */
export async function createOnceOffAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const customer = idSchema.safeParse(formData.get("customerId"));
  if (!customer.success) redirect("/invoices/new");
  const quoteText = formData.get("quoteId");
  const quote =
    typeof quoteText === "string" && quoteText !== "" ? idSchema.safeParse(quoteText) : null;
  if (quote && !quote.success) redirect(`/invoices/new?customer=${customer.data}&notice=cannot`);
  let id: string;
  try {
    id = (
      await inTx((tx) =>
        createOnceOffDraft(tx, actor, {
          customerId: customer.data,
          fromQuoteId: quote?.data ?? null,
        }),
      )
    ).id;
  } catch (error) {
    redirect(`/invoices/new?customer=${customer.data}&notice=${codeFor(error)}`);
  }
  redirect(`/invoices/${id}`);
}

/** The draft form: every field goes through core's form parser (lengths, amounts, special characters). */
export async function saveInvoiceDraftAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const parsed = draftInputFromForm(values);
  if (!parsed.ok) {
    const { form, ...fieldErrors } = parsed.fieldErrors;
    return {
      error: form ?? "Check the boxes marked below.",
      fieldErrors,
      values,
      nonce: Date.now(),
    };
  }
  try {
    // saveInvoiceDraft runs the full draft schema again (repeated line ids, limits).
    await inTx((tx) => saveInvoiceDraft(tx, actor, id.data, parsed.input));
  } catch (error) {
    if (error instanceof InvoiceDraftConflictError) {
      // Core's sentence, plus a hint that only the app gives (a reload loses what was typed).
      return {
        error: `${error.message} Copy anything you typed before you reload.`,
        values,
        nonce: Date.now(),
      };
    }
    return failure(error, values);
  }
  redirect(`/invoices/${id.data}?notice=saved`);
}

/**
 * Issue one draft. Every problem comes back as one line of the message. The email is scheduled only after the
 * issue has committed; issuing never waits for it.
 */
export async function issueInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const version = versionSchema.safeParse(formData.get("version"));
  if (!version.success) return { error: BAD_REQUEST, nonce: Date.now() };
  try {
    await inTx((tx) => issueInvoice(tx, actor, id.data, { expectedVersion: version.data }));
  } catch (error) {
    if (error instanceof InvoiceDraftConflictError) {
      // Nothing is reloaded here, so whatever is typed in the draft form above stays as it is.
      return {
        error: `${error.message} Copy anything you typed before you reload.`,
        nonce: Date.now(),
      };
    }
    return failure(error);
  }
  emailInvoicesLater(actor, [id.data]);
  redirect(`/invoices/${id.data}?notice=issued`);
}

/** "Delete this draft" (skip). A monthly draft comes back if the month is run again. */
export async function deleteInvoiceDraftAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success || formData.get("confirm") !== "yes") redirect("/invoices");
  try {
    await inTx((tx) => deleteInvoiceDraft(tx, actor, id.data));
  } catch (error) {
    redirect(`/invoices/${id.data}?notice=${codeFor(error)}`);
  }
  redirect("/invoices?notice=deleted");
}

export async function voidInvoiceAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const values = formValues(formData);
  const id = idSchema.safeParse(values.id);
  if (!id.success) return { error: BAD_REQUEST, nonce: Date.now() };
  const reason = reasonSchema.safeParse(values.reason ?? "");
  if (!reason.success) {
    return {
      error: "Check the box marked below.",
      fieldErrors: { reason: reason.error.issues[0]?.message ?? "Say why in a few words." },
      values,
      nonce: Date.now(),
    };
  }
  try {
    await inTx((tx) => voidInvoice(tx, actor, id.data, reason.data));
  } catch (error) {
    return failure(error, values);
  }
  redirect(`/invoices/${id.data}?notice=voided`);
}

/** "Resend email" on an issued invoice. */
export async function resendInvoiceEmailAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) redirect("/invoices");
  try {
    await checkInvoiceEmailable(getDb(), actor, id.data);
  } catch (error) {
    redirect(`/invoices/${id.data}?notice=${codeFor(error)}`);
  }
  emailInvoicesLater(actor, [id.data]);
  redirect(`/invoices/${id.data}?notice=email-queued`);
}

/** "Dismiss" on a reported payment, from the invoice page (`back` = the invoice id) or the reports list. */
export async function dismissReportAction(formData: FormData): Promise<void> {
  const staff = await requireStaff(MANAGEMENT);
  const actor = await toActor(staff);
  const id = idSchema.safeParse(formData.get("id"));
  const backInvoice = idSchema.safeParse(formData.get("back"));
  const back = backInvoice.success ? `/invoices/${backInvoice.data}` : "/payments/reports";
  if (!id.success) redirect(back);
  let code = "dismissed";
  try {
    await inTx((tx) => dismissPaymentReport(tx, actor, id.data));
  } catch (error) {
    code = codeFor(error);
  }
  redirect(`${back}?notice=${code}`);
}

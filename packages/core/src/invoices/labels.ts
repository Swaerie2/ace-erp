export const BILLING_TIMINGS = ["PRE", "POST"] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];
export const BILLING_TIMING_LABELS: Record<BillingTiming, string> = {
  PRE: "Pre: billed in advance",
  POST: "Post: billed in the month of the service",
};

export const INVOICE_LINE_KINDS = [
  "SERVICE",
  "OPTIONAL",
  "LATE_FEE",
  "ADJUSTMENT",
  "ONCE_OFF",
] as const;
export type InvoiceLineKindValue = (typeof INVOICE_LINE_KINDS)[number];
/** Kinds staff may choose for a line they add by hand. Late fees come only from the run. */
export const NEW_LINE_KINDS = ["SERVICE", "ADJUSTMENT", "ONCE_OFF"] as const;
export const INVOICE_LINE_KIND_LABELS: Record<InvoiceLineKindValue, string> = {
  SERVICE: "Service",
  OPTIONAL: "Optional extra",
  LATE_FEE: "Late payment fee",
  ADJUSTMENT: "Adjustment",
  ONCE_OFF: "Once-off work",
};
/** What a line says after its customer is anonymised. */
export const ANONYMISED_LINE_DESCRIPTIONS: Record<InvoiceLineKindValue, string> = {
  SERVICE: "Monthly service",
  OPTIONAL: "Optional extra",
  LATE_FEE: "Late payment fee",
  ADJUSTMENT: "Adjustment",
  ONCE_OFF: "Once-off work",
};

export const INVOICE_DISPLAY_STATUSES = [
  "DRAFT",
  "UNPAID",
  "PART_PAID",
  "PAID",
  "OVERDUE",
  "VOID",
] as const;
export type InvoiceDisplayStatus = (typeof INVOICE_DISPLAY_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  DRAFT: "Draft",
  UNPAID: "Unpaid",
  PART_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const DRAFT_WARNINGS = ["noEmail", "firstMonth", "lateFee", "billToAgency"] as const;
export type DraftWarning = (typeof DRAFT_WARNINGS)[number];
export const DRAFT_WARNING_LABELS: Record<DraftWarning, string> = {
  noEmail: "No email on file: the invoice will not be emailed",
  firstMonth: "First month: check the amounts and any part month",
  lateFee: "Includes a suggested late payment fee",
  billToAgency: "Billed to the managing agency",
};

export const RUN_SKIP_REASONS = [
  "alreadyInvoiced",
  "notStarted",
  "lead",
  "paused",
  "archived",
  "anonymised",
  "failed",
] as const;
export type RunSkipReason = (typeof RUN_SKIP_REASONS)[number];
export const RUN_SKIP_LABELS: Record<RunSkipReason, string> = {
  alreadyInvoiced: "already invoiced for that month",
  notStarted: "service not started by then",
  lead: "still a lead",
  paused: "paused",
  archived: "archived",
  anonymised: "anonymised",
  failed: "could not be drafted (try again)",
};

export const PAYMENT_REPORT_STATUS_LABELS: Record<"WAITING" | "CONFIRMED" | "DISMISSED", string> = {
  WAITING: "Waiting",
  CONFIRMED: "Confirmed",
  DISMISSED: "Dismissed",
};

export const NOT_VAT_REGISTERED = "ACE Garden Services is not VAT registered, no VAT is charged.";

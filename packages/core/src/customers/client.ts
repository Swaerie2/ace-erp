export { formatCustomerNumber } from "./number";
export { normalisePhone } from "./phone";
export {
  CUSTOMER_SOURCES,
  SERVICE_FREQUENCIES,
  WEEKDAYS,
  formatCentsForInput,
  parseRandToCents,
} from "./schemas";
export { SERVICE_KINDS, SERVICE_KIND_LABELS } from "../services/schemas";
export {
  ACCEPT_METHOD_LABELS,
  BILLING_LABELS,
  FREQUENCY_LABELS,
  LINE_BILLINGS,
  LINE_FREQUENCIES,
  LINE_KIND_LABELS,
  LINE_KINDS,
  MAX_AMOUNT_CENTS,
  MAX_LINES,
  SENT_METHOD_LABELS,
  SENT_METHODS,
  STAFF_ACCEPT_METHODS,
  validateForIssue,
} from "../quotes/schemas";
export { quoteTotals } from "../quotes/totals";
export { addDays, todaySA } from "../quotes/reference";
export { formatZAR } from "../money";
export { buildQuoteDocument } from "../quotes/document";
export { bulletLines, snapshotWording } from "../quotes/wording-schema";

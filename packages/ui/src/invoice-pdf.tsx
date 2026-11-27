import type { InvoiceDocument, StatementDocument } from "@ace/core";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LogoImage, type PdfLogo } from "./pdf-logo";

// Hook-free on purpose: the staff app calls InvoicePdf and StatementPdf as plain functions (outside a React
// render), so each must return the <Document> element as its root. Built-in Helvetica only (no font files).
// Long tables flow across pages: every row stays whole (wrap={false}) and the section headings keep some
// content with them (minPresenceAhead), so a table can run to any length.
// The logo bytes come in their own `logo` prop, never inside the document object, so the picture never
// travels through React server component props or JSON. Without a logo the layout is exactly as before.

const GREEN = "#1f4d36";
const OCHRE = "#b5832a";
const INK = "#2b2b2b";
const MUTED = "#6b6b6b";

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
  },
  brand: { fontSize: 9, fontFamily: "Helvetica-Bold", color: OCHRE, letterSpacing: 1 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: GREEN, marginTop: 4 },
  banner: { marginTop: 10, padding: 6, backgroundColor: "#fbf3e2", fontFamily: "Helvetica-Bold" },
  threeCol: { flexDirection: "row", marginTop: 14, gap: 16 },
  col: { flex: 1 },
  label: { color: MUTED, fontSize: 8, marginBottom: 1 },
  strong: { fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: GREEN, marginTop: 18, marginBottom: 6 },
  headRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 3,
    borderBottomWidth: 0.7,
    borderBottomColor: MUTED,
  },
  headText: { color: MUTED, fontSize: 8 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d6d6d6",
  },
  rowText: { flex: 1, paddingRight: 8 },
  rowMeta: { color: MUTED, fontSize: 8 },
  amount: { fontFamily: "Helvetica-Bold", color: GREEN, width: 78, textAlign: "right" },
  plain: { width: 78, textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3, gap: 12 },
  small: { fontSize: 8, color: MUTED, marginTop: 6 },
  bank: { marginTop: 16, padding: 10, backgroundColor: "#eef4f0" },
  cards: { flexDirection: "row", marginTop: 14, gap: 8 },
  card: { flex: 1, padding: 8, backgroundColor: "#eef4f0" },
  cardValue: { fontSize: 12, fontFamily: "Helvetica-Bold", color: GREEN, marginTop: 2 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: MUTED,
  },
});

type Business = InvoiceDocument["business"];
type Bank = Pick<InvoiceDocument, "bank" | "bankReady" | "paymentReference">;

function From({ business }: { business: Business }) {
  return (
    <View style={s.col}>
      <Text style={s.label}>FROM</Text>
      <Text style={s.strong}>{business.legalName}</Text>
      <Text>t/a {business.tradingName}</Text>
      {business.address ? <Text>{business.address}</Text> : null}
      {business.registrationNumber ? <Text>Reg {business.registrationNumber}</Text> : null}
      {business.phone ? <Text>{business.phone}</Text> : null}
      {business.email ? <Text>{business.email}</Text> : null}
    </View>
  );
}

function BankBox({ bank, bankReady, paymentReference }: Bank) {
  return (
    <View style={s.bank} wrap={false}>
      <Text style={s.strong}>How to pay (EFT)</Text>
      {bankReady ? (
        <>
          <Text>Bank: {bank.bankName}</Text>
          <Text>Account holder: {bank.accountHolder}</Text>
          <Text>Account number: {bank.accountNumber}</Text>
          <Text>Branch code: {bank.branchCode}</Text>
          {bank.accountType ? <Text>Account type: {bank.accountType}</Text> : null}
        </>
      ) : (
        <Text>Bank details have not been entered yet.</Text>
      )}
      <Text style={{ marginTop: 4 }}>
        Payment reference: <Text style={s.strong}>{paymentReference}</Text>
      </Text>
    </View>
  );
}

function Footer({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => `${right}  ·  ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export function InvoicePdf({ doc, logo }: { doc: InvoiceDocument; logo?: PdfLogo | null }) {
  return (
    <Document
      title={`${doc.reference} ${doc.business.tradingName}`}
      author={doc.business.tradingName}
    >
      <Page size="A4" style={s.page}>
        <LogoImage logo={logo} />
        <Text style={s.brand}>{doc.business.tradingName.toUpperCase()}</Text>
        <Text style={s.title}>{doc.title}</Text>
        {doc.banner ? <Text style={s.banner}>{doc.banner}</Text> : null}
        <View style={s.threeCol} wrap={false}>
          <View style={s.col}>
            <Text style={s.label}>INVOICE NUMBER</Text>
            <Text style={s.strong}>{doc.reference}</Text>
            {doc.issuedDate ? <Text>Issued {doc.issuedDate}</Text> : null}
            {doc.dueDate ? <Text style={s.strong}>Due {doc.dueDate}</Text> : null}
            {doc.serviceMonthLabel ? <Text>Service month: {doc.serviceMonthLabel}</Text> : null}
          </View>
          <View style={s.col}>
            <Text style={s.label}>BILL TO</Text>
            <Text style={s.strong}>{doc.billTo.name}</Text>
            {doc.billTo.address ? <Text>{doc.billTo.address}</Text> : null}
            {doc.forCustomerName ? <Text>For: {doc.forCustomerName}</Text> : null}
          </View>
          <From business={doc.business} />
        </View>
        <Text style={s.h2} minPresenceAhead={60}>
          Details
        </Text>
        <View style={s.headRow}>
          <Text style={s.headText}>DESCRIPTION</Text>
          <Text style={[s.headText, { width: 78, textAlign: "right" }]}>AMOUNT</Text>
        </View>
        {doc.rows.map((r) => (
          <View key={r.id} style={s.row} wrap={false}>
            <View style={s.rowText}>
              <Text>{r.description}</Text>
              <Text style={s.rowMeta}>{r.kindLabel}</Text>
            </View>
            <Text style={s.amount}>{r.amountLabel}</Text>
          </View>
        ))}
        <View wrap={false}>
          <View style={s.totalRow}>
            <Text style={s.strong}>Total</Text>
            <Text style={s.amount}>{doc.totalLabel}</Text>
          </View>
          {doc.paidLabel ? (
            <View style={s.totalRow}>
              <Text>Paid</Text>
              <Text style={s.plain}>{doc.paidLabel}</Text>
            </View>
          ) : null}
          {doc.balanceLabel ? (
            <View style={s.totalRow}>
              <Text style={s.strong}>Balance due</Text>
              <Text style={s.amount}>{doc.balanceLabel}</Text>
            </View>
          ) : null}
          <Text style={s.small}>{doc.vatNote}</Text>
        </View>
        <BankBox
          bank={doc.bank}
          bankReady={doc.bankReady}
          paymentReference={doc.paymentReference}
        />
        <Footer
          left={`${doc.business.legalName} t/a ${doc.business.tradingName}${doc.business.website ? `, ${doc.business.website}` : ""}`}
          right={doc.reference}
        />
      </Page>
    </Document>
  );
}

export function StatementPdf({ doc, logo }: { doc: StatementDocument; logo?: PdfLogo | null }) {
  return (
    <Document title={`Statement ${doc.customer.number}`} author={doc.business.tradingName}>
      <Page size="A4" style={s.page}>
        <LogoImage logo={logo} />
        <Text style={s.brand}>{doc.business.tradingName.toUpperCase()}</Text>
        <Text style={s.title}>Statement</Text>
        <Text>
          {doc.periodLabel}, made {doc.generatedDate}
        </Text>
        <View style={s.threeCol} wrap={false}>
          <View style={s.col}>
            <Text style={s.label}>ACCOUNT</Text>
            <Text style={s.strong}>{doc.customer.name}</Text>
            <Text>{doc.customer.number}</Text>
            {doc.customer.address ? <Text>{doc.customer.address}</Text> : null}
          </View>
          <From business={doc.business} />
        </View>
        <View style={s.cards} wrap={false}>
          <View style={s.card}>
            <Text style={s.label}>OPENING BALANCE</Text>
            <Text style={s.cardValue}>{doc.summary.opening}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.label}>INVOICED</Text>
            <Text style={s.cardValue}>{doc.summary.invoiced}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.label}>PAID</Text>
            <Text style={s.cardValue}>{doc.summary.paid}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.label}>{doc.summary.closingNote.toUpperCase()}</Text>
            <Text style={s.cardValue}>{doc.summary.closing}</Text>
          </View>
        </View>
        {doc.summary.credit ? (
          <Text style={s.small}>
            Includes {doc.summary.credit} paid but not yet matched to an invoice (credit on
            account).
          </Text>
        ) : null}
        <Text style={s.h2} minPresenceAhead={60}>
          In this period
        </Text>
        {doc.rows.length === 0 ? <Text>Nothing invoiced or paid in this period.</Text> : null}
        {doc.rows.length > 0 ? (
          <View style={s.headRow}>
            <Text style={[s.headText, { flex: 1 }]}>DATE AND DETAILS</Text>
            <Text style={[s.headText, s.plain]}>INVOICED</Text>
            <Text style={[s.headText, s.plain]}>PAID</Text>
            <Text style={[s.headText, s.plain]}>BALANCE</Text>
          </View>
        ) : null}
        {doc.rows.map((r) => (
          <View key={r.key} style={s.row} wrap={false}>
            <View style={s.rowText}>
              <Text>
                {r.date}: {r.description}
              </Text>
              {r.forName ? <Text style={s.rowMeta}>For: {r.forName}</Text> : null}
            </View>
            <Text style={s.plain}>{r.debit}</Text>
            <Text style={s.plain}>{r.credit}</Text>
            <Text style={s.amount}>{r.balance}</Text>
          </View>
        ))}
        {doc.byComplex.length > 0 ? (
          <>
            <Text style={s.h2} minPresenceAhead={60}>
              Per complex
            </Text>
            <View style={s.headRow}>
              <Text style={[s.headText, { flex: 1 }]}>COMPLEX</Text>
              <Text style={[s.headText, s.plain]}>INVOICED</Text>
              <Text style={[s.headText, s.plain]}>STILL OWED</Text>
            </View>
            {doc.byComplex.map((c) => (
              <View key={c.name} style={s.row} wrap={false}>
                <Text style={s.rowText}>{c.name}</Text>
                <Text style={s.plain}>{c.invoiced}</Text>
                <Text style={s.amount}>{c.outstanding}</Text>
              </View>
            ))}
          </>
        ) : null}
        <Text style={s.h2} minPresenceAhead={60}>
          Still owed
        </Text>
        {doc.outstanding.length === 0 ? <Text>No invoice is waiting for payment.</Text> : null}
        {doc.outstanding.map((o) => (
          <View key={o.id} style={s.row} wrap={false}>
            <Text style={s.rowText}>
              {o.reference}
              {o.forName ? `, ${o.forName}` : ""}, due {o.dueDate}
              {o.overdue ? " (overdue)" : ""}
            </Text>
            <Text style={s.amount}>{o.balance}</Text>
          </View>
        ))}
        <Text style={s.small}>{doc.vatNote}</Text>
        <BankBox
          bank={doc.bank}
          bankReady={doc.bankReady}
          paymentReference={doc.paymentReference}
        />
        <Footer
          left={`${doc.business.legalName} t/a ${doc.business.tradingName}`}
          right={`Statement ${doc.customer.number}`}
        />
      </Page>
    </Document>
  );
}

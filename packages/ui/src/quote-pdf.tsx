import type { QuoteDocument } from "@ace/core";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { LogoImage, type PdfLogo } from "./pdf-logo";

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
  tagline: { color: MUTED, marginTop: 2 },
  banner: {
    marginTop: 10,
    padding: 6,
    backgroundColor: "#fbf3e2",
    color: INK,
    fontFamily: "Helvetica-Bold",
  },
  twoCol: { flexDirection: "row", marginTop: 14, gap: 16 },
  col: { flex: 1 },
  label: { color: MUTED, fontSize: 8, marginBottom: 1 },
  strong: { fontFamily: "Helvetica-Bold" },
  cards: { flexDirection: "row", marginTop: 14, gap: 10 },
  card: { flex: 1, padding: 10, backgroundColor: "#eef4f0" },
  cardValue: { fontSize: 15, fontFamily: "Helvetica-Bold", color: GREEN, marginTop: 2 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", color: GREEN, marginTop: 18, marginBottom: 6 },
  scope: { padding: 8, backgroundColor: "#eef4f0", marginBottom: 6 },
  scopeName: { fontFamily: "Helvetica-Bold", color: GREEN },
  bullet: { flexDirection: "row", marginTop: 2 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1 },
  excluded: { padding: 8, backgroundColor: "#f1f1f1", marginTop: 4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: "#d6d6d6",
  },
  rowText: { flex: 1, paddingRight: 8 },
  rowMeta: { color: MUTED, fontSize: 8 },
  rowAmount: { fontFamily: "Helvetica-Bold", color: GREEN },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3 },
  small: { fontSize: 8, color: MUTED, marginTop: 6 },
  clause: { marginBottom: 5 },
  clauseHead: { fontFamily: "Helvetica-Bold" },
  sign: { marginTop: 14 },
  signLine: { borderBottomWidth: 0.7, borderBottomColor: INK, height: 18, marginTop: 6 },
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

const BANNERS: Partial<Record<QuoteDocument["status"], string>> = {
  EXPIRED: "This quote has expired.",
  REPLACED: "This quote has been replaced by a newer version.",
  WITHDRAWN: "This quote has been withdrawn.",
  DECLINED: "This quote was declined.",
};

function Bullets({ items }: { items: string[] }) {
  return (
    <>
      {items.map((b) => (
        <View key={b} style={s.bullet} wrap={false}>
          <Text style={s.bulletDot}>•</Text>
          <Text style={s.bulletText}>{b}</Text>
        </View>
      ))}
    </>
  );
}

/** `logo` is the company logo's bytes, passed apart from the document (see invoice-pdf.tsx). */
export function QuotePdf({ doc, logo }: { doc: QuoteDocument; logo?: PdfLogo | null }) {
  const banner = BANNERS[doc.status];
  const optionalRows = doc.pricing.rows.filter((r) => r.kind === "OPTIONAL");
  return (
    <Document
      title={`${doc.reference} ${doc.business.tradingName}`}
      author={doc.business.tradingName}
    >
      <Page size="A4" style={s.page}>
        <LogoImage logo={logo} />
        <Text style={s.brand}>{doc.business.tradingName.toUpperCase()}</Text>
        <Text style={s.title}>Proposal and quotation</Text>
        <Text style={s.tagline}>{doc.tagline}</Text>
        {banner ? <Text style={s.banner}>{banner}</Text> : null}

        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.label}>QUOTE REFERENCE</Text>
            <Text style={s.strong}>{doc.reference}</Text>
            <Text style={[s.label, { marginTop: 8 }]}>DATE AND VALIDITY</Text>
            <Text>
              {doc.issuedDate ? `${doc.issuedDate}, ` : ""}valid until {doc.validUntil}
            </Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>PREPARED FOR</Text>
            <Text style={s.strong}>{doc.preparedFor.name}</Text>
            {doc.preparedFor.siteAddress ? <Text>{doc.preparedFor.siteAddress}</Text> : null}
            {doc.preparedFor.email ? <Text>{doc.preparedFor.email}</Text> : null}
            {doc.preparedFor.phone ? <Text>{doc.preparedFor.phone}</Text> : null}
          </View>
          <View style={s.col}>
            <Text style={s.label}>PREPARED BY</Text>
            <Text style={s.strong}>{doc.business.legalName}</Text>
            <Text>t/a {doc.business.tradingName}</Text>
            {doc.business.address ? <Text>{doc.business.address}</Text> : null}
            {doc.business.registrationNumber ? (
              <Text>Reg {doc.business.registrationNumber}</Text>
            ) : null}
            {doc.business.phone ? <Text>{doc.business.phone}</Text> : null}
            {doc.business.email ? <Text>{doc.business.email}</Text> : null}
            {doc.business.website ? <Text>{doc.business.website}</Text> : null}
          </View>
        </View>

        <View style={s.cards}>
          {doc.summary.monthlyTotal ? (
            <View style={s.card}>
              <Text style={s.label}>MONTHLY TOTAL</Text>
              <Text style={s.cardValue}>{doc.summary.monthlyTotal}</Text>
              {doc.summary.frequencyLabel ? (
                <Text>Service: {doc.summary.frequencyLabel}</Text>
              ) : null}
            </View>
          ) : null}
          {doc.summary.onceOffTotal ? (
            <View style={s.card}>
              <Text style={s.label}>ONCE-OFF TOTAL</Text>
              <Text style={s.cardValue}>{doc.summary.onceOffTotal}</Text>
            </View>
          ) : null}
          {doc.summary.optionalNote ? (
            <View style={[s.card, { backgroundColor: "#fbf3e2" }]}>
              <Text style={s.label}>OPTIONAL</Text>
              <Text style={s.strong}>{doc.summary.optionalNote}</Text>
            </View>
          ) : null}
        </View>

        <Text style={s.h2}>Scope of service</Text>
        {doc.scope.included.map((svc) => (
          <View key={svc.name} style={s.scope} wrap={false}>
            <Text style={s.scopeName}>{svc.name}</Text>
            <Bullets items={svc.bullets} />
          </View>
        ))}
        {doc.scope.excludedNames.length > 0 || doc.scope.standardExclusions.length > 0 ? (
          <View style={s.excluded} wrap={false}>
            <Text style={s.strong}>Not included (quoted separately on request)</Text>
            <Bullets items={[...doc.scope.excludedNames, ...doc.scope.standardExclusions]} />
          </View>
        ) : null}

        <Text style={s.h2}>Pricing</Text>
        {doc.pricing.rows.map((r) => (
          <View key={r.id} style={s.row} wrap={false}>
            <View style={s.rowText}>
              <Text>{r.description}</Text>
              <Text style={s.rowMeta}>
                {[
                  r.kind === "OPTIONAL" ? "Optional add-on" : null,
                  r.billingLabel,
                  r.frequencyLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <Text style={s.rowAmount}>{r.amountLabel}</Text>
          </View>
        ))}
        <View style={{ marginTop: 6 }}>
          {doc.pricing.totals.monthly ? (
            <View style={s.totalRow}>
              <Text>
                Monthly total
                {doc.pricing.totals.monthlyWithOptions ? " (excluding optional add-ons)" : ""}
              </Text>
              <Text style={s.strong}>{doc.pricing.totals.monthly}</Text>
            </View>
          ) : null}
          {doc.pricing.totals.monthlyWithOptions ? (
            <View style={s.totalRow}>
              <Text>Monthly total with optional add-ons</Text>
              <Text style={s.strong}>{doc.pricing.totals.monthlyWithOptions}</Text>
            </View>
          ) : null}
          {doc.pricing.totals.onceOff ? (
            <View style={s.totalRow}>
              <Text>Once-off total</Text>
              <Text style={s.strong}>{doc.pricing.totals.onceOff}</Text>
            </View>
          ) : null}
          {doc.pricing.totals.onceOffWithOptions ? (
            <View style={s.totalRow}>
              <Text>Once-off total with optional add-ons</Text>
              <Text style={s.strong}>{doc.pricing.totals.onceOffWithOptions}</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.small}>{doc.vatNote}</Text>

        {doc.termSections.map((section) => (
          <View key={section.title} wrap>
            <Text style={s.h2}>Terms: {section.title}</Text>
            {section.clauses.map((c) => (
              <View key={c.heading} style={s.clause} wrap={false}>
                <Text style={s.clauseHead}>{c.heading}</Text>
                <Text>{c.body}</Text>
              </View>
            ))}
          </View>
        ))}

        {doc.everyVisitPoints.length > 0 ? (
          <View wrap={false}>
            <Text style={s.h2}>Every visit on record</Text>
            <Bullets items={doc.everyVisitPoints} />
          </View>
        ) : null}

        <View style={s.sign} wrap={false}>
          <Text style={s.h2}>Acceptance</Text>
          <Text>
            I accept this quotation (Ref {doc.reference}) and the terms above
            {optionalRows.length > 0 ? ", with the optional add-ons ticked below" : ""}, with
            service to commence on ____________________.
          </Text>
          {optionalRows.map((r) => (
            <Text key={r.id} style={{ marginTop: 4 }}>
              [ ] {r.description} ({r.amountLabel})
            </Text>
          ))}
          <View style={{ flexDirection: "row", gap: 24, marginTop: 10 }}>
            <View style={s.col}>
              <Text style={s.strong}>For the client: {doc.preparedFor.name}</Text>
              <Text style={s.label}>Full name</Text>
              <View style={s.signLine} />
              <Text style={s.label}>Signature</Text>
              <View style={s.signLine} />
              <Text style={s.label}>Date</Text>
              <View style={s.signLine} />
            </View>
            <View style={s.col}>
              <Text style={s.strong}>For {doc.business.tradingName}</Text>
              <Text style={s.label}>Full name</Text>
              <View style={s.signLine} />
              <Text style={s.label}>Signature</Text>
              <View style={s.signLine} />
              <Text style={s.label}>Date</Text>
              <View style={s.signLine} />
            </View>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {doc.business.legalName} t/a {doc.business.tradingName}
            {doc.business.website ? `, ${doc.business.website}` : ""}
          </Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `${doc.reference}  ·  ${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

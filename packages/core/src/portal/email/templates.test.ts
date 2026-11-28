import { describe, expect, it } from "vitest";
import {
  INVOICE_SUBJECT,
  INVOICES_SUBJECT,
  SIGN_IN_SUBJECT,
  WELCOME_SUBJECT,
  escapeHtml,
  invoiceEmail,
  signInCodeEmail,
  welcomeEmail,
} from "./templates";

const EM_DASH = String.fromCharCode(0x2014);

describe("the sign-in code email", () => {
  const email = signInCodeEmail({ to: "zz.client@example.com", code: "042917" });
  it("has a fixed subject with nothing personal in it", () => {
    expect(email.subject).toBe(SIGN_IN_SUBJECT);
    expect(email.subject).toBe("Your ACE sign-in code");
    expect(email.subject).not.toContain("042917");
  });
  it("carries the code in both parts and says how long it works", () => {
    expect(email.to).toBe("zz.client@example.com");
    expect(email.text).toContain("042917");
    expect(email.html).toContain("042917");
    expect(email.text).toContain("10 minutes");
  });
  it("uses no em dashes", () => {
    expect(email.text + email.html + email.subject).not.toContain(EM_DASH);
  });
});

describe("the welcome email", () => {
  const email = welcomeEmail({
    to: "zz.client@example.com",
    name: "ZZ <b>Client</b>",
    signInUrl: "https://portal.example.com/sign-in",
  });
  it("has a fixed subject with nothing personal in it", () => {
    expect(email.subject).toBe(WELCOME_SUBJECT);
    expect(email.subject).toBe("Welcome to the ACE client portal");
  });
  it("links to the sign-in page with no secret, and escapes the name in the HTML", () => {
    expect(email.text).toContain("https://portal.example.com/sign-in");
    expect(email.html).toContain('href="https://portal.example.com/sign-in"');
    expect(email.html).toContain("ZZ &lt;b&gt;Client&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Client</b>");
    expect(email.text).toContain("ZZ <b>Client</b>");
  });
  it("uses no em dashes", () => {
    expect(email.text + email.html + email.subject).not.toContain(EM_DASH);
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});

describe("invoiceEmail", () => {
  const bank = {
    bankName: "ZZ Test Bank",
    accountHolder: "ACE Garden Services",
    accountNumber: "1234567890",
    branchCode: "250655",
    accountType: "Business cheque",
  };
  it("lists the invoices with the payment reference and bank details, under a fixed subject", () => {
    const one = invoiceEmail({
      to: "zz.client@example.com",
      invoices: [
        {
          reference: "INV-2026-0001",
          forName: null,
          amountLabel: "R1,150.00",
          dueDateLabel: "30 Nov 2026",
        },
      ],
      paymentReference: "C-0123",
      bank,
    });
    expect(one.subject).toBe(INVOICE_SUBJECT);
    expect(one.to).toBe("zz.client@example.com");
    expect(one.text).toContain("INV-2026-0001: R1,150.00, due 30 Nov 2026");
    expect(one.text).toContain("C-0123");
    expect(one.text).toContain("Account number: 1234567890");
    expect(one.text).toContain("not VAT registered");
    const two = invoiceEmail({
      to: "zz.agency@example.com",
      invoices: [
        {
          reference: "INV-2026-0001",
          forName: "ZZ <Complex> A",
          amountLabel: "R1.00",
          dueDateLabel: "30 Nov 2026",
        },
        {
          reference: "INV-2026-0002",
          forName: "ZZ Complex B",
          amountLabel: "R2.00",
          dueDateLabel: "30 Nov 2026",
        },
      ],
      paymentReference: "C-0099",
      bank: null,
    });
    expect(two.subject).toBe(INVOICES_SUBJECT);
    expect(two.text).toContain("INV-2026-0001 (ZZ <Complex> A): R1.00");
    expect(two.html).toContain("ZZ &lt;Complex&gt; A");
    expect(two.html).not.toContain("<Complex>");
    for (const m of [one, two]) {
      expect(m.subject).not.toContain("example.com");
      expect(m.text).not.toContain(EM_DASH);
      expect(m.html).not.toContain(EM_DASH);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Db } from "../db";
import { sendWelcomeEmails, type PortalInvite } from "./access";
import type { EmailMessage } from "./email/send";

const invite = (n: number): PortalInvite => ({
  contactId: `00000000-0000-4000-8000-00000000000${n}`,
  customerId: "00000000-0000-4000-8000-000000000000",
  email: `zz-e2e-${n}@example.com`,
  name: `ZZ E2E Person ${n}`,
});

describe("sendWelcomeEmails", () => {
  it("keeps sending when an audit write fails, and logs fixed words only", async () => {
    const sent: EmailMessage[] = [];
    let writes = 0;
    const store = {
      auditLog: {
        create: async () => {
          writes += 1;
          if (writes === 1) throw new Error("ZZ audit is down zz-e2e-1@example.com");
          return { id: "x" };
        },
      },
    } as unknown as Pick<Db, "auditLog">;
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    try {
      const result = await sendWelcomeEmails(store, [invite(1), invite(2), invite(3)], {
        send: async (m) => {
          sent.push(m);
        },
        signInUrl: "https://portal.example.com/sign-in",
      });
      expect(result).toEqual({ sent: 3, failed: 0 });
    } finally {
      spy.mockRestore();
    }
    expect(sent.map((m) => m.to)).toEqual([
      "zz-e2e-1@example.com",
      "zz-e2e-2@example.com",
      "zz-e2e-3@example.com",
    ]);
    expect(writes).toBe(3);
    expect(logged).toEqual([
      ["A portal welcome email result could not be written to the audit log."],
    ]);
  });
});

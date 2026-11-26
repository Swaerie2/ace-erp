import { describe, expect, it } from "vitest";
import { requestSignInCode } from "./signin";
import type { PortalStore } from "./store";

/**
 * With the plain portal connection (which has `$transaction`), the lock, the visible-set read and the code
 * write run inside one transaction it opens; only the rate-limit counts run outside it. The database tests
 * pass a transaction instead, so this path is checked here with a stand-in store.
 */
describe("requestSignInCode with a plain connection", () => {
  it("opens one transaction and takes the customer lock inside it", async () => {
    const outer: string[] = [];
    const inner: string[] = [];
    const sqlOf = (strings: TemplateStringsArray) => strings.join("?").replace(/\s+/g, " ");
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        inner.push(sqlOf(strings));
        return [];
      },
      contact: { findMany: async () => [] },
    };
    let transactions = 0;
    const store = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        outer.push(sqlOf(strings));
        return [{ count: 1 }];
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        transactions += 1;
        return fn(tx);
      },
    } as unknown as PortalStore;

    const sent: unknown[] = [];
    const result = await requestSignInCode(
      store,
      { email: "nobody@example.com", ipHash: "a".repeat(64) },
      { send: async (m) => void sent.push(m), cleanup: false },
    );
    expect(result).toEqual({ outcome: "NO_MATCH" });
    expect(transactions).toBe(1);
    expect(outer).toHaveLength(2);
    expect(outer.every((s) => s.includes("public_link_hits"))).toBe(true);
    expect(inner).toHaveLength(1);
    expect(inner[0]).toMatch(/for share of cu/);
    expect(sent).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { DomainError, type Actor } from "./access";
import { anonymiseCustomer } from "./privacy";
import type { Store } from "./store";

const owner: Actor = { id: "owner-1", role: "OWNER" };
const ID = "11111111-1111-4111-8111-111111111111";

type Where = { id?: string; customerId?: string; anonymisedAt?: null };
type Data = Record<string, unknown>;

/** A recording stand-in for the database. Only what anonymiseCustomer touches. */
function fakeStore(opts: { scrubCount?: number; failOn?: string } = {}) {
  const calls: { op: string; where?: Where; data?: Data }[] = [];
  const record = (op: string) => async (args?: { where?: Where; data?: Data }) => {
    calls.push({
      op,
      ...(args?.where ? { where: args.where } : {}),
      ...(args?.data ? { data: args.data } : {}),
    });
    if (opts.failOn === op) throw new Error(`boom in ${op}`);
    if (op === "customer.updateMany") {
      const isScrub = args?.data && "anonymisedAt" in args.data;
      return { count: isScrub ? (opts.scrubCount ?? 1) : 1 };
    }
    return { count: 2 };
  };
  const store = {
    customer: {
      findUnique: async () => ({ id: ID, number: 7, anonymisedAt: null, archivedAt: null }),
      updateMany: record("customer.updateMany"),
      update: record("customer.update"),
    },
    contact: { updateMany: record("contact.updateMany") },
    property: { updateMany: record("property.updateMany") },
    auditLog: { create: record("auditLog.create") },
  } as unknown as Store;
  return { store, calls };
}

describe("anonymiseCustomer write order", () => {
  it("scrubs contacts and properties first, and the customer row (with anonymisedAt) last", async () => {
    const { store, calls } = fakeStore();
    await anonymiseCustomer(store, owner, ID, "C-0007");

    const ops = calls.map((c) => c.op);
    const scrubIndex = calls.findIndex((c) => c.data && "anonymisedAt" in c.data);
    expect(ops[scrubIndex]).toBe("customer.updateMany");
    expect(ops.indexOf("contact.updateMany")).toBeLessThan(scrubIndex);
    expect(ops.indexOf("property.updateMany")).toBeLessThan(scrubIndex);
    // Nothing writes to the customer after the scrub except the audit line.
    expect(ops.slice(scrubIndex + 1)).toEqual(["auditLog.create"]);
    // The final update is conditional, so a second run cannot slip through.
    expect(calls[scrubIndex]?.where).toEqual({ id: ID, anonymisedAt: null });
    // It never uses a plain customer.update, which could not carry that condition.
    expect(ops).not.toContain("customer.update");
  });

  it("throws if the conditional customer update matches no row, and writes no audit line", async () => {
    const { store, calls } = fakeStore({ scrubCount: 0 });
    await expect(anonymiseCustomer(store, owner, ID, "C-0007")).rejects.toThrow(
      new DomainError("This customer is already anonymised."),
    );
    expect(calls.some((c) => c.op === "auditLog.create")).toBe(false);
  });

  it("a failure part-way leaves the customer un-marked, so the call can be retried", async () => {
    const failing = fakeStore({ failOn: "property.updateMany" });
    await expect(anonymiseCustomer(failing.store, owner, ID, "C-0007")).rejects.toThrow("boom");
    expect(failing.calls.some((c) => c.data && "anonymisedAt" in c.data)).toBe(false);

    const retry = fakeStore();
    await anonymiseCustomer(retry.store, owner, ID, "C-0007");
    expect(retry.calls.some((c) => c.data && "anonymisedAt" in c.data)).toBe(true);
  });
});

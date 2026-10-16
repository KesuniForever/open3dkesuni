import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetOrder, listRemembered, rememberIfNew, rememberOrder } from "./my-orders";

// "My orders" in this browser: what the order form and the order page keep (localStorage), newest first.
const A = "/c/aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "/c/bbbbbbbbbbbbbbbbbbbbbbbb";
const T1 = new Date("2026-10-16T01:00:00.000Z");
const T2 = new Date("2026-10-16T02:00:00.000Z");
const g = globalThis as unknown as { window?: unknown };

beforeEach(() => {
  const mem = new Map<string, string>();
  g.window = { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } };
});
afterEach(() => { delete g.window; });

describe("my orders in this browser", () => {
  it("the form keeps each order sent, newest first, and Remove from list drops only that one", () => {
    rememberOrder(A, "Clip", T1);
    rememberOrder(B, "Casing", T2);
    expect(listRemembered().map((o) => o.link)).toEqual([B, A]);
    forgetOrder(B);
    expect(listRemembered()).toEqual([{ link: A, product: "Clip", at: T1.toISOString() }]);
  });

  it("the order page adds an order this browser does not list yet, and leaves a listed one where it is", () => {
    rememberIfNew(A, "Clip", T1);
    rememberIfNew(B, "Casing", T2);
    rememberIfNew(A, "Clip again", T2); // the page refreshes every few seconds
    expect(listRemembered()).toEqual([{ link: B, product: "Casing", at: T2.toISOString() }, { link: A, product: "Clip", at: T1.toISOString() }]);
    rememberIfNew("/c/../../x", "Bad", T2);
    expect(listRemembered()).toHaveLength(2);
  });

  it("storage blocked (private window): nothing is kept and nothing throws", () => {
    g.window = { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } };
    expect(() => rememberIfNew(A, "Clip")).not.toThrow();
    expect(listRemembered()).toEqual([]);
  });
});

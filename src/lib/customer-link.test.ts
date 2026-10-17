import { beforeEach, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as store from "./store";
import { NEW_CUSTOMER_LINK_TOOL, ensureCustomerToken, replaceCustomerToken } from "./actions";
import { orderForToken } from "./customer";
import { traction } from "./traction";
import { describeEntry } from "./ops";
import { TOOLS } from "./agent/tools";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import type { Order } from "./types";

// "New link" on the operator order page: a customer link seen where it should not be (the demo video showed two) is
// replaced, and the old one stops working at once.
const at = "2026-10-17T05:00:00.000Z";
const OLD = "oldoldoldoldoldoldoldold";
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, jobId: `JOB-${id}`, product: "Lamp", quantity: 1, deadline: "2026-10-30", designVersion: "v1", mandateMicro: 50_000_000,
  status: "IN_PRODUCTION", label: "real", customerName: "Aini", customerToken: OLD, ...extra,
});

beforeEach(() => {
  store.resetDb();
  store.saveOrder(order("ORD-060"));
});

describe("replaceCustomerToken", () => {
  it("gives the order a new unguessable token: the old one finds nothing, the new one finds the order", () => {
    const r = replaceCustomerToken("ORD-060", { by: " Khelda " }, Date.parse(at));
    if (!r.ok) throw new Error(r.error);
    expect(r.customerToken).not.toBe(OLD);
    expect(r.customerToken).toMatch(/^[A-Za-z0-9_-]{24}$/); // 18 random bytes, base64url
    expect(store.getOrder("ORD-060")!.customerToken).toBe(r.customerToken);
    expect(orderForToken(OLD)).toBeUndefined();
    expect(orderForToken(r.customerToken)!.id).toBe("ORD-060");
    // The operator page reads the new one (ensureCustomerToken keeps a token that exists).
    expect(ensureCustomerToken("ORD-060")).toBe(r.customerToken);
    // Nothing else of the order changed.
    expect({ ...store.getOrder("ORD-060")!, customerToken: OLD }).toEqual(order("ORD-060"));
    const again = replaceCustomerToken("ORD-060", { by: "Khelda" });
    expect(again.ok && again.customerToken).not.toBe(r.customerToken);
  });

  it("logs who and when, never a token", () => {
    const r = replaceCustomerToken("ORD-060", { by: " Khelda " }, Date.parse(at));
    if (!r.ok) throw new Error(r.error);
    const rows = store.listLog("ORD-060").filter((e) => e.tool === NEW_CUSTOMER_LINK_TOOL);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "human", ok: true, input: { by: "Khelda" }, output: {}, at });
    const json = JSON.stringify(store.listLog("ORD-060"));
    expect(json).not.toContain(OLD);
    expect(json).not.toContain(r.customerToken);
    expect(describeEntry(rows[0])).toEqual({ title: "New customer link made by Khelda", line: "The old link stopped working" });
    expect(describeEntry(rows[0], makeT("id", ID))).toEqual({ title: "Tautan pelanggan baru dibuat oleh Khelda", line: "Tautan lama tidak berlaku lagi" });
  });

  it("needs a person's name; an unknown order is 404; a refusal changes and logs nothing", () => {
    for (const by of ["", "  ", "agent", "Claude", undefined, 7]) {
      expect(replaceCustomerToken("ORD-060", { by }), String(by)).toMatchObject({ ok: false, status: 400, error: "A person's name is required" });
    }
    expect(replaceCustomerToken("ORD-404", { by: "Khelda" })).toMatchObject({ ok: false, status: 404, error: "Order not found" });
    expect(store.getOrder("ORD-060")!.customerToken).toBe(OLD);
    expect(store.listLog("ORD-060")).toEqual([]);
  });

  it("works on an order with money in escrow or already finished: it moves no money", () => {
    for (const status of ["CREATED", "EVIDENCE_SUBMITTED", "PAID", "REJECTED"] as const) {
      store.saveOrder(order("ORD-061", { status }));
      expect(replaceCustomerToken("ORD-061", { by: "Khelda" }), status).toMatchObject({ ok: true });
      expect(store.getOrder("ORD-061")!.status).toBe(status);
    }
  });

  it("never changes traction: an order without a name still counts once, with the same numbers", () => {
    store.saveOrder(order("ORD-062", { customerName: undefined, customerToken: "tok-ORD-062-xxxxxxxxxxxxx" }));
    store.saveOrder(order("ORD-063", { customerName: undefined, customerToken: "tok-ORD-063-xxxxxxxxxxxxx" }));
    const before = traction();
    for (const id of ["ORD-060", "ORD-062", "ORD-063"]) expect(replaceCustomerToken(id, { by: "Khelda" }).ok).toBe(true);
    const after = traction();
    expect(after.realCustomers).toBe(before.realCustomers);
    expect(after.realCustomers).toBe(3); // Aini, and two orders without a name
    expect({ ...after, computedAt: "" }).toEqual({ ...before, computedAt: "" });
  });

  it("is for people only: no agent tool, and the agent's code never names it", () => {
    expect(TOOLS.map((t) => t.name).filter((n) => /link|token/i.test(n))).toEqual([]);
    const dir = path.join(process.cwd(), "src", "lib", "agent");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/replaceCustomerToken|new_customer_link|NEW_CUSTOMER_LINK_TOOL|customer-link/);
    }
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { resetDb } from "../store";
import { planOrder } from "./planner";
import { callTool, TOOLS } from "./tools";

beforeEach(resetDb);

describe("planner", () => {
  it("refuses the 35 USDC partner and chooses the 30 USDC own quote, with a log", () => {
    const r = planOrder("ORD-001");
    expect(r.outcome).toBe("chosen");
    expect(r.quoteId).toBe("Q-own");
    expect(r.message).toMatch(/Q-partner.*exceeds mandate/);
    expect(store.getOrder("ORD-001")!.status).toBe("PLAN_CHOSEN");
    const log = store.listLog("ORD-001");
    const tools = log.map((e) => e.tool);
    expect(tools).toContain("check_vendor_policy");
    expect(tools.at(-1)).toBe("choose_plan");
    expect(log.some((e) => e.tool === "check_vendor_policy" && !e.ok)).toBe(true);
  });

  it("escalates to a human when nothing is allowed", () => {
    store.deleteQuote("Q-own");
    const r = planOrder("ORD-001");
    expect(r.outcome).toBe("escalated");
    expect(store.getOrder("ORD-001")!.status).toBe("CREATED");
    expect(store.listLog("ORD-001").at(-1)!.tool).toBe("request_human_decision");
  });

  it("does not re-plan an order that already has a plan", () => {
    planOrder("ORD-001");
    expect(planOrder("ORD-001").outcome).toBe("error");
  });
});

describe("agent tools use the same policy as the human API", () => {
  it("choose_plan cannot pick the over-budget quote", () => {
    const r = callTool("choose_plan", { orderId: "ORD-001", quoteId: "Q-partner", reason: "faster" });
    expect(r.ok).toBe(false);
    expect(store.getOrder("ORD-001")!.status).toBe("CREATED");
  });

  it("propose_payment is blocked before acceptance", () => {
    callTool("choose_plan", { orderId: "ORD-001", quoteId: "Q-own", reason: "ok" });
    const r = callTool("propose_payment", {
      orderId: "ORD-001", recipient: "0x0000000000000000000000000000000000000001",
      amountMicro: 30_000_000, idempotencyKey: "k",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toMatch(/not been accepted/);
  });

  it("unknown tools fail safely and are logged", () => {
    expect(callTool("send_money_now", {}).ok).toBe(false);
    expect(store.listLog("").at(-1)!.tool).toBe("send_money_now");
  });

  it("exposes JSON Schemas for all 7 tools", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([
      "check_vendor_policy", "choose_plan", "get_available_budget", "get_order",
      "get_quotes", "propose_payment", "request_human_decision",
    ]);
  });
});

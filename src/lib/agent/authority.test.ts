import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { chiefAuthority } from "./authority";
import { LLM_TOOLS } from "./tools";

const NOW = new Date("2026-10-14T15:00:00+07:00");
const at = (hhmm: string, day = "2026-10-14") => new Date(`${day}T${hhmm}:00+07:00`).toISOString();
const log = (tool: string, ok = true, when = at("10:00"), actor: "agent" | "human" = "agent") =>
  store.addLog({ orderId: "ORD-001", actor, tool, input: {}, ok, output: {}, at: when });
const ENV = ["KESUNI_MIN_ORDER_IDR", "KESUNI_MAX_WAKES_PER_HOUR", "CIRCLE_BLOCKCHAIN", "KESUNI_ALLOW_MAINNET", "KESUNI_HEARTBEAT_SECONDS"];

beforeEach(() => store.resetDb());
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("Chief authority card", () => {
  it("is built from the live config: owner rules, wake limit, network lock and heartbeat", () => {
    process.env.KESUNI_MIN_ORDER_IDR = "150000";
    process.env.KESUNI_MAX_WAKES_PER_HOUR = "7";
    process.env.KESUNI_HEARTBEAT_SECONDS = "300";
    const a = chiefAuthority(NOW);
    const limit = (id: string) => a.limitedByCode.find((l) => l.id === id)!.text;
    expect(limit("min_order")).toContain("Rp150.000");
    expect(limit("approval_above")).toContain("Rp1.000.000");
    expect(limit("partner_min")).toContain("Rp300.000");
    expect(limit("min_margin")).toContain("15%");
    expect(limit("wakes")).toContain("7 background wake-ups");
    expect(limit("mainnet")).toMatch(/Arc Testnet.*locked unless KESUNI_ALLOW_MAINNET=1/);
    expect(a.decidesAlone.find((d) => d.id === "heartbeat")!.text).toContain("every 5 min");
    expect(a.decidesAlone.map((d) => d.id)).toEqual(expect.arrayContaining(["price_by_weight", "choose_plan", "choose_printer", "create_operator_task", "message_customer", "release", "refund"]));

    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    expect(chiefAuthority(NOW).limitedByCode.find((l) => l.id === "mainnet")!.text).toContain("locked: KESUNI_ALLOW_MAINNET is not 1");
    process.env.KESUNI_ALLOW_MAINNET = "1";
    expect(chiefAuthority(NOW).limitedByCode.find((l) => l.id === "mainnet")!.text).toContain("unlocked");
  });

  it("the LLM's tools hold no payment tool, and release/refund are listed as code, not as Chief tools", () => {
    const a = chiefAuthority(NOW);
    expect(a.hasPaymentTool).toBe(false);
    expect(a.tools).toEqual(LLM_TOOLS.map((t) => t.name));
    expect(a.tools).not.toContain("propose_payment");
    expect(a.limitedByCode.find((l) => l.id === "no_payment_tool")!.text).toMatch(/^No payment tool/);
    for (const id of ["release", "refund", "heartbeat"]) expect(a.decidesAlone.find((d) => d.id === id)!.by).toBe("code");
    expect(a.decidesAlone.find((d) => d.id === "choose_plan")!.by).toBe("Chief (Claude)");
  });

  it("counts today's decisions vs escalations from the agent log (Jakarta day only)", () => {
    log("choose_plan");
    log("price_by_weight");
    log("choose_printer", false);                 // refused: not a decision
    log("create_operator_task");
    log("request_human_decision");
    log("message_customer");
    log("release_escrow");
    log("refund_escrow", false);                  // held by the policy: not a settlement
    log("choose_plan", true, at("23:30", "2026-10-13")); // yesterday
    log("choose_plan", true, at("10:00"), "human");     // a person
    store.addMessage({ id: "M-1", orderId: "ORD-001", text: "Harga siap", by: "agent", at: at("10:05") });
    const t = chiefAuthority(NOW).today;
    expect(t).toEqual({
      day: "2026-10-14", decisions: 3, escalations: 1, messages: 1, settlements: 1, refusals: 2,
      bySkill: { Finance: 2, Operations: 2, Machines: 1, Quality: 0, Customer: 1 },
    });
  });
});

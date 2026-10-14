import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { createOrder } from "../actions";
import { quoteByWeight } from "../agreement";
import { dailyFacts, jakartaDay } from "./daily-review";
import { ACTION_TOOLS, SKILLS, skillOf } from "./skills";
import { callTool, LLM_TOOLS, materialConcern } from "./tools";
import { chiefAuthority } from "./authority";
import { systemPrompt } from "./chief";
import type { Spec } from "../types";

const NOW = new Date("2026-10-14T15:00:00+07:00");
const at = (hhmm: string) => new Date(`2026-10-14T${hhmm}:00+07:00`).toISOString();
const SPEC: Spec = {
  dimensions: "60 × 30 × 15 mm", toleranceMm: 0.3, material: "PLA", color: "Hitam", layerMm: 0.2, infillPct: 20,
  finishing: "Standar", promise: "Every unit is checked.",
};

beforeEach(() => {
  process.env.IDR_PER_USDC = "16000";
  store.resetDb();
});
afterAll(() => { delete process.env.IDR_PER_USDC; });

function order(product: string, note?: string): string {
  const r = createOrder({ product, customerNote: note, quantity: 10, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 100_000_000, label: "real", customerName: "Aini" });
  if (!r.ok) throw new Error(r.error);
  store.saveOrder({ ...r.order, slicerGrams: { gramsPerUnit: 16, source: "Bambu Studio", by: "operator", at: "" } });
  return r.order.id;
}
const price = (id: string) => callTool("price_by_weight", { orderId: id, gramsPerUnit: 16, source: "Bambu Studio" });

describe("one Chief, five skills", () => {
  it("labels each step from the tool in code, operator tasks by their kind", () => {
    expect(skillOf("price_by_weight")).toBe("Finance");
    expect(skillOf("choose_plan")).toBe("Operations");
    expect(skillOf("request_human_decision")).toBe("Operations");
    expect(skillOf("choose_printer")).toBe("Machines");
    expect(skillOf("message_customer")).toBe("Customer");
    expect(skillOf("release_escrow")).toBe("Finance");
    expect(skillOf("create_operator_task", { kind: "change_filament" })).toBe("Machines");
    expect(skillOf("create_operator_task", { kind: "collect_and_qc" })).toBe("Quality");
    expect(skillOf("create_operator_task", { kind: "reprint" })).toBe("Quality");
    expect(skillOf("something_new")).toBe("Operations");
  });

  it("every tool the LLM gets has a skill of its own (none falls back by accident)", () => {
    for (const t of LLM_TOOLS) expect(SKILLS).toContain(skillOf(t.name));
    const unmapped = LLM_TOOLS.map((t) => t.name).filter((n) => n !== "create_operator_task" && skillOf(n) === "Operations")
      .filter((n) => !["get_order", "get_quotes", "choose_plan", "request_human_decision"].includes(n));
    expect(unmapped).toEqual([]);
  });

  it("the authority card counts today's actions per skill, and only the agent's successful actions", () => {
    const log = (tool: string, input: unknown = {}, ok = true, actor: "agent" | "human" = "agent") =>
      store.addLog({ orderId: "ORD-001", actor, tool, input, ok, output: {}, at: at("10:00") });
    log("price_by_weight");
    log("get_order");                                       // a read: not an action
    log("create_operator_task", { kind: "collect_and_qc" });
    log("create_operator_task", { kind: "check_printer" });
    log("message_customer");
    log("choose_plan", {}, false);                          // refused
    log("link_printer", {}, true, "human");                 // a person
    expect(ACTION_TOOLS).not.toContain("get_order");
    expect(chiefAuthority(NOW).today.bySkill).toEqual({ Finance: 1, Operations: 0, Machines: 1, Quality: 1, Customer: 1 });
  });

  it("lists what always goes to a person, and says honestly what only the instructions hold", () => {
    const a = chiefAuthority(NOW);
    expect(a.handedToPerson.map((h) => h.id)).toEqual(expect.arrayContaining(["qc", "printability", "material", "price_change", "money", "unknown", "disputes"]));
    expect(a.handedToPerson.find((h) => h.id === "disputes")!.enforcedBy).toBe("instructions");
    expect(a.handedToPerson.find((h) => h.id === "material")!.enforcedBy).toBe("code");
    for (const s of SKILLS) expect(a.decidesAlone.some((d) => d.skill === s)).toBe(true);
    expect(a.decidesAlone.find((d) => d.id === "qc_task")!.skill).toBe("Quality");
  });
});

describe("know your limits", () => {
  it("the Chief may only price plain PLA: another material in the order goes to a person, who can still price it", () => {
    const id = order("Casing korek", "Pakai PETG ya, warna hitam");
    expect((callTool("get_order", { orderId: id }).data as { pricingBlockedBy: string | null }).pricingBlockedBy).toContain('"PETG"');
    const r = price(id);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.data)).toContain('mentions \\"PETG\\"');
    expect(store.listQuotes(id)).toHaveLength(0);
    // The spec form starts at "PLA": a saved spec does not clear what the customer wrote.
    store.saveOrder({ ...store.getOrder(id)!, spec: SPEC });
    expect(price(id).ok).toBe(false);
    // A person prices it on the order page.
    expect(quoteByWeight(id, { gramsPerUnit: 16, source: "Bambu Studio, PETG profile", by: "human" }).ok).toBe(true);
  });

  it("checks the material before asking for grams, so the Chief does not ask for numbers it may not use", () => {
    const id = order("Gantungan kunci TPU fleksibel");
    store.saveOrder({ ...store.getOrder(id)!, slicerGrams: undefined });
    expect(JSON.stringify(price(id).data)).toContain("TPU");
  });

  it("the spec must be plain PLA: filled, mixed or undecided PLA goes to a person", () => {
    for (const material of ["TPU 95A", "PLA-CF", "PLA CF", "PLA/PETG", "PLA atau PETG", "PLA + TPU", "PLA Glow"]) {
      expect(materialConcern({ product: "Gantungan kunci", spec: { ...SPEC, material } })).toContain(`"${material}"`);
    }
    for (const material of ["PLA", "pla", "PLA+", "PLA Basic", "PLA Matte", "PLA Silk", "PLA Tough+"]) {
      expect(materialConcern({ product: "Gantungan kunci", spec: { ...SPEC, material } })).toBeNull();
    }
  });

  it("knows Indonesian and code-style material names, and does not flag a name or short codes", () => {
    for (const product of ["casing nilon", "bracket serat karbon", "polikarbonat cover", "holder bahan lentur", "Gantungan kunci TPU95A", "PLA-CF bracket", "case ASA"]) {
      expect(materialConcern({ product })).not.toBeNull();
    }
    for (const product of ["Casing korek PLA matte", "Stand for a PC monitor, CF look", "Hadiah untuk Asa", "Casing korek"]) {
      expect(materialConcern({ product })).toBeNull();
    }
    expect(price(order("Casing korek")).ok).toBe(true);
  });

  it("an escalation carries the Chief's recommendation, and asking again does not open a second task", () => {
    const id = order("Casing korek", "PETG");
    const ask = (recommendation: string) =>
      callTool("request_human_decision", { orderId: id, question: "The note asks for PETG. Which material?", recommendation });
    expect(ask("Print in PLA; PETG is not priced").ok).toBe(true);
    expect(ask("Quote PETG at a higher rate").ok).toBe(true);
    const open = store.listTasks(id).filter((t) => t.kind === "needs_info" && t.status === "open");
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe("The note asks for PETG. Which material?\nChief's recommendation: Print in PLA; PETG is not priced");
  });

  it("a reprint is a QC decision: the Chief may suggest it, not order it", () => {
    const id = order("Casing korek");
    const r = callTool("create_operator_task", { orderId: id, kind: "reprint", text: "Reprint, the corners lifted" });
    expect(r.ok).toBe(false);
    expect(store.listTasks(id)).toHaveLength(0);
    expect(LLM_TOOLS.find((t) => t.name === "create_operator_task")!.inputSchema).not.toMatchObject({ properties: { kind: { enum: expect.arrayContaining(["reprint"]) } } });
  });

  it("counts each action once, also when the tool and the code it calls both log it", () => {
    const id = order("Casing korek");
    callTool("request_human_decision", { orderId: id, question: "Grams per unit?" });
    callTool("create_operator_task", { orderId: id, kind: "collect_and_qc", text: "Collect and QC" });
    const a = chiefAuthority(new Date());
    expect(a.today.bySkill).toMatchObject({ Operations: 1, Quality: 1 });
    expect(dailyFacts(jakartaDay(), new Date()).chief).toMatchObject({ decisions: 1, escalations: 1, refusals: 0 });
  });

  it("the Chief's instructions name what it must always hand to a person", () => {
    const p = systemPrompt();
    expect(p).toContain("Know your limits");
    expect(p).toContain("Whether a print passes QC");
    expect(p).toContain("Unknown is not OK");
    expect(p).toContain("never retry the same step");
    expect(p).toContain("one Chief with five skills");
  });
});

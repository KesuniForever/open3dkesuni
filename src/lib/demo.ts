// Demo center. Each scenario makes ONE new order labelled "simulated" through the real engine (the same functions
// the operator's forms call: createOrder, quoteByWeight, chooseQuote, approveByOwner, addEvidence, recordAcceptance),
// so the operator can walk it through on the order page. It never calls escrow or Circle (no USDC moves), never
// wakes the Chief, and never touches another order. Weights are sample numbers, said so in the quote's source.
import * as store from "./store";
import { addEvidence, approveByOwner, chooseQuote, createOrder, recordAcceptance, type Fail } from "./actions";
import { quoteByWeight, setSpec } from "./agreement";
import { idrToMicro } from "./costing";
import { ownerRuleReasons, ownerRules } from "./owner-rules";
import { MAX_GRAMS_PER_UNIT, priceByWeight, pricingConfig } from "./pricing";
import { notReadyReason } from "./printer/actions";
import type { Order, OrderStatus, Quote } from "./types";
import { makeT, type T } from "../i18n/core";

export type ScenarioId = "smooth" | "above-limit" | "below-minimum" | "late-deadline" | "customer-rejects" | "printer-offline";

export interface DemoScenario {
  id: ScenarioId;
  title: string;
  tag: string;
  /** One line on the tile. */
  line: string;
  /** What it sets up and what to try next (behind the ⓘ). */
  detail: string;
  duration: string;
  /** The demo order's customer name: how a demo order is recognised again. */
  customerName: string;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: "smooth", title: "Smooth order", tag: "Start here", duration: "2 min", customerName: "Demo: smooth order",
    line: "A small PLA order inside the owner's rules, priced by weight.",
    detail: "Creates the order, prices it by weight and chooses Kesuni's own plan. Next on the order page: the agreement and the customer link.",
  },
  {
    id: "above-limit", title: "Above the owner's limit", tag: "Test the safeguard", duration: "1 min", customerName: "Demo: above the owner's limit",
    line: "50 lighter cases. The plan is refused until the owner says yes.",
    detail: "The owner's rule refuses the plan and a task asks the owner. Approve or decline under Owner's rules; after an approval the Chief chooses the plan (a paid Claude call).",
  },
  {
    id: "below-minimum", title: "Below the minimum", tag: "Owner rules", duration: "1 min", customerName: "Demo: below the minimum",
    line: "One keychain. Refused, then allowed as an owner exception.",
    detail: "Refused under the owner's minimum, then approved by a demo owner for this one quote at this price, then the plan is chosen. The full exception trail is on the order page.",
  },
  {
    id: "late-deadline", title: "Late deadline", tag: "Deadline (SLA)", duration: "1 min", customerName: "Demo: late deadline",
    line: "Due today. No plan can finish in time, and no one can override it.",
    detail: "The plan is refused because it finishes after the deadline; the owner cannot lift this rule. The heartbeat flags it within minutes and may wake the Chief (a paid Claude call).",
  },
  {
    id: "customer-rejects", title: "Customer rejects", tag: "Refund path", duration: "2 min", customerName: "Demo: customer rejects",
    line: "Printed and checked, then rejected. Stops before any money moves.",
    detail: "Plan, print log and QC are recorded, then the customer rejects. No escrow was opened, so no USDC moves. With a funded escrow, the refund runs in code after the rejection, checked by the policy engine.",
  },
  {
    id: "printer-offline", title: "Printer goes offline", tag: "Machines", duration: "1 min", customerName: "Demo: printer goes offline",
    line: "An order in production. See how a silent printer becomes a task.",
    detail: "Creates an order in production with no printer linked (no printer data is faked). When a linked printer sends no report for 2 minutes, the heartbeat opens a check-printer task. Free: no Claude call.",
  },
];

/** A demo order: simulated, made by a scenario. A real order never counts, whatever its name. */
export const isDemoOrder = (o: Order): boolean => o.label === "simulated" && (o.customerName ?? "").startsWith("Demo: ");

export const scenarioOf = (o: Order): DemoScenario | undefined => DEMO_SCENARIOS.find((s) => s.customerName === o.customerName);

const rp = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
/** The page texts below are English unless the page passes its t() (src/i18n). */
const EN: T = makeT("en", {});

// ---------- scenario setups ----------

type Band = "inside" | "above" | "below";
interface Setup { product: string; quantity: number; gramsPerUnit: number; band: Band; dueToday?: boolean }

const SETUP: Record<ScenarioId, Setup> = {
  smooth: { product: "Phone stand (PLA)", quantity: 10, gramsPerUnit: 12, band: "inside" },
  "above-limit": { product: "Lighter case (PLA)", quantity: 50, gramsPerUnit: 16, band: "above" },
  "below-minimum": { product: "Name keychain (PLA)", quantity: 1, gramsPerUnit: 8, band: "below" },
  "late-deadline": { product: "Desk organizer (PLA)", quantity: 4, gramsPerUnit: 60, band: "inside", dueToday: true },
  "customer-rejects": { product: "Wall hook (PLA)", quantity: 6, gramsPerUnit: 15, band: "inside" },
  "printer-offline": { product: "Cable clip set (PLA)", quantity: 20, gramsPerUnit: 5, band: "inside" },
};

const SPEC: Partial<Record<ScenarioId, Record<string, unknown>>> = {
  smooth: {
    dimensions: "80 × 70 × 95 mm", toleranceMm: 0.5, material: "PLA", color: "Black", layerMm: 0.2, infillPct: 15,
    finishing: "Standard", promise: "Holds a phone upright, smooth edges, size within ±0.5 mm",
  },
  "customer-rejects": {
    dimensions: "40 × 20 × 55 mm", toleranceMm: 0.5, material: "PLA", color: "White", layerMm: 0.2, infillPct: 30,
    finishing: "Standard", promise: "Each hook holds a 2 kg coat without bending",
  },
};

const NOTE = "Made by the Demo center. Simulated: no real customer, no money.";
const SOURCE = "Demo center: sample weight, not from the slicer";
const DAY = 86_400_000;
/** A date in Jakarta time (the owner's calendar), days from now. */
const jakartaDate = (now: Date, plusDays: number) => new Date(now.getTime() + 7 * 3_600_000 + plusDays * DAY).toISOString().slice(0, 10);

/**
 * Grams per unit that land the order's total in the band the scenario needs under the owner's rules as configured
 * now (.env.local can change them). The realistic sample weight is kept when it fits; null when nothing fits.
 */
export function fitGrams(base: number, quantity: number, band: Band): number | null {
  const r = ownerRules();
  const cfg = pricingConfig();
  const total = (g: number) => {
    const p = priceByWeight(g, quantity, cfg);
    return p.ok ? p.price.totalIdr : NaN;
  };
  // 5% away from each limit, so the rupiah/USDC tolerance of the owner's rules cannot flip the outcome.
  const fits = (idr: number) =>
    band === "above" ? idr > r.approvalAboveIdr * 1.05
      : band === "below" ? idr < r.minOrderIdr * 0.95
        : idr >= r.minOrderIdr * 1.05 && idr <= r.approvalAboveIdr * 0.95;
  if (fits(total(base))) return base;
  const perGram = quantity * cfg.pricePerGramIdr;
  if (perGram <= 0) return null;
  const target = band === "above" ? r.approvalAboveIdr * 1.2 : band === "below" ? r.minOrderIdr * 0.5 : (r.minOrderIdr + r.approvalAboveIdr) / 2;
  const g = Math.round((target / perGram) * 10) / 10;
  return g > 0 && g <= MAX_GRAMS_PER_UNIT && fits(total(g)) ? g : null;
}

class StepFailed extends Error {
  constructor(readonly fail: Fail) { super(fail.error); }
}
const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
function must<T extends { ok: true }>(r: T | Fail): T {
  if (!r.ok) throw new StepFailed(r);
  return r;
}

export type ScenarioResult = { ok: true; orderId: string; steps: string[] } | (Fail & { orderId?: string });

/** Run one scenario: one new simulated order, set up as far as the scenario goes. */
export function runScenario(id: string, now: Date = new Date()): ScenarioResult {
  const sc = DEMO_SCENARIOS.find((s) => s.id === id);
  if (!sc) return fail(404, "Unknown scenario");
  const setup = SETUP[sc.id];
  const grams = fitGrams(setup.gramsPerUnit, setup.quantity, setup.band);
  if (grams === null) return fail(409, "The owner's rules leave no price for this scenario", [`Check the limits in .env.local (scenario: ${sc.title})`]);
  const priced = priceByWeight(grams, setup.quantity);
  if (!priced.ok) return fail(409, "Invalid sample weight", priced.reasons);
  // Budget a quarter above the price, so only the owner's rules decide (never the budget).
  const mandateMicro = Math.ceil((idrToMicro(priced.price.totalIdr) * 1.25) / 1e6) * 1e6;

  const created = createOrder({
    product: setup.product, quantity: setup.quantity, deadline: jakartaDate(now, setup.dueToday ? 0 : 14), designVersion: "v1",
    mandateMicro, label: "simulated", customerName: sc.customerName, customerNote: NOTE,
  });
  if (!created.ok) return created;
  const orderId = created.order.id;
  const steps = [`Order ${orderId} created (simulated)`];
  try {
    if (SPEC[sc.id]) {
      must(setSpec(orderId, SPEC[sc.id]!));
      steps.push("Spec and quality promise set");
    }
    const quote = must(quoteByWeight(orderId, { gramsPerUnit: grams, source: SOURCE, by: "human" })).quote;
    steps.push(`Priced by weight: ${setup.quantity} × ${grams} g = ${rp(priced.price.totalIdr)}`);
    BUILD[sc.id](orderId, quote, steps);
    store.addLog({ orderId, actor: "human", tool: "demo_scenario", input: { scenario: sc.id }, ok: true, output: { steps }, at: new Date().toISOString() });
    return { ok: true, orderId, steps };
  } catch (e) {
    if (e instanceof StepFailed) return { ...e.fail, orderId };
    throw e;
  }
}

const choose = (orderId: string, quote: Quote, reason: string) => must(chooseQuote(orderId, quote.id, "human", `Demo: ${reason}`));

/** The plan must be refused here: that refusal is what the scenario shows. */
function refused(orderId: string, quote: Quote): string[] {
  const r = chooseQuote(orderId, quote.id, "human", "Demo: try the plan");
  if (r.ok) throw new StepFailed(fail(409, "The owner's rules did not refuse this plan; check the limits in .env.local"));
  return r.reasons ?? [r.error];
}

/** A question for a person, like the one the Chief opens when it escalates. Keeps the heartbeat from waking it. */
function ask(orderId: string, text: string): void {
  store.saveTask({ id: store.nextTaskId(), orderId, kind: "needs_info", text, status: "open", createdBy: "human", at: new Date().toISOString() });
}

const BUILD: Record<ScenarioId, (orderId: string, quote: Quote, steps: string[]) => void> = {
  smooth(orderId, quote, steps) {
    choose(orderId, quote, "Kesuni's own plan by weight, inside the owner's rules");
    steps.push("Plan chosen");
  },
  "above-limit"(orderId, quote, steps) {
    const reasons = refused(orderId, quote);
    steps.push(`Plan refused: ${reasons.join("; ")}`);
    ask(orderId, `Demo: ${reasons.join("; ")}. Approve or decline the exception under Owner's rules.`);
    steps.push("Task opened: the owner decides");
  },
  "below-minimum"(orderId, quote, steps) {
    steps.push(`Plan refused: ${refused(orderId, quote).join("; ")}`);
    must(approveByOwner(orderId, { quoteId: quote.id, by: "Owner (demo)", note: "Demo: small pilot order, allowed once" }));
    steps.push("Owner exception for this quote at this price");
    choose(orderId, quote, "owner exception recorded; plan inside the other rules");
    steps.push("Plan chosen");
  },
  "late-deadline"(orderId, quote, steps) {
    const reasons = refused(orderId, quote);
    steps.push(`Plan refused: ${reasons.join("; ")}`);
    ask(orderId, `Demo: ${reasons.join("; ")}. Ask the customer for a later date, or decline the order.`);
    steps.push("Task opened: talk to the customer");
  },
  "customer-rejects"(orderId, quote, steps) {
    choose(orderId, quote, "Kesuni's own plan by weight, inside the owner's rules");
    must(addEvidence(orderId, { kind: "log", note: "Demo: 6 wall hooks printed", label: "simulated" }));
    must(addEvidence(orderId, { kind: "qc", note: "Demo: QC at Kesuni, size within ±0.5 mm", label: "simulated" }));
    steps.push("Plan chosen, print log and QC recorded");
    must(recordAcceptance(orderId, { accepted: false, by: "Demo customer", note: "Demo: the hooks bend under a heavy coat" }));
    steps.push("Customer rejected. No escrow, so no USDC moved");
  },
  "printer-offline"(orderId, quote, steps) {
    choose(orderId, quote, "Kesuni's own plan by weight, inside the owner's rules");
    must(addEvidence(orderId, { kind: "log", note: "Demo: production started (no printer linked)", label: "simulated" }));
    steps.push("Plan chosen, production started");
  },
};

// ---------- what the page shows ----------

/** One real number per tile: the rule or the live state the scenario is about. */
export function demoFacts(t: T = EN): Record<ScenarioId, string> {
  const r = ownerRules();
  const cfg = pricingConfig();
  const printers = store.listPrinters();
  const online = printers.filter((p) => !(notReadyReason(p) ?? "").startsWith("offline")).length;
  return {
    smooth: t("{price} per gram, own studio", { price: rp(cfg.pricePerGramIdr) }),
    "above-limit": t("Owner approval above {amount}", { amount: rp(r.approvalAboveIdr) }),
    "below-minimum": t("Owner minimum {amount}", { amount: rp(r.minOrderIdr) }),
    "late-deadline": t("24 h prep + {rate} g/h of printing", { rate: cfg.gramsPerHour * cfg.printerCount }),
    "customer-rejects": t("No escrow opened: no USDC moves"),
    "printer-offline": printers.length
      ? t("Live: {online} of {total} printers online", { online, total: printers.length })
      : t("No printers connected yet"),
  };
}

export type Tone = "ok" | "warn" | "bad" | "";
export interface DemoOrderRow {
  orderId: string;
  scenario: string;
  product: string;
  quantity: number;
  status: OrderStatus;
  deadline: string;
  createdAt?: string;
  /** Where the order stands now, in a few words. */
  now: string;
  tone: Tone;
}

/** Where a demo order stands now, from the store. */
export function demoState(o: Order, now = Date.now(), t: T = EN): { now: string; tone: Tone } {
  const escrow = store.getEscrow(o.id);
  switch (o.status) {
    case "CREATED": {
      const checks = store.listQuotes(o.id).map((q) => ownerRuleReasons(o, q, now));
      if (checks.length === 0) return { now: t("Needs a price"), tone: "warn" };
      if (checks.some((c) => c.reasons.length === 0)) return { now: t("Ready to choose a plan"), tone: "" };
      if (checks.some((c) => c.ownerCanApprove)) return { now: t("Waiting for the owner"), tone: "warn" };
      return { now: t("No plan fits the rules"), tone: "bad" };
    }
    case "PLAN_CHOSEN":
      return escrow
        ? { now: t("Escrow {state}", { state: t(escrow.state.toLowerCase().replace("_", " ")) }), tone: "" }
        : { now: t("Plan chosen, not paid"), tone: "" };
    case "IN_PRODUCTION": return { now: t("In production"), tone: "" };
    case "EVIDENCE_SUBMITTED": return { now: t("QC done, customer decides"), tone: "warn" };
    case "ACCEPTED": return { now: t("Accepted"), tone: "ok" };
    case "PAID": return { now: t("Paid out"), tone: "ok" };
    case "REJECTED":
      return escrow
        ? { now: t("Rejected, escrow {state}", { state: t(escrow.state.toLowerCase()) }), tone: "bad" }
        : { now: t("Rejected, no money moved"), tone: "bad" };
  }
}

/** Demo orders, newest first. */
export function demoOrders(now = Date.now(), t: T = EN): DemoOrderRow[] {
  return store.listOrders().filter(isDemoOrder).reverse().map((o) => ({
    orderId: o.id, scenario: scenarioOf(o)?.title ?? (o.customerName ?? "").replace(/^Demo: /, ""),
    product: o.product, quantity: o.quantity, status: o.status, deadline: o.deadline, createdAt: o.createdAt,
    ...demoState(o, now, t),
  }));
}

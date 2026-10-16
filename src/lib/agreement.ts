// The agreement between Kesuni and the customer: what will be made (spec), how quality is checked,
// and the price, fixed by a SHA-256 fingerprint. The customer approves it before paying; changing
// the spec, product, quantity, deadline or price changes the fingerprint and needs a new approval.
// Also: Kesuni's own quote, by weight (the official price) or from the cost calculator (a check), and
// the operator's report of what production actually used (plan vs actual).
import { createHash } from "node:crypto";
import * as store from "./store";
import { addQuote, type Fail } from "./actions";
import { calculate, costingEtaHours, idrToMicro, parseCostInput, type CostResult } from "./costing";
import { orderMaterial, parseColorMode, priceByWeight, pricingConfig, pricingFor, toMaterial, type WeightPrice } from "./pricing";
import { BAD_FINISHING, specFinishing, specMaterial } from "./spec-choices";
import type { ActualReport, Agreement, GramPricing, Order, Quote, Spec } from "./types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const PAYABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];

/** Money has started moving into (or out of) escrow: the agreement can no longer change. */
function locked(orderId: string): boolean {
  const e = store.getEscrow(orderId);
  if (!e) return false;
  return e.state !== "AWAITING_DEPOSIT" || e.txs.some((t) => t.kind === "deposit" && !["FAILED", "DENIED", "CANCELLED"].includes(t.state));
}

// The material is in the fingerprint through spec.material (setSpec keeps order.material in line with it). The
// colours the customer picked (preferredColors) are a wish, not the promise: spec.color is what Kesuni promises. So the
// document is unchanged and agreements made before these fields existed stay valid.
export function agreementHash(order: Order, quote: Quote): string {
  const doc = {
    orderId: order.id, product: order.product, quantity: order.quantity, deadline: order.deadline,
    designVersion: order.designVersion, spec: order.spec ?? null, quoteId: quote.id, priceMicro: quote.priceMicro,
  };
  return createHash("sha256").update(JSON.stringify(doc)).digest("hex");
}

/** The agreement the customer approved still matches the order as it is now. */
export function agreementCurrent(order: Order): boolean {
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  return Boolean(order.agreement && quote && order.agreement.hash === agreementHash(order, quote));
}

// ---------- spec ----------

export function setSpec(orderId: string, raw: Record<string, unknown>): { ok: true; order: Order } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (locked(orderId)) return fail(409, "The customer has paid on this agreement; the spec can no longer change");
  if (!["CREATED", ...PAYABLE].includes(order.status)) return fail(409, `Order is ${order.status}; the spec is closed`);
  const text = (k: string, max = 200) => String(raw[k] ?? "").trim().slice(0, max);
  const num = (k: string) => Number(raw[k]);
  // Material and finishing are choices, stored in English; an older free-text value is kept while it is unchanged.
  const material = specMaterial(text("material"), order.spec?.material, order.material ?? "PLA");
  const finishing = specFinishing(text("finishing"), order.spec?.finishing);
  const spec: Spec = {
    dimensions: text("dimensions"), toleranceMm: num("toleranceMm"), material: material ?? "",
    color: text("color"), layerMm: num("layerMm"), infillPct: num("infillPct"),
    finishing: finishing ?? "", promise: text("promise", 500),
  };
  const r: string[] = [];
  if (material === null) r.push("Material must be PLA or PETG");
  if (finishing === null) r.push(BAD_FINISHING);
  if (!spec.dimensions) r.push("Dimensions are required");
  if (!(spec.toleranceMm >= 0 && spec.toleranceMm <= 10)) r.push("Tolerance must be 0–10 mm");
  if (!(spec.layerMm > 0 && spec.layerMm <= 1)) r.push("Layer height must be above 0 and at most 1 mm");
  if (!(spec.infillPct >= 0 && spec.infillPct <= 100)) r.push("Infill must be 0–100%");
  if (!spec.promise) r.push("Say how the result will be checked (the quality promise)");
  if (r.length) return fail(400, "Invalid spec", r);
  // The spec is the person's latest word on the material: the order's material follows it, so the price per gram and
  // the Chief's material check (it hands a spec that disagrees with the order to a person) read the same material.
  const m = toMaterial(spec.material);
  const updated: Order = { ...order, spec, ...(m ? { material: m } : {}) };
  store.saveOrder(updated);
  return { ok: true, order: updated };
}

// ---------- price from the calculator ----------

export function quoteFromCosting(
  orderId: string, raw: Record<string, unknown>,
): { ok: true; quote: Quote; result: CostResult; overBudget: boolean } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const parsed = parseCostInput({ ...raw, quantity: raw.quantity ?? order.quantity });
  if (!parsed.ok) return fail(400, "Invalid cost input", parsed.reasons);
  const input = parsed.input;
  if (input.quantity !== order.quantity) return fail(400, `Quantity must match the order (${order.quantity})`);
  const result = calculate(input);
  if (result.revenueIdr <= 0) return fail(400, "Price must be above zero");
  const etaHours = Math.max(1, Math.ceil(Number(raw.etaHours) || costingEtaHours(input)));
  const q = addQuote(orderId, { vendorId: "own", priceMicro: idrToMicro(result.revenueIdr), etaHours });
  if (!q.ok) return q;
  store.saveOrder({ ...store.getOrder(orderId)!, costing: { input, quoteId: q.quote.id, at: new Date().toISOString() } });
  store.addLog({
    orderId, actor: "human", tool: "price_from_costing", ok: true, at: new Date().toISOString(),
    input: { unitPriceIdr: input.unitPriceIdr, quantity: input.quantity },
    output: { quoteId: q.quote.id, revenueIdr: result.revenueIdr, costIdr: result.businessCostIdr, marginPct: result.marginPct },
  });
  return { ok: true, quote: q.quote, result, overBudget: q.quote.priceMicro > order.mandateMicro };
}

// ---------- official price: by weight ----------

const BAD_COLOR = 'Colour mode must be "single" or "multi"';

/**
 * Kesuni's own quote from grams per unit (Bambu Studio). Orders in CREATED only. Re-pricing replaces the
 * previous by-weight quote when nobody chose or agreed to it, so quotes do not pile up. colorMode (single colour
 * when missing) sets the print time and so the ETA; the price per gram stays the same.
 */
export function quoteByWeight(
  orderId: string,
  input: { gramsPerUnit: number; source: string; etaHours?: unknown; by: "agent" | "human"; colorMode?: unknown },
): { ok: true; quote: Quote; price: WeightPrice; gramPricing: GramPricing } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; quotes are closed`);
  const source = String(input.source ?? "").trim().slice(0, 300);
  if (!source) return fail(400, "Say where the grams come from (slicer, operator note)");
  if (input.by !== "agent" && input.by !== "human") return fail(400, 'by must be "agent" or "human"');
  const colorMode = parseColorMode(input.colorMode);
  if (!colorMode) return fail(400, BAD_COLOR);
  // The order's material sets the price per gram (PETG may differ from PLA in the config).
  const r = priceByWeight(Number(input.gramsPerUnit), order.quantity, colorMode, pricingFor(pricingConfig(), orderMaterial(order)));
  if (!r.ok) return fail(400, "Invalid weight", r.reasons);
  const p = r.price;
  const eta = Number(input.etaHours);
  const given = input.etaHours !== undefined && input.etaHours !== "" && Number.isFinite(eta) && eta > 0 ? Math.ceil(eta) : null;
  // The SLA rule checks this ETA, so the agent may only make it longer; only a person may shorten it.
  const etaHours = given === null ? p.etaHours : input.by === "agent" ? Math.max(given, p.etaHours) : given;
  const q = addQuote(orderId, { vendorId: "own", priceMicro: idrToMicro(p.totalIdr), etaHours });
  if (!q.ok) return q;

  const previous = order.gramPricing?.quoteId;
  const touched = previous && (previous === order.chosenQuoteId || previous === order.agreement?.quoteId);
  if (previous && !touched) store.deleteQuote(previous);
  const gramPricing: GramPricing = {
    gramsPerUnit: p.gramsPerUnit, quantity: p.quantity, pricePerGramIdr: p.pricePerGramIdr, costPerGramIdr: p.costPerGramIdr,
    unitPriceIdr: p.unitPriceIdr, totalIdr: p.totalIdr, costIdr: p.costIdr, source, colorMode, quoteId: q.quote.id, by: input.by,
    at: new Date().toISOString(),
  };
  const current = store.getOrder(orderId)!;
  // The owner approved the quote that was just replaced: that approval does not carry over to the new price.
  const ownerApproval = previous && !touched && current.ownerApproval?.quoteId === previous ? undefined : current.ownerApproval;
  // A person's grams are trusted grams for the agent too.
  const slicerGrams = input.by === "human" ? { gramsPerUnit: p.gramsPerUnit, source, by: "operator", at: gramPricing.at, colorMode } : current.slicerGrams;
  store.saveOrder({ ...current, gramPricing, ownerApproval, slicerGrams });
  // The agent's calls are logged by callTool; log people here.
  if (input.by === "human") {
    store.addLog({
      orderId, actor: "human", tool: "price_by_weight", ok: true, at: gramPricing.at,
      input: { gramsPerUnit: p.gramsPerUnit, source, colorMode },
      output: {
        quoteId: q.quote.id, unitPriceIdr: p.unitPriceIdr, totalIdr: p.totalIdr, marginPct: p.marginPct, etaHours,
        replaced: previous && !touched ? previous : undefined,
      },
    });
  }
  return { ok: true, quote: q.quote, price: p, gramPricing };
}

/**
 * A person at Kesuni enters grams per unit from the slicer (Bambu Studio), and whether it prints in one colour or
 * several (single colour when missing). The agent prices only with these grams, never with numbers from the
 * customer's note or product name, and its ETA uses this colour mode. Orders in CREATED only.
 */
export function setSlicerGrams(
  orderId: string, input: { gramsPerUnit: number; source: string; by: string; colorMode?: unknown },
): { ok: true; order: Order } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; quotes are closed`);
  const source = String(input.source ?? "").trim().slice(0, 300);
  const by = String(input.by ?? "").trim().slice(0, 80);
  const r = priceByWeight(Number(input.gramsPerUnit), order.quantity);
  if (!r.ok) return fail(400, "Invalid weight", r.reasons);
  if (!source) return fail(400, "Say where the grams come from (slicer, plate, settings)");
  if (!by) return fail(400, "Who entered the grams is required");
  const colorMode = parseColorMode(input.colorMode);
  if (!colorMode) return fail(400, BAD_COLOR);
  const slicerGrams = { gramsPerUnit: r.price.gramsPerUnit, source, by, at: new Date().toISOString(), colorMode };
  const updated = { ...order, slicerGrams };
  store.saveOrder(updated);
  store.addLog({
    orderId, actor: "human", tool: "slicer_grams", input: { gramsPerUnit: slicerGrams.gramsPerUnit, source, colorMode }, ok: true,
    output: { by }, at: slicerGrams.at,
  });
  return { ok: true, order: updated };
}

/**
 * The studio's slicer weighed the customer's own design (an automatic weighing, src/lib/slicing.ts autoGramsFromSlice):
 * the plate's weight becomes the grams per unit, single colour, by "slicer". Code only: no route, no agent tool and no
 * customer text reaches it, and it never replaces grams that are already there (a person's grams stay).
 */
export function setSlicerGramsFromSlice(
  orderId: string, input: { gramsPerUnit: number; source: string; jobId: string },
): { ok: true; order: Order } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; quotes are closed`);
  if (order.slicerGrams) return fail(409, "The order already has grams per unit: they stay");
  const r = priceByWeight(Number(input.gramsPerUnit), order.quantity);
  if (!r.ok) return fail(400, "Invalid weight", r.reasons);
  const source = String(input.source ?? "").trim().slice(0, 300);
  const slicerGrams = { gramsPerUnit: r.price.gramsPerUnit, source, by: "slicer", at: new Date().toISOString(), colorMode: "single" as const };
  const updated = { ...order, slicerGrams };
  store.saveOrder(updated);
  // Not the Chief's step (actor "agent" counts as one), and asked by the customer's upload: logged like a person's grams.
  store.addLog({
    orderId, actor: "human", tool: "slicer_grams", ok: true, at: slicerGrams.at,
    input: { gramsPerUnit: slicerGrams.gramsPerUnit, source, colorMode: "single", automatic: true, jobId: input.jobId },
    output: { by: "slicer" },
  });
  return { ok: true, order: updated };
}

/** The by-weight price behind the chosen quote, if Kesuni priced it that way. */
export function gramPricingForChosen(order: Order): GramPricing | null {
  return order.gramPricing && order.gramPricing.quoteId === order.chosenQuoteId ? order.gramPricing : null;
}

/** The calculation behind the chosen quote, if Kesuni priced it with the calculator. */
export function costingForChosen(order: Order): CostResult | null {
  if (!order.costing || order.costing.quoteId !== order.chosenQuoteId) return null;
  return calculate(order.costing.input);
}

// ---------- customer approval ----------

export function customerAgree(orderId: string, by: string): { ok: true; agreement: Agreement } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!PAYABLE.includes(order.status)) return fail(409, "The price is not ready to approve yet");
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  if (!quote) return fail(409, "The price is not ready to approve yet");
  if (!by.trim()) return fail(400, "Name is required");
  const hash = agreementHash(order, quote);
  if (order.agreement?.hash === hash) return { ok: true, agreement: order.agreement };
  if (locked(orderId)) return fail(409, "Payment has started; the agreement can no longer change");
  const agreement: Agreement = {
    version: (order.agreement?.version ?? 0) + 1, hash, quoteId: quote.id, priceMicro: quote.priceMicro,
    by: by.trim().slice(0, 80), at: new Date().toISOString(),
  };
  store.saveOrder({ ...order, agreement });
  store.addLog({ orderId, actor: "human", tool: "customer_agreement", input: { version: agreement.version }, ok: true, output: { hash }, at: agreement.at });
  return { ok: true, agreement };
}

// ---------- plan vs actual ----------

export function recordActual(orderId: string, raw: Record<string, unknown>): { ok: true; actual: ActualReport } | Fail {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  if (!["IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "REJECTED", "PAID"].includes(order.status)) {
    return fail(409, "Report what production used after printing has started");
  }
  const n = (k: string) => Number(raw[k]);
  const actual: ActualReport = {
    filamentGrams: n("filamentGrams"), machineHours: n("machineHours"), costIdr: Math.round(n("costIdr")),
    maxDeviationMm: n("maxDeviationMm"), unitsPassed: n("unitsPassed"),
    note: String(raw.note ?? "").trim().slice(0, 500), by: String(raw.by ?? "").trim().slice(0, 80), at: new Date().toISOString(),
  };
  const r: string[] = [];
  for (const k of ["filamentGrams", "machineHours", "costIdr", "maxDeviationMm"] as const) {
    if (!Number.isFinite(actual[k]) || actual[k] < 0) r.push(`${k} must be a number, 0 or more`);
  }
  if (!Number.isInteger(actual.unitsPassed) || actual.unitsPassed < 0 || actual.unitsPassed > order.quantity) {
    r.push(`unitsPassed must be a whole number from 0 to ${order.quantity}`);
  }
  if (!actual.by) r.push("Who measured it is required");
  if (r.length) return fail(400, "Invalid report", r);
  store.saveOrder({ ...order, actual });
  return { ok: true, actual };
}

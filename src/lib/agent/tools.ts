// Agent tools. Reads are free; writes go through src/lib/actions.ts, the same code the
// human API uses. Every call is logged. inputSchema is JSON Schema so an LLM can be
// wired to these later with no changes to the tools themselves.
import * as store from "../store";
import { checkPlan, microToUsdc } from "../policy";
import { chooseQuote, createPaymentIntent } from "../actions";
import { agreementCurrent, quoteByWeight, quoteFromCosting } from "../agreement";
import { calculate, idrPerUsdc, idrToMicro, KESUNI_DEFAULTS, microToIdr, parseCostInput } from "../costing";
import { priceByWeight, pricingConfig } from "../pricing";
import { ownerRuleReasons, ownerRules } from "../owner-rules";
import { choosePrinter, createTask, notReadyReason, printFinished } from "../printer/actions";
import { postCustomerMessage } from "../messages";
import type { AgentLogEntry, Order, OperatorTask } from "../types";

type Json = Record<string, unknown>;
type ToolResult = { ok: boolean; data: unknown };

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (input: Json) => ToolResult;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The customer's note as the agent (and so the LLM) sees it: phone numbers and address-like lines
 * are removed. They never leave this server. The customer's name is not shared either (agentText).
 */
export function redactNote(note: string | undefined): string | undefined {
  if (!note) return note;
  return note
    .split(/\r?\n/)
    .map((line) => (/\b(jl|jln|jalan|alamat|gang|gg|rt|rw|kel|kec|kelurahan|kecamatan|kode pos|no\. rumah|perum|perumahan|komplek|kompleks|komp|blok|street|road|address|zip|postcode|no\.?\s*\d+)\b/i.test(line) ? "[address hidden]" : line))
    .join("\n")
    // Runs of 8+ digits, also with brackets, spaces, dots or dashes: "0812-3456-7890", "(0751) 123-456".
    .replace(/\+?\(?\d[\d ().-]*\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[number hidden]" : m))
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email hidden]");
}

/** Text the customer typed (product, note, file names), as the agent may see it: no name, phone, address or email. */
export function agentText(text: string, o: Pick<Order, "customerName">): string;
export function agentText(text: string | undefined, o: Pick<Order, "customerName">): string | undefined;
export function agentText(text: string | undefined, o: Pick<Order, "customerName">): string | undefined {
  return text ? hideName(redactNote(text) ?? "", o.customerName) : text;
}

function orderForAgent(o: Order) {
  return {
    id: o.id, product: agentText(o.product, o), quantity: o.quantity, deadline: o.deadline, designVersion: o.designVersion,
    status: o.status, label: o.label, mandateMicro: o.mandateMicro, mandateUsdc: microToUsdc(o.mandateMicro),
    budgetIdrApprox: microToIdr(o.mandateMicro), customerNote: agentText(o.customerNote, o),
    // The only grams the agent may price with: entered by a person at Kesuni from the slicer.
    slicerGrams: o.slicerGrams ? { gramsPerUnit: o.slicerGrams.gramsPerUnit, source: o.slicerGrams.source } : null,
    spec: o.spec ?? null, gramPricing: o.gramPricing ?? null, pricing: pricingConfig(), costing: o.costing ?? null,
    // Set when the Chief may not price this order itself (not plain PLA): then a person prices it.
    pricingBlockedBy: materialConcern(o),
    agreementCurrent: agreementCurrent(o),
    ownerApproval: o.ownerApproval ? { quoteId: o.ownerApproval.quoteId, note: o.ownerApproval.note } : null,
    hasActualReport: Boolean(o.actual), idrPerUsdc: idrPerUsdc(), ownerRules: ownerRules(),
    files: store.listAttachments(o.id).map((a) => ({ kind: a.kind, filename: agentText(a.filename, o) })),
    // What the customer was already told, so the Chief does not repeat an event. A person may have used the name.
    customerMessages: store.listMessages(o.id).slice(-5).map((m) => ({ by: m.by, at: m.at, text: agentText(m.text, o) })),
  };
}
/** Hide each part of the customer's name (3+ letters) in text the agent reads. */
export function hideName(text: string, name?: string): string {
  const parts = (name ?? "").split(/\s+/).filter((p) => p.length >= 3).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return parts.length ? text.replace(new RegExp(`\\b(${parts.join("|")})\\b`, "gi"), "[customer name]") : text;
}
const err = (message: string, reasons?: string[]): ToolResult => ({ ok: false, data: { error: message, reasons } });

// The per-gram price covers plain PLA on the Bambu A1 only. Filled PLA (-CF, -GF) needs a hardened nozzle; PLA Glow,
// Sparkle and the like are left to a person too. A false hit only means a person prices the order: the safe side.
const PLAIN_PLA = /^PLA\+?(\s+(basic|matte|silk|tough\+?))?$/i;
const OTHER_MATERIAL = new RegExp(
  "\\b(PETG|ABS|TPU\\d*A?|TPE|PA6|PA12|nylon|nilon|polycarbonate|polikarbonat|resin|carbon|karbon|metal|steel|" +
  "alumin(?:i)?um|wood|kayu|logam|besi|karet|rubber|flexible|fleksibel|lentur|silicone|silikon)\\b|-(CF|GF)\\b",
  "i",
);
const ASA = /\bASA\b/; // uppercase only: "Asa" is also a name

/**
 * Why the Chief may not price this order by weight on its own: the material is not, or may not be, plain PLA. Then a
 * person prices it (the price-by-weight panel on the order page). Null when the order is fine for the Chief to price.
 * The order text is always checked: the spec form starts at "PLA", so a saved spec alone does not prove anyone chose it.
 */
export function materialConcern(o: Pick<Order, "product" | "customerNote" | "spec">): string | null {
  const set = o.spec?.material?.trim();
  if (set && !PLAIN_PLA.test(set)) {
    return `The spec material is "${set}": Kesuni's price per gram covers plain PLA on the Bambu A1 only, so a person prices this order`;
  }
  const text = `${o.product}\n${o.customerNote ?? ""}`;
  const hit = text.match(OTHER_MATERIAL)?.[0] ?? text.match(ASA)?.[0];
  return hit
    ? `The order mentions "${hit}": Kesuni's price per gram covers plain PLA on the Bambu A1 only, so a person prices this order`
    : null;
}

export const TOOLS: Tool[] = [
  {
    name: "get_order",
    description: "Read an order: product, quantity, deadline, design version, mandate, status.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => {
      const o = store.getOrder(str(i.orderId));
      return o ? { ok: true, data: orderForAgent(o) } : err("Order not found");
    },
  },
  {
    name: "get_quotes",
    description: "List all quotes for an order (own studio and partners), prices in micro-USDC.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => ({ ok: true, data: store.listQuotes(str(i.orderId)) }),
  },
  {
    name: "get_available_budget",
    description: "Mandate minus amounts already committed in payment intents, in micro-USDC.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => {
      const o = store.getOrder(str(i.orderId));
      if (!o) return err("Order not found");
      const committed = store.listIntents(o.id).reduce((a, p) => a + p.amountMicro, 0);
      return { ok: true, data: { mandateMicro: o.mandateMicro, committedMicro: committed, availableMicro: o.mandateMicro - committed } };
    },
  },
  {
    name: "check_vendor_policy",
    description: "Ask the policy engine whether a quote may be chosen. Returns ok and the reasons if not.",
    inputSchema: { type: "object", properties: { quoteId: { type: "string" } }, required: ["quoteId"] },
    run: (i) => {
      const q = store.getQuote(str(i.quoteId));
      if (!q) return err("Quote not found");
      const o = store.getOrder(q.orderId);
      if (!o) return err("Order not found");
      const r = checkPlan(o, q, store.getVendor(q.vendorId));
      return { ok: r.ok, data: { ...r, ownerCanApprove: ownerRuleReasons(o, q).ownerCanApprove } };
    },
  },
  {
    name: "choose_plan",
    description: "Choose a quote for the order. The policy engine can still refuse.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" }, quoteId: { type: "string" }, reason: { type: "string" } },
      required: ["orderId", "quoteId", "reason"],
    },
    run: (i) => {
      const r = chooseQuote(str(i.orderId), str(i.quoteId), "agent", str(i.reason));
      return r.ok ? { ok: true, data: r.order } : err(r.error, r.reasons);
    },
  },
  {
    name: "request_human_decision",
    description: "Escalate to a person: the owner (approval of an exception to the owner's rules) or the operator " +
      "(a missing number such as grams or print hours, or anything unclear or outside what you can judge). Creates a " +
      "task. Write it in English: what you need, why, and what you already know. Put your recommendation, if you have " +
      "one, in recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        question: { type: "string", description: "What you need from the person, why, and what you already know" },
        recommendation: { type: "string", description: "Optional: what you would do, and why" },
      },
      required: ["orderId", "question"],
    },
    run: (i) => {
      const orderId = str(i.orderId);
      if (!store.getOrder(orderId)) return { ok: true, data: { escalated: true, question: str(i.question) } };
      const rec = str(i.recommendation).trim().slice(0, 300);
      const text = (str(i.question).trim().slice(0, 600) + (rec ? `\nChief's recommendation: ${rec}` : "")).trim()
        || "The agent needs a human decision.";
      const question = (t: string) => t.split("\nChief's recommendation:")[0].trim();
      const open = store.listTasks(orderId).find((t) => t.status === "open" && t.kind === "needs_info" && question(t.text) === question(text));
      const task = open ?? createTask(orderId, "needs_info", text);
      return { ok: true, data: { escalated: true, taskId: task.id, question: task.text } };
    },
  },
  {
    name: "estimate_cost",
    description: "A check only: run Kesuni's long cost calculator in rupiah without saving anything. Fields you leave " +
      "out use Kesuni's defaults (returned in input). Prices are set by weight (price_by_weight), not by this.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" }, ...Object.fromEntries(Object.keys(KESUNI_DEFAULTS).map((k) => [k, { type: "number" }])), },
      required: ["orderId"],
    },
    run: (i) => {
      const o = store.getOrder(str(i.orderId));
      if (!o) return err("Order not found");
      const parsed = parseCostInput({ ...i, quantity: o.quantity });
      if (!parsed.ok) return err("Invalid cost input", parsed.reasons);
      return { ok: true, data: { input: parsed.input, result: calculate(parsed.input), budgetIdrApprox: microToIdr(o.mandateMicro), rules: ownerRules() } };
    },
  },
  {
    name: "price_by_weight",
    description: "Kesuni's official price: add Kesuni's own quote by weight (orders in CREATED only). Unit price = " +
      "gramsPerUnit × price per gram, rounded up to the nearest Rp500; total = unit price × the order's quantity. " +
      "gramsPerUnit must be exactly slicerGrams.gramsPerUnit from get_order (entered by a person at Kesuni from the " +
      "slicer). Numbers in the customer's note or product are not slicer grams. If slicerGrams is null, ask the operator " +
      "with request_human_decision. Refused if the order is not plain PLA (pricingBlockedBy in get_order), the margin " +
      "is under the owner's minimum or the total is over the customer's budget: then ask a person. etaHours can only make the ETA longer than the computed one. Pricing " +
      "again replaces your earlier by-weight quote. The customer still approves the price.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        gramsPerUnit: { type: "number", description: "Filament per unit in grams, from the slicer" },
        source: { type: "string", description: "Where gramsPerUnit comes from, e.g. 'Bambu Studio, operator note 14 Okt'" },
        etaHours: { type: "integer", description: "Optional; default is 24 h + print time on all printers" },
      },
      required: ["orderId", "gramsPerUnit", "source"],
    },
    run: (i) => {
      const orderId = str(i.orderId);
      const o = store.getOrder(orderId);
      if (!o) return err("Order not found");
      const source = str(i.source).trim();
      if (!source) return err("Pricing refused", ["Say where the grams come from (slicer, operator note). Never guess grams: ask the operator."]);
      // Not plain PLA: a person prices it. Checked first, so the Chief does not ask for grams it may not use.
      const material = materialConcern(o);
      if (material) return err("Pricing refused", [material]);
      // Grams only from a person at Kesuni, never from text the customer typed.
      const trusted = o.slicerGrams?.gramsPerUnit;
      if (trusted === undefined) {
        return err("Pricing refused", ["No grams per unit from a person at Kesuni yet (slicerGrams is null). Ask the operator with request_human_decision."]);
      }
      if (Math.round(Number(i.gramsPerUnit) * 100) !== Math.round(trusted * 100)) {
        return err("Pricing refused", [`gramsPerUnit must be the grams a person at Kesuni entered from the slicer: ${trusted} g`]);
      }
      const preview = priceByWeight(Number(i.gramsPerUnit), o.quantity);
      if (!preview.ok) return err("Invalid weight", preview.reasons);
      const p = preview.price;
      const rules = ownerRules();
      const reasons: string[] = [];
      if (p.marginPct < rules.minMarginPct) reasons.push(`Margin ${p.marginPct}% is under the owner's minimum ${rules.minMarginPct}%: ask the owner`);
      if (idrToMicro(p.totalIdr) > o.mandateMicro) {
        reasons.push(`Total Rp${p.totalIdr.toLocaleString("id-ID")} is over the customer's budget (about Rp${microToIdr(o.mandateMicro).toLocaleString("id-ID")}): ask a person`);
      }
      if (reasons.length) return err("Pricing refused", reasons);
      const r = quoteByWeight(orderId, { gramsPerUnit: p.gramsPerUnit, source, etaHours: i.etaHours, by: "agent" });
      return r.ok
        ? { ok: true, data: { quote: r.quote, unitPriceIdr: p.unitPriceIdr, totalIdr: p.totalIdr, marginPct: p.marginPct, etaHours: r.quote.etaHours } }
        : err(r.error, r.reasons);
    },
  },
  {
    name: "price_with_calculator",
    description: "People and tests only (not an LLM tool): add Kesuni's own quote priced with the cost calculator " +
      "(orders in CREATED only). Refused if the margin " +
      "is under the owner's minimum or the price is over the customer's budget. You must say where gramsPerUnit and " +
      "machineHours come from (operator note, slicer numbers, earlier costing). The customer still approves the price.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" }, ...Object.fromEntries(Object.keys(KESUNI_DEFAULTS).map((k) => [k, { type: "number" }])),
        etaHours: { type: "integer" },
        source: { type: "string", description: "Where gramsPerUnit and machineHours come from" },
      },
      required: ["orderId", "gramsPerUnit", "machineHours", "unitPriceIdr", "source"],
    },
    run: (i) => {
      const orderId = str(i.orderId);
      const o = store.getOrder(orderId);
      if (!o) return err("Order not found");
      const parsed = parseCostInput({ ...i, quantity: o.quantity });
      if (!parsed.ok) return err("Invalid cost input", parsed.reasons);
      const preview = calculate(parsed.input);
      const rules = ownerRules();
      const reasons: string[] = [];
      if (preview.marginPct < rules.minMarginPct) reasons.push(`Margin ${preview.marginPct}% is under the owner's minimum ${rules.minMarginPct}%`);
      if (preview.revenueIdr > microToIdr(o.mandateMicro)) reasons.push(`Price Rp${preview.revenueIdr} is over the customer's budget (about Rp${microToIdr(o.mandateMicro)})`);
      if (!str(i.source).trim()) reasons.push("Say where the grams and machine hours come from");
      if (reasons.length) return err("Pricing refused", reasons);
      const r = quoteFromCosting(orderId, { ...parsed.input, etaHours: i.etaHours });
      return r.ok ? { ok: true, data: { quote: r.quote, marginPct: r.result.marginPct, revenueIdr: r.result.revenueIdr } } : err(r.error, r.reasons);
    },
  },
  {
    name: "get_production_status",
    description: "Has the customer paid into escrow; printers and whether each can take a job; the latest evidence; open operator tasks.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => {
      const orderId = str(i.orderId);
      if (!store.getOrder(orderId)) return err("Order not found");
      const e = store.getEscrow(orderId);
      return {
        ok: true,
        data: {
          escrow: e ? { state: e.state, amountUsdc: microToUsdc(e.amountMicro), txs: e.txs.map((t) => ({ kind: t.kind, state: t.state })) } : null,
          printers: store.listPrinters().map((p) => ({
            id: p.id, name: p.name, ready: notReadyReason(p) === null, why: notReadyReason(p),
            state: p.snapshot?.state ?? null, percent: p.snapshot?.percent ?? null, printingOrder: p.currentOrderId ?? null,
          })),
          evidence: store.listEvidence(orderId).slice(-10).map((x) => ({ kind: x.kind, note: x.note, label: x.label, at: x.at })),
          openTasks: store.listTasks(orderId).filter((t) => t.status === "open").map((t) => ({ kind: t.kind, text: t.text })),
        },
      };
    },
  },
  {
    name: "choose_printer",
    description: "Link the order to a printer that is online, idle and has an empty bed. Only after the customer has paid " +
      "into escrow. If none is ready, a task for the operator is created.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => {
      const orderId = str(i.orderId);
      const e = store.getEscrow(orderId);
      if (!e || e.state !== "FUNDED") return err("The customer has not paid into escrow yet; do not start printing");
      if (store.listPrinters().some((p) => p.currentOrderId === orderId)) return err("A printer is already linked to this order");
      if (printFinished(orderId)) return err("This order is already printed: it waits for collection and QC, not a new printer");
      const r = choosePrinter(orderId);
      return r.ok ? { ok: true, data: { printer: r.printer.name, reasons: r.reasons } } : err(r.error, r.reasons);
    },
  },
  {
    name: "create_operator_task",
    description: "Ask the Kesuni operator for physical work: change filament, check a printer, collect and QC a print. " +
      "English. A reprint is a QC decision: suggest it to a person with request_human_decision instead.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" },
        kind: { type: "string", enum: ["change_filament", "check_printer", "collect_and_qc"] },
        text: { type: "string" },
      },
      required: ["orderId", "kind", "text"],
    },
    run: (i) => {
      const orderId = str(i.orderId);
      if (!store.getOrder(orderId)) return err("Order not found");
      const kind = str(i.kind) as OperatorTask["kind"];
      if (kind === "reprint") return err("A reprint is a QC decision for a person: ask with request_human_decision");
      if (!["change_filament", "check_printer", "collect_and_qc"].includes(kind)) return err("Unknown task kind");
      const text = str(i.text).trim().slice(0, 600);
      if (!text) return err("Task text is required");
      if (store.listTasks(orderId).some((t) => t.status === "open" && t.kind === kind && t.text === text)) return err("The same task is already open");
      return { ok: true, data: { taskId: createTask(orderId, kind, text).id } };
    },
  },
  {
    name: "message_customer",
    description: "Customer skill: post a short update on the customer's order page. Short (1-3 sentences), polite, " +
      "simple English, facts only. No prices other than the agreed price, no payment instructions, no links, " +
      "contacts or addresses. At most one message per event. Code refuses links, wallet addresses, phone numbers, " +
      "emails, a repeat of the last message, and more than one message per order every 10 minutes.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" }, text: { type: "string", description: "The message, in English, at most 500 characters" } },
      required: ["orderId", "text"],
    },
    run: (i) => {
      const r = postCustomerMessage(str(i.orderId), str(i.text), "agent");
      return r.ok ? { ok: true, data: { messageId: r.message.id, text: r.message.text } } : err(r.error, r.reasons);
    },
  },
  {
    name: "propose_payment",
    description: "Propose a payment intent. Blocked unless accepted, QC recorded, payee and amount match.",
    inputSchema: {
      type: "object",
      properties: {
        orderId: { type: "string" }, recipient: { type: "string" },
        amountMicro: { type: "integer" }, idempotencyKey: { type: "string" },
      },
      required: ["orderId", "recipient", "amountMicro", "idempotencyKey"],
    },
    run: (i) => {
      if (!Number.isInteger(i.amountMicro)) return err("amountMicro must be an integer");
      const r = createPaymentIntent(str(i.orderId), {
        recipient: str(i.recipient), amountMicro: i.amountMicro as number, idempotencyKey: str(i.idempotencyKey),
      });
      return r.ok ? { ok: true, data: { intent: r.intent, replayed: r.replayed } } : err(r.error, r.reasons);
    },
  },
];

/**
 * Tools the LLM may use. Payment is not among them: money moves only through the policy-gated escrow code.
 * Pricing is by weight (price_by_weight); the long calculator stays a check (estimate_cost), not a price.
 */
const NOT_FOR_LLM = ["propose_payment", "price_with_calculator"];
export const LLM_TOOLS = TOOLS.filter((t) => !NOT_FOR_LLM.includes(t.name));

/** Call a tool by name and record it in the decision log. Never throws. */
export function callTool(name: string, input: Json, actor: "agent" | "human" = "agent"): ToolResult {
  const tool = TOOLS.find((t) => t.name === name);
  const result: ToolResult = tool ? tool.run(input) : err(`Unknown tool ${name}`);
  const entry: Omit<AgentLogEntry, "id"> = {
    orderId: str(input.orderId) || (store.getQuote(str(input.quoteId))?.orderId ?? ""),
    actor, tool: name, input, ok: result.ok, output: result.data, at: new Date().toISOString(),
  };
  store.addLog(entry);
  return result;
}

export const fmt = microToUsdc;

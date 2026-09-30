// Agent tools. Reads are free; writes go through src/lib/actions.ts, the same code the
// human API uses. Every call is logged. inputSchema is JSON Schema so an LLM can be
// wired to these later with no changes to the tools themselves.
import * as store from "../store";
import { checkPlan, microToUsdc } from "../policy";
import { chooseQuote, createPaymentIntent } from "../actions";
import type { AgentLogEntry } from "../types";

type Json = Record<string, unknown>;
type ToolResult = { ok: boolean; data: unknown };

interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (input: Json) => ToolResult;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const err = (message: string, reasons?: string[]): ToolResult => ({ ok: false, data: { error: message, reasons } });

export const TOOLS: Tool[] = [
  {
    name: "get_order",
    description: "Read an order: product, quantity, deadline, design version, mandate, status.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    run: (i) => {
      const o = store.getOrder(str(i.orderId));
      return o ? { ok: true, data: o } : err("Order not found");
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
      return { ok: r.ok, data: r };
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
    description: "Escalate to a person when no option is allowed or the situation is unclear.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" }, question: { type: "string" } },
      required: ["orderId", "question"],
    },
    run: (i) => ({ ok: true, data: { escalated: true, question: str(i.question) } }),
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

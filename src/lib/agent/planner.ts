// Rule-based stand-in for the LLM: picks the cheapest quote the policy allows, else escalates.
// It uses ONLY the tools above, so swapping in an LLM tool-calling loop changes nothing else.
import { callTool, fmt } from "./tools";
import type { Order, Quote } from "../types";

export interface PlanOutcome {
  outcome: "chosen" | "escalated" | "error";
  message: string;
  quoteId?: string;
}

export function planOrder(orderId: string): PlanOutcome {
  const o = callTool("get_order", { orderId });
  if (!o.ok) return { outcome: "error", message: "Order not found" };
  const order = o.data as Order;
  if (order.status !== "CREATED") return { outcome: "error", message: `Order is ${order.status}; nothing to plan` };

  const quotes = callTool("get_quotes", { orderId }).data as Quote[];
  callTool("get_available_budget", { orderId });

  const allowed: Quote[] = [];
  const refusals: string[] = [];
  for (const q of quotes) {
    const check = callTool("check_vendor_policy", { quoteId: q.id });
    if (check.ok) allowed.push(q);
    else refusals.push(`${q.id} (${fmt(q.priceMicro)} USDC): ${(check.data as { reasons: string[] }).reasons.join("; ")}`);
  }

  if (allowed.length === 0) {
    const message = `No allowed quote. ${refusals.join(" | ")}`;
    callTool("request_human_decision", { orderId, question: message });
    return { outcome: "escalated", message };
  }

  allowed.sort((a, b) => a.priceMicro - b.priceMicro || a.etaHours - b.etaHours);
  const best = allowed[0];
  const reason =
    `Cheapest allowed option: ${best.id} at ${fmt(best.priceMicro)} USDC, ${best.etaHours}h.` +
    (refusals.length ? ` Refused: ${refusals.join(" | ")}` : "");
  const chosen = callTool("choose_plan", { orderId, quoteId: best.id, reason });
  return chosen.ok
    ? { outcome: "chosen", message: reason, quoteId: best.id }
    : { outcome: "error", message: `Policy blocked the choice: ${JSON.stringify(chosen.data)}` };
}

import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, readJson, type Ctx } from "@/lib/http";
import { checkPlan } from "@/lib/policy";

// Agent or human chooses a quote. The policy engine decides, not the caller.
export async function POST(req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "CREATED") return fail(409, `Order is ${order.status}; plan already chosen`);
  const b = await readJson(req);
  if (!b || typeof b.quoteId !== "string" || (b.decidedBy !== "agent" && b.decidedBy !== "human") || typeof b.reason !== "string") {
    return fail(400, "Expected { quoteId, decidedBy: 'agent'|'human', reason }");
  }
  const quote = db.quotes.get(b.quoteId);
  if (!quote) return fail(404, "Quote not found");
  const policy = checkPlan(order, quote, db.vendors.get(quote.vendorId));
  if (!policy.ok) return fail(422, "Plan rejected by policy", policy.reasons);
  order.chosenQuoteId = quote.id;
  order.status = "PLAN_CHOSEN";
  db.decisions.push({ orderId: order.id, quoteId: quote.id, decidedBy: b.decidedBy, reason: b.reason, at: new Date().toISOString() });
  return NextResponse.json({ order });
}

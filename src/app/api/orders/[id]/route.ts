import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, type Ctx } from "@/lib/http";

export async function GET(_req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  return NextResponse.json({
    order,
    quotes: [...db.quotes.values()].filter((q) => q.orderId === order.id),
    decisions: db.decisions.filter((d) => d.orderId === order.id),
    evidence: db.evidence.filter((e) => e.orderId === order.id),
    acceptance: db.acceptances.get(order.id) ?? null,
    agentLog: db.agentLog.filter((e) => e.orderId === order.id),
    paymentIntents: [...db.intents.values()].filter((i) => i.orderId === order.id),
  });
}

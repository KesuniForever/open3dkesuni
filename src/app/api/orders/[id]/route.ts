import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, type Ctx } from "@/lib/http";

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const order = store.getOrder(id);
  if (!order) return fail(404, "Order not found");
  return NextResponse.json({
    order,
    vendors: store.listVendors(),
    quotes: store.listQuotes(id),
    decisions: store.listDecisions(id),
    evidence: store.listEvidence(id),
    acceptance: store.getAcceptance(id) ?? null,
    agentLog: store.listLog(id),
    paymentIntents: store.listIntents(id),
  });
}

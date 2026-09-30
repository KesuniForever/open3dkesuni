import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, readJson, type Ctx } from "@/lib/http";
import type { Quote } from "@/lib/types";

// Operator enters a partner quote manually. priceMicro is integer micro-USDC.
export async function POST(req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  const b = await readJson(req);
  if (!b) return fail(400, "Invalid JSON body");
  const { vendorId, priceMicro, etaHours } = b;
  if (typeof vendorId !== "string" || !Number.isInteger(priceMicro) || !Number.isInteger(etaHours)) {
    return fail(400, "Expected { vendorId: string, priceMicro: integer, etaHours: integer }");
  }
  if (!db.vendors.has(vendorId)) return fail(400, "Unknown vendor");
  const quote: Quote = {
    id: `Q-${db.quotes.size + 1}`, orderId: order.id, vendorId,
    priceMicro: priceMicro as number, etaHours: etaHours as number,
    source: vendorId === "own" ? "own" : "partner",
  };
  db.quotes.set(quote.id, quote);
  return NextResponse.json({ quote }, { status: 201 });
}

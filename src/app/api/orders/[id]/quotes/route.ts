import { NextResponse } from "next/server";
import { addQuote } from "@/lib/actions";
import { usdcToMicro } from "@/lib/policy";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// Operator enters a quote manually. Body: { vendorId, priceUsdc: "30", etaHours } or priceMicro (integer).
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Invalid JSON body");
  let priceMicro = b.priceMicro as number;
  if (b.priceUsdc !== undefined) {
    try { priceMicro = usdcToMicro(str(b.priceUsdc)); } catch { return fail(400, "Price must be a USDC amount like 30 or 30.5"); }
  }
  const r = addQuote(id, { vendorId: str(b.vendorId), priceMicro, etaHours: Number(b.etaHours) });
  return r.ok ? NextResponse.json({ quote: r.quote }, { status: 201 }) : failWith(r);
}

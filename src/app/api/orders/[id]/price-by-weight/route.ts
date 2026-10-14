import { NextResponse } from "next/server";
import { quoteByWeight } from "@/lib/agreement";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// Kesuni's official price: grams per unit from the slicer → own quote (rupiah in, USDC quote out).
// Body: { gramsPerUnit, source, etaHours?, by? }. This is the operator's form, so it is always recorded as
// by "human"; the agent prices through its own tool (price_by_weight), which has the margin and budget checks.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { gramsPerUnit, source, etaHours? }");
  if (b.by === "agent") return fail(400, "The agent prices through its own tool, not this endpoint");
  const r = quoteByWeight(id, { gramsPerUnit: Number(b.gramsPerUnit), source: str(b.source), etaHours: b.etaHours, by: "human" });
  return r.ok ? NextResponse.json({ quote: r.quote, price: r.price, gramPricing: r.gramPricing }, { status: 201 }) : failWith(r);
}

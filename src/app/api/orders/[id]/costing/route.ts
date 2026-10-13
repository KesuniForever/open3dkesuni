import { NextResponse } from "next/server";
import { quoteFromCosting } from "@/lib/agreement";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";

// Kesuni's own quote from the cost calculator (rupiah in, USDC quote out).
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected the calculator inputs as JSON");
  const r = quoteFromCosting(id, b);
  return r.ok ? NextResponse.json({ quote: r.quote, result: r.result, overBudget: r.overBudget }, { status: 201 }) : failWith(r);
}

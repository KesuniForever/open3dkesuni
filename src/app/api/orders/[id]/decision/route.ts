import { NextResponse } from "next/server";
import { fail, readJson, type Ctx } from "@/lib/http";
import { chooseQuote } from "@/lib/actions";

// Agent or human chooses a quote. The policy engine decides, not the caller.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b || typeof b.quoteId !== "string" || (b.decidedBy !== "agent" && b.decidedBy !== "human") || typeof b.reason !== "string") {
    return fail(400, "Expected { quoteId, decidedBy: 'agent'|'human', reason }");
  }
  const r = chooseQuote(id, b.quoteId, b.decidedBy, b.reason);
  return r.ok ? NextResponse.json({ order: r.order }) : fail(r.status, r.error, r.reasons);
}

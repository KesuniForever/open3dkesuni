import { NextResponse } from "next/server";
import { setSpec } from "@/lib/agreement";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";

// What will be made and the quality promise. The customer approves it with the price before paying.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected a JSON spec");
  const r = setSpec(id, b);
  return r.ok ? NextResponse.json({ order: r.order }) : failWith(r);
}

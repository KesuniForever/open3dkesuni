import { NextResponse } from "next/server";
import { recordActual } from "@/lib/agreement";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";

// What production actually used (operator report), shown next to the plan.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected the report as JSON");
  const r = recordActual(id, b);
  return r.ok ? NextResponse.json({ actual: r.actual }) : failWith(r);
}

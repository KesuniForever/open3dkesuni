import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { markPrintDoneDebug } from "@/lib/printer/done-debug";

// POST { by } — "Done (debug)" on the order page: a person marks a test order's printing as finished without printing,
// to try QC and the customer's accept or reject quickly. Not an agent tool; moves no printer and no money.
// 201 when marked now, 200 when it was already marked (the same mark comes back). A real order: 409.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { by }");
  const r = markPrintDoneDebug(id, { by: str(b.by) });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ order: r.order, mark: r.order.printDoneDebug, evidence: r.evidence, replayed: r.replayed }, { status: r.replayed ? 200 : 201 });
}

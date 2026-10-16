import { NextResponse } from "next/server";
import { failWith, readJson, str, type Ctx } from "@/lib/http";
import { orderAutoPrint, setOrderRuns } from "@/lib/printer/dispatch";

// POST { runsNeeded: 0..50, by } — a person sets how many prints of this order the agent may make (0 = never). An order
// that is not real is printed by the agent only after a person set this. Logged; the dispatcher runs right after.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const r = setOrderRuns(id, { runsNeeded: b?.runsNeeded, by: str(b?.by) });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ order: r.order, autoPrint: orderAutoPrint(id), started: r.dispatch.started, sliced: r.dispatch.sliced });
}

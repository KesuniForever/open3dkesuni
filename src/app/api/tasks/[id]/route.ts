import { NextResponse } from "next/server";
import { failWith, readJson, str, type Ctx } from "@/lib/http";
import { completeTask } from "@/lib/printer/actions";
import { safeDispatch } from "@/lib/printer/dispatch";

// POST { by } — a person marks an operator task done. The printer's latest collect-and-QC or reprint task frees its bed,
// but never lets the agent print (only "Bed is empty" on My machines does). A closed reprint or "agent print did not
// start" task can free an order, so the dispatcher runs after it (it only acts when agent prints are on).
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const r = completeTask(id, str(b?.by));
  if (!r.ok) return failWith(r);
  const dispatch = safeDispatch("task_done");
  return NextResponse.json({ task: r.task, dispatch: { on: dispatch.on, started: dispatch.started, sliced: dispatch.sliced } });
}

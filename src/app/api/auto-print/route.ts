import { NextResponse } from "next/server";
import { failWith, readJson, str } from "@/lib/http";
import { autoPrintFeed, planDispatch, setAutoPrint } from "@/lib/printer/dispatch";

// GET: the "Agent may start prints" switch (on, who, when), the dispatcher's read-only plan and the last agent decisions.
export async function GET() {
  const plan = planDispatch();
  return NextResponse.json({ on: plan.on, by: plan.by, at: plan.at, locked: plan.locked, plan, feed: autoPrintFeed(10) });
}

// POST { on: true | false, by, confirm: true } — a person turns agent prints on or off (logged). Off cancels the agent's
// prints and slices that have not reached a printer; on runs the dispatcher at once. The Chief has no tool for this.
export async function POST(req: Request) {
  const b = await readJson(req);
  const r = setAutoPrint({ on: b?.on, by: str(b?.by), confirm: b?.confirm });
  if (!r.ok) return failWith(r);
  return NextResponse.json({
    on: r.setting.on, by: r.setting.by ?? null, at: r.setting.at ?? null, cancelled: r.cancelled,
    dispatch: r.dispatch ? { started: r.dispatch.started, sliced: r.dispatch.sliced, error: r.dispatch.error ?? null } : null,
  });
}

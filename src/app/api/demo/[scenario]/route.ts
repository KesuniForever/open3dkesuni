import { NextResponse } from "next/server";
import { runScenario } from "@/lib/demo";
import { failWith } from "@/lib/http";

// Demo center: make one new simulated order for a scenario and say which. No escrow, no Circle, no Chief run.
export async function POST(_req: Request, ctx: { params: Promise<{ scenario: string }> }) {
  const { scenario } = await ctx.params;
  const r = runScenario(scenario);
  if (r.ok) return NextResponse.json({ orderId: r.orderId, steps: r.steps }, { status: 201 });
  // A half-built order is still a simulated demo order: say which, so the operator can open it.
  return r.orderId ? NextResponse.json({ error: r.error, reasons: r.reasons, orderId: r.orderId }, { status: r.status }) : failWith(r);
}

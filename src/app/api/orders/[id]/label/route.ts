import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { setOrderLabel } from "@/lib/order-label";

// POST { label: "real" | "simulated", by } — the operator order page marks an order real or simulated (a practice order
// from the public form, or a mistaken mark undone). Behind the operator password (src/proxy.ts), like every operator
// route. Not an agent tool; moves no money and no printer; writes a decision-log row with who changed it.
// 200 { order, changed }: changed false when it already had that label. 409 with reasons while money is held or moving.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { label, by }");
  const r = setOrderLabel(id, { label: b.label, by: str(b.by) });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ order: r.order, changed: r.changed });
}

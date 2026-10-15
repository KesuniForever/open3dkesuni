import { NextResponse } from "next/server";
import { setSlicerGrams } from "@/lib/agreement";
import { wakeChief } from "@/lib/agent/chief";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// A person at Kesuni gives the Chief grams per unit from the slicer (operator only; not an agent tool).
// Body: { gramsPerUnit, source, by, colorMode? } (colorMode "single", the default, or "multi" colour: sets the ETA).
// The Chief is then woken to price by weight with exactly these grams.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { gramsPerUnit, source, by, colorMode? }");
  const r = setSlicerGrams(id, { gramsPerUnit: Number(b.gramsPerUnit), source: str(b.source), by: str(b.by) || "operator", colorMode: b.colorMode });
  if (!r.ok) return failWith(r);
  const g = r.order.slicerGrams!;
  wakeChief(id, `A person at Kesuni entered grams per unit from the slicer: ${g.gramsPerUnit} g, ${g.colorMode === "multi" ? "multi" : "single"} colour. Price it by weight and continue.`);
  return NextResponse.json({ order: r.order });
}

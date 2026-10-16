import { NextResponse } from "next/server";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { updateSliceItem } from "@/lib/slicing";
import { afterAutoWeigh } from "@/lib/auto-weigh";

// POST { state: "slicing" | "alive" | "failed", error?, kind? } (bearer PRINTER_BRIDGE_TOKEN): the studio PC takes a slice
// (queued -> slicing, once), says it still works on it (alive, every minute), or reports it failed (kind "studio" when
// the studio PC was the problem, else the model was). "done" comes only with the sliced file (POST /api/slicer/jobs/<id>/result).
export async function POST(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { state, error?, kind? }");
  const r = updateSliceItem(id, { state: b.state, error: b.error, kind: b.kind });
  if (!r.ok) return failWith(r);
  if (r.job.state === "failed") afterAutoWeigh(id); // a failed automatic weighing: the Chief asks a person for the grams
  return NextResponse.json({ job: r.job });
}

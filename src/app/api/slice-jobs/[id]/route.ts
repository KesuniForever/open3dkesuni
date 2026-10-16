import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { cancelSliceJob, expireStaleSlices } from "@/lib/slicing";

// GET: one slice. POST { action: "cancel", by }: a person cancels a slice that is waiting or running (the studio PC's
// result for it is then refused).
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  expireStaleSlices();
  const job = store.getSliceJob(id);
  return job ? NextResponse.json({ job }) : fail(404, "Slice not found");
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (str(b?.action) !== "cancel") return fail(400, 'Expected { action: "cancel", by }');
  const r = cancelSliceJob(id, b?.by);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ job: r.job });
}

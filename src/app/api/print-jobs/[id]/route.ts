import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { cancelPrintJob, expireStale } from "@/lib/printer/jobs";

// GET: one print job. POST { action: "cancel", by }: a person cancels a job that has not reached the printer (queued, or
// being uploaded: the bridge then sends nothing). A print already on the printer is stopped with "stop" instead.
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  expireStale();
  const job = store.getPrintJob(id);
  return job ? NextResponse.json({ job }) : fail(404, "Print job not found");
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (str(b?.action) !== "cancel") return fail(400, 'Expected { action: "cancel", by }');
  const r = cancelPrintJob(id, b?.by);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ job: r.job });
}

import { NextResponse } from "next/server";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";
import { bridgeAuth } from "@/lib/printer/bridge-auth";
import { updateQueueItem } from "@/lib/printer/jobs";

// POST { state, error?, result?, md5? } (bearer PRINTER_BRIDGE_TOKEN): the LAN bridge reports on one command ("PC-…":
// sent, done, failed) or print job ("PJ-…": uploading, sent, printing, done, failed, cancelled). Only forward moves.
export async function POST(req: Request, ctx: Ctx) {
  const denied = bridgeAuth(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { state, error?, result? }");
  const r = updateQueueItem(id, { state: b.state, error: b.error, result: b.result, md5: b.md5 });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ command: r.command ?? null, job: r.job ?? null });
}

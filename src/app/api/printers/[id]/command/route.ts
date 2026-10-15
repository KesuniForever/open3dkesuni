import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, readJson, type Ctx } from "@/lib/http";
import { createPrinterCommand, expireStale } from "@/lib/printer/jobs";

// POST { kind, params?, by, confirm? }: a PERSON asks for a control on this printer (pause, resume, stop, speed
// { level: 1..4 }, light { on }) or a read-only request (get_version, camera_snapshot). pause, resume and stop need
// confirm: true. The bridge picks it up within 60 s or it expires. Operator only (src/proxy.ts); never the Chief.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { kind, params?, by, confirm? }");
  const r = createPrinterCommand(id, { kind: b.kind, params: b.params, by: b.by, confirm: b.confirm });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ command: r.command }, { status: 201 });
}

// GET: this printer's last 20 commands, newest first (state: queued, sent, done, failed, expired).
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!store.getPrinter(id)) return fail(404, "Printer not found");
  expireStale();
  return NextResponse.json({ commands: store.listPrinterCommands(id).slice(-20).reverse() });
}

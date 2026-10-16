import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { clearBed } from "@/lib/printer/actions";
import { safeDispatch } from "@/lib/printer/dispatch";

// POST { by, confirm: true } — "Bed is empty" on My machines: a person took the print off, the plate is on, clean and
// empty. Frees the bed and records the confirmation (Printer.bedCheck) that allows the agent ONE print on this printer
// when agent prints are on (the dispatcher runs right after it; its answer comes back as dispatch). From a device other
// than this computer it needs the operator password (src/proxy.ts), like starting a print.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (b?.confirm !== true) return fail(400, "Confirm first", ["Send confirm: true after the person confirmed"]);
  const r = clearBed(id, str(b?.by), { via: "button" });
  if (!r.ok) return failWith(r);
  const dispatch = safeDispatch("bed_cleared");
  return NextResponse.json({
    printer: store.getPrinter(id) ?? r.printer, granted: Boolean(r.bedCheck),
    dispatch: { on: dispatch.on, started: dispatch.started, sliced: dispatch.sliced },
  });
}

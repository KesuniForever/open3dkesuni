import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { clearBed, confirmColors, linkPrinter, unlinkPrinter } from "@/lib/printer/actions";
import { safeDispatch } from "@/lib/printer/dispatch";

// POST { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by } | { action: "confirm_colors", by }
// A person decides what a printer prints, confirms the bed is empty, and confirms the AMS colours are the real spools.
// "clear_bed" here only frees the bed (a person's name): it never lets the agent print. The "Bed is empty" that allows
// the agent ONE print is POST /api/printers/:id/bed (operator password from other devices, a confirm dialog).
// The dispatcher runs after confirm_colors (it only acts when agent prints are on); its answer comes back as dispatch.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const action = str(b?.action);
  const r =
    action === "link" ? linkPrinter(id, str(b?.orderId)) :
    action === "unlink" ? unlinkPrinter(id) :
    action === "clear_bed" ? clearBed(id, str(b?.by), { via: "button", grant: false }) :
    action === "confirm_colors" ? confirmColors(id, str(b?.by)) : null;
  if (!r) return fail(400, 'Expected { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by } | { action: "confirm_colors", by }');
  if (!r.ok) return failWith(r);
  const dispatch = action === "confirm_colors" ? safeDispatch("colors_confirmed") : null;
  return NextResponse.json({ printer: store.getPrinter(id) ?? r.printer, ...(dispatch ? { dispatch: { on: dispatch.on, started: dispatch.started, sliced: dispatch.sliced } } : {}) });
}

import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { clearBed, confirmColors, linkPrinter, unlinkPrinter } from "@/lib/printer/actions";

// POST { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by } | { action: "confirm_colors", by }
// A person decides what a printer prints, confirms the bed is empty, and confirms the AMS colours are the real spools.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const action = str(b?.action);
  const r =
    action === "link" ? linkPrinter(id, str(b?.orderId)) :
    action === "unlink" ? unlinkPrinter(id) :
    action === "clear_bed" ? clearBed(id, str(b?.by)) :
    action === "confirm_colors" ? confirmColors(id, str(b?.by)) : null;
  if (!r) return fail(400, 'Expected { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by } | { action: "confirm_colors", by }');
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer });
}

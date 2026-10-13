import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { clearBed, linkPrinter, unlinkPrinter } from "@/lib/printer/actions";

// POST { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by }
// A person decides what a printer prints and confirms the bed is empty.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const action = str(b?.action);
  const r =
    action === "link" ? linkPrinter(id, str(b?.orderId)) :
    action === "unlink" ? unlinkPrinter(id) :
    action === "clear_bed" ? clearBed(id, str(b?.by)) : null;
  if (!r) return fail(400, 'Expected { action: "link", orderId } | { action: "unlink" } | { action: "clear_bed", by }');
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer });
}

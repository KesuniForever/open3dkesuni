import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { linkPrinter, unlinkPrinter } from "@/lib/printer/actions";

// POST { action: "link", orderId } | { action: "unlink" } — a person decides what the printer is printing.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const action = str(b?.action);
  const r = action === "link" ? linkPrinter(id, str(b?.orderId)) : action === "unlink" ? unlinkPrinter(id) : null;
  if (!r) return fail(400, 'Expected { action: "link", orderId } or { action: "unlink" }');
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer });
}

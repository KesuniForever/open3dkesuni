import { NextResponse } from "next/server";
import { failWith, type Ctx } from "@/lib/http";
import { choosePrinter } from "@/lib/printer/actions";

// The agent picks a ready printer (online, idle, empty bed, not busy) and links it, or escalates.
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = choosePrinter(id);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ printer: r.printer, reasons: r.reasons });
}

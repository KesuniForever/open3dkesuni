import { NextResponse } from "next/server";
import { fail, readJson } from "@/lib/http";
import { orderSlices, requestSlice, slicerStatus } from "@/lib/slicing";

// POST { orderId, attachmentId, printerId, tray, quality?: "standard"|"fine"|"draft", infillPct?: 0..100,
// supports?: "auto"|"off", by }: a PERSON asks the studio PC to slice an order's STL/OBJ (or an unsliced A1 3MF) with
// the material and colour of one AMS spool (tray = ams*4 + slot). Nothing prints. 201 a new slice, 200 the same slice
// already waiting or done (`reused`), 4xx with reasons. Operator only (src/proxy.ts); the agent asks only from code.
export async function POST(req: Request) {
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { orderId, attachmentId, printerId, tray, quality?, infillPct?, supports?, by }");
  const r = requestSlice({
    orderId: b.orderId, attachmentId: b.attachmentId, printerId: b.printerId, tray: b.tray, quality: b.quality, infillPct: b.infillPct,
    supports: b.supports, by: b.by, actor: "person",
  });
  if (!r.ok) return NextResponse.json({ error: r.error, reasons: r.reasons }, { status: r.status });
  return NextResponse.json({ job: r.job, warnings: r.warnings, reused: r.reused ?? null }, { status: r.reused ? 200 : 201 });
}

// GET ?orderId=ORD-012: the order's slices, newest first, and whether the studio PC's slicer asked lately.
export async function GET(req: Request) {
  const orderId = new URL(req.url).searchParams.get("orderId");
  if (!orderId) return fail(400, "Expected ?orderId=");
  return NextResponse.json({ jobs: orderSlices(orderId), slicer: slicerStatus() });
}

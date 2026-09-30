import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, readJson, type Ctx } from "@/lib/http";

// Acceptance is a human decision. It is never derived from model output.
export async function POST(req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  if (order.status !== "EVIDENCE_SUBMITTED") return fail(409, `Order is ${order.status}; QC evidence required first`);
  const b = await readJson(req);
  if (!b || typeof b.accepted !== "boolean" || typeof b.by !== "string" || typeof b.note !== "string") {
    return fail(400, "Expected { accepted: boolean, by: string, note: string }");
  }
  const acceptance = { orderId: order.id, accepted: b.accepted, by: b.by, note: b.note, at: new Date().toISOString() };
  db.acceptances.set(order.id, acceptance);
  order.status = b.accepted ? "ACCEPTED" : "REJECTED";
  return NextResponse.json({ acceptance, order });
}

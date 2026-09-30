import { NextResponse } from "next/server";
import { fail, readJson, type Ctx } from "@/lib/http";
import { createPaymentIntent } from "@/lib/actions";

// Creates an intent only. Sending USDC on Arc is a later step (not built yet).
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b || typeof b.recipient !== "string" || !Number.isInteger(b.amountMicro) || typeof b.idempotencyKey !== "string" || !b.idempotencyKey) {
    return fail(400, "Expected { recipient, amountMicro: integer, idempotencyKey }");
  }
  const r = createPaymentIntent(id, { recipient: b.recipient, amountMicro: b.amountMicro as number, idempotencyKey: b.idempotencyKey });
  if (!r.ok) return fail(r.status, r.error, r.reasons);
  return NextResponse.json({ intent: r.intent, replayed: r.replayed }, { status: r.replayed ? 200 : 201 });
}

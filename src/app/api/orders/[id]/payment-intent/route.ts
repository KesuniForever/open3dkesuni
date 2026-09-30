import { NextResponse } from "next/server";
import { db } from "@/lib/store";
import { fail, loadOrder, readJson, type Ctx } from "@/lib/http";
import { checkPaymentIntent } from "@/lib/policy";
import type { PaymentIntent } from "@/lib/types";

// Creates an intent only. Sending USDC on Arc is a later step (not built yet).
export async function POST(req: Request, ctx: Ctx) {
  const order = await loadOrder(ctx);
  if (!order) return fail(404, "Order not found");
  const b = await readJson(req);
  if (!b || typeof b.recipient !== "string" || !Number.isInteger(b.amountMicro) || typeof b.idempotencyKey !== "string" || !b.idempotencyKey) {
    return fail(400, "Expected { recipient, amountMicro: integer, idempotencyKey }");
  }
  const existing = [...db.intents.values()];
  const replay = existing.find((i) => i.orderId === order.id && i.idempotencyKey === b.idempotencyKey);
  if (replay) return NextResponse.json({ intent: replay, replayed: true });

  const quote = order.chosenQuoteId ? db.quotes.get(order.chosenQuoteId) : undefined;
  const policy = checkPaymentIntent({
    order, chosenQuote: quote, vendor: quote ? db.vendors.get(quote.vendorId) : undefined,
    evidence: db.evidence.filter((e) => e.orderId === order.id),
    acceptance: db.acceptances.get(order.id), existingIntents: existing,
    proposed: { recipient: b.recipient, amountMicro: b.amountMicro as number, idempotencyKey: b.idempotencyKey },
  });
  if (!policy.ok) return fail(422, "Payment blocked by policy", policy.reasons);

  const intent: PaymentIntent = {
    id: `PI-${existing.length + 1}`, orderId: order.id, recipient: b.recipient,
    amountMicro: b.amountMicro as number, token: "USDC", network: "ARC-TESTNET",
    idempotencyKey: b.idempotencyKey, state: "PAYMENT_INTENT_CREATED", label: "local",
    createdAt: new Date().toISOString(),
  };
  db.intents.set(intent.id, intent);
  return NextResponse.json({ intent, replayed: false }, { status: 201 });
}

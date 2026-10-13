import { NextResponse } from "next/server";
import { customerDecide, customerPay, customerView, orderForToken, refreshPayment } from "@/lib/customer";
import { fail, failWith, readJson, str } from "@/lib/http";
import { customerAgree } from "@/lib/agreement";
import { customerReview } from "@/lib/reputation";

type Ctx = { params: Promise<{ token: string }> };

// The customer's view of one order. Also moves a payment in progress forward.
export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const order = orderForToken(token);
  if (!order) return fail(404, "Pesanan tidak ditemukan");
  await refreshPayment(order.id).catch(() => undefined); // Circle hiccup: show the last known state
  return NextResponse.json(customerView(orderForToken(token)!, token));
}

// POST { action: "agree", by } | { action: "pay", agree?: true, by? } | { action: "accept" | "reject", by, note }
//    | { action: "review", quality, communication, value, text, by }
export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const order = orderForToken(token);
  if (!order) return fail(404, "Pesanan tidak ditemukan");
  const b = await readJson(req);
  const action = str(b?.action);
  if (action === "agree" || (action === "pay" && b?.agree === true)) {
    const a = customerAgree(order.id, str(b?.by));
    if (!a.ok) return failWith(a);
    if (action === "agree") return NextResponse.json({ ok: true, agreement: a.agreement });
  }
  if (action === "review") {
    const r = customerReview(order.id, b ?? {});
    return r.ok ? NextResponse.json({ ok: true }) : failWith(r);
  }
  if (action === "pay") {
    const r = await customerPay(order.id);
    return r.ok ? NextResponse.json({ ok: true }) : failWith(r);
  }
  if (action === "accept" || action === "reject") {
    const r = await customerDecide(order.id, { accepted: action === "accept", by: str(b?.by), note: str(b?.note).slice(0, 500) });
    return r.ok ? NextResponse.json(r) : failWith(r);
  }
  return fail(400, 'Expected { action: "agree" | "pay" | "accept" | "reject" | "review" }');
}

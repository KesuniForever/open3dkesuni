import { NextResponse } from "next/server";
import { customerDecide, customerFailure, customerPay, customerSetColors, customerView, orderForToken, refreshPayment } from "@/lib/customer";
import { clientIp, fail, failWith, str } from "@/lib/http";
import { readJsonCapped } from "@/lib/request-body";
import { customerAgree } from "@/lib/agreement";
import { customerReview } from "@/lib/reputation";
import { customerRaiseBudget } from "@/lib/budget-raise";
import { CROSS_SITE, TOO_MANY_TRIES, TRIES_PER_IP_PER_HOUR, crossSite, take, tries } from "@/lib/customer-limits";

type Ctx = { params: Promise<{ token: string }> };

// The customer's view of one order. Also moves a payment in progress forward.
export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const order = orderForToken(token);
  if (!order) return fail(404, "Order not found");
  await refreshPayment(order.id).catch(() => undefined); // Circle hiccup: show the last known state
  return NextResponse.json(customerView(orderForToken(token)!, token));
}

// POST { action: "agree", by } | { action: "pay", agree?: true, by? } | { action: "accept", by, note, checked: true }
//    | { action: "reject", by, note }
//    | { action: "review", quality, communication, value, text, by }
//    | { action: "colors", material: "PLA" | "PETG" | null, colors: [{ type, color }] } (while Kesuni prepares the price)
//    | { action: "raise-budget", quoteId, by }: Kesuni's price is above the budget and the customer raises their budget to
//      exactly that quote's price (src/lib/budget-raise.ts). Any amount in the body is ignored: the price is Kesuni's.
//      Counted with the tries of the order form and "Add your design" (src/lib/customer-limits.ts).
// A pay, accept or reject that fails for a reason the customer cannot fix answers one plain sentence; the reason goes
// to the decision log and a task for the team (customerFailure). A decision whose money the policy held answers
// settled: false without the policy's reasons (the page's headline says Kesuni finishes it).
export async function POST(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const order = orderForToken(token);
  if (!order) return fail(404, "Order not found");
  // At most 64 KB: this route is outside the proxy, so nothing else limits the body (src/lib/request-body.ts).
  const b = await readJsonCapped(req, 64 * 1024);
  if (b === "too-large") return fail(413, "The request is too long");
  const action = str(b?.action);
  if (action === "agree" || (action === "pay" && b?.agree === true)) {
    const a = customerAgree(order.id, str(b?.by));
    if (!a.ok) return failWith(action === "pay" ? customerFailure(order.id, "pay", a) : a);
    if (action === "agree") return NextResponse.json({ ok: true, agreement: a.agreement });
  }
  if (action === "colors") {
    const r = customerSetColors(order.id, { material: b?.material, colors: b?.colors });
    return r.ok ? NextResponse.json({ ok: true, choice: r.choice }) : failWith(r);
  }
  if (action === "raise-budget") {
    if (!take(tries, clientIp(req), Date.now(), TRIES_PER_IP_PER_HOUR)) return fail(429, TOO_MANY_TRIES);
    if (crossSite(req)) return fail(403, CROSS_SITE);
    const r = customerRaiseBudget(order.id, { quoteId: str(b?.quoteId), by: str(b?.by) });
    return r.ok ? NextResponse.json({ ok: true, budgetIdr: r.raise.toIdr, repeated: r.repeated }) : failWith(r);
  }
  if (action === "review") {
    const r = customerReview(order.id, b ?? {});
    return r.ok ? NextResponse.json({ ok: true }) : failWith(r);
  }
  if (action === "pay") {
    const r = await customerPay(order.id);
    return r.ok ? NextResponse.json({ ok: true }) : failWith(customerFailure(order.id, "pay", r));
  }
  if (action === "accept" || action === "reject") {
    const r = await customerDecide(order.id, {
      accepted: action === "accept", by: str(b?.by), note: str(b?.note).slice(0, 500), checked: b?.checked === true,
    });
    return r.ok ? NextResponse.json({ ok: true, settled: r.settled }) : failWith(customerFailure(order.id, action, r));
  }
  return fail(400, 'Expected { action: "agree" | "pay" | "accept" | "reject" | "review" | "colors" | "raise-budget" }');
}

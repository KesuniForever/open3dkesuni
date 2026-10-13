import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { customerCreateOrder } from "@/lib/customer";
import { fail, failWith, readJson, str } from "@/lib/http";

const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// A customer places an order. Only people with the invite link (CUSTOMER_INVITE_CODE) can.
// Body: { invite, name, product, quantity, deadline: "YYYY-MM-DD", budgetIdr, note }
export async function POST(req: Request) {
  const code = process.env.CUSTOMER_INVITE_CODE;
  const b = await readJson(req);
  if (!code || !b || !sameSecret(str(b.invite), code)) return fail(404, "Link pemesanan tidak berlaku");
  const r = customerCreateOrder({
    name: str(b.name), product: str(b.product), quantity: Number(b.quantity), deadline: str(b.deadline),
    budgetIdr: Number(b.budgetIdr), note: str(b.note),
  });
  return r.ok ? NextResponse.json({ link: `/c/${r.order.customerToken}` }, { status: 201 }) : failWith(r);
}

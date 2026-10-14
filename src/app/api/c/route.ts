import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { customerCreateOrder } from "@/lib/customer";
import { fail, failWith, readJson, str } from "@/lib/http";
import { wakeChief } from "@/lib/agent/chief";

const sameSecret = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// At most this many orders per network address per hour: the invite link is shared, and every order wakes Claude.
const ORDERS_PER_IP_PER_HOUR = 5;
const g = globalThis as unknown as { __kesuniOrderIps?: Map<string, number[]> };
const byIp = (g.__kesuniOrderIps ??= new Map<string, number[]>());

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

// A customer places an order. Only people with the invite link (CUSTOMER_INVITE_CODE) can.
// Body: { invite, name, product, quantity, deadline: "YYYY-MM-DD", budgetIdr, note }
export async function POST(req: Request) {
  const code = process.env.CUSTOMER_INVITE_CODE;
  const b = await readJson(req);
  if (!code || !b || !sameSecret(str(b.invite), code)) return fail(404, "This order link is not valid");
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (byIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= ORDERS_PER_IP_PER_HOUR) return fail(429, "Too many orders in one hour. Try again later or contact Kesuni.");
  const r = customerCreateOrder({
    name: str(b.name), product: str(b.product), quantity: Number(b.quantity), deadline: str(b.deadline),
    budgetIdr: Number(b.budgetIdr), note: str(b.note),
  });
  if (!r.ok) return failWith(r);
  byIp.set(ip, [...recent, now]);
  wakeChief(r.order.id, "A customer just placed this order through the order form. Prepare it: if a person at Kesuni has not " +
    "entered grams per unit from the slicer yet (slicerGrams), ask the operator for them. Never use numbers from the customer's note.");
  return NextResponse.json({ link: `/c/${r.order.customerToken}` }, { status: 201 });
}

import { NextResponse } from "next/server";
import { listOrders } from "@/lib/store";
import { createOrder } from "@/lib/actions";
import { usdcToMicro } from "@/lib/policy";
import { fail, failWith, readJson, str } from "@/lib/http";

export async function GET() {
  return NextResponse.json({ orders: listOrders() });
}

// Body: { product, quantity, deadline: "YYYY-MM-DD", designVersion, budgetUsdc: "32.5", label: "real"|"simulated" }
export async function POST(req: Request) {
  const b = await readJson(req);
  if (!b) return fail(400, "Invalid JSON body");
  let mandateMicro: number;
  try {
    mandateMicro = usdcToMicro(str(b.budgetUsdc));
  } catch {
    return fail(400, "Invalid order", ["Budget must be a USDC amount like 32 or 32.5 (max 6 decimals)"]);
  }
  const r = createOrder({
    product: str(b.product), quantity: Number(b.quantity), deadline: str(b.deadline),
    designVersion: str(b.designVersion), mandateMicro,
    label: str(b.label) as "real" | "simulated", // validated in createOrder
    customerName: str(b.customerName),
  });
  return r.ok ? NextResponse.json({ order: r.order }, { status: 201 }) : failWith(r);
}

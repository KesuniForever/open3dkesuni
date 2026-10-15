import { NextResponse } from "next/server";
import { listOrders, listPrinters } from "@/lib/store";
import { createOrder } from "@/lib/actions";
import { budgetFromBody } from "@/lib/budget";
import { idrPerUsdc } from "@/lib/costing";
import { parseColorChoices, studioPalette } from "@/lib/colors";
import { fail, failWith, readJson, str } from "@/lib/http";

export async function GET() {
  return NextResponse.json({ orders: listOrders() });
}

// Body: { product, quantity, deadline: "YYYY-MM-DD", designVersion, label: "real"|"simulated", customerName?,
//   budgetIdr: "50.000" (rupiah as typed) OR budgetUsdc: "32.5", material?: "PLA"|"PETG",
//   preferredColors?: [{ type, color }] (only colours loaded in the studio right now) }
// The server's app rate (IDR_PER_USDC) turns one currency into the other; the order keeps the rupiah, the rate and
// the USDC mandate (micro-USDC).
export async function POST(req: Request) {
  const b = await readJson(req);
  if (!b) return fail(400, "Invalid JSON body");
  const budget = budgetFromBody(b, idrPerUsdc());
  if (!budget.ok) return fail(400, "Invalid order", budget.reasons);
  let preferredColors: unknown;
  if (b.preferredColors !== undefined && b.preferredColors !== null) {
    const colors = parseColorChoices(b.preferredColors, studioPalette(listPrinters()));
    if (!colors.ok) return fail(400, "Invalid order", colors.reasons);
    preferredColors = colors.choices;
  }
  const r = createOrder({
    product: str(b.product), quantity: Number(b.quantity), deadline: str(b.deadline),
    designVersion: str(b.designVersion), ...budget.budget,
    label: str(b.label) as "real" | "simulated", // validated in createOrder
    customerName: str(b.customerName),
    material: b.material, preferredColors, // validated in createOrder
  });
  return r.ok ? NextResponse.json({ order: r.order }, { status: 201 }) : failWith(r);
}

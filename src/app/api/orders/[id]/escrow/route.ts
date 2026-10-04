import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { deposit, openEscrow, refund, release, syncEscrow, topUpCustomer } from "@/lib/escrow";

const ACTIONS = { open: openEscrow, topup: topUpCustomer, deposit, release, refund } as const;

// GET: refresh pending Circle transfers once and return the escrow.
export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const r = await syncEscrow(id);
  if (!r.ok) return failWith(r);
  return NextResponse.json({ escrow: r.escrow });
}

// POST { action: "open" | "topup" | "deposit" | "release" | "refund" }
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const action = str(b?.action) as keyof typeof ACTIONS;
  if (!(action in ACTIONS)) return fail(400, `Expected { action: ${Object.keys(ACTIONS).join(" | ")} }`);
  const r = await ACTIONS[action](id);
  if (!r.ok) return failWith(r);
  return NextResponse.json(r, { status: action === "open" ? 201 : 200 });
}

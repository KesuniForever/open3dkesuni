import { NextResponse } from "next/server";
import { listLog } from "@/lib/store";
import { planOrder } from "@/lib/agent/planner";
import type { Ctx } from "@/lib/http";

// Runs the planner (rule-based, no LLM yet). Returns the outcome and the full tool log.
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const result = planOrder(id);
  return NextResponse.json({ result, log: listLog(id) });
}

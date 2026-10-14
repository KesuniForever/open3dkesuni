import { NextResponse } from "next/server";
import { listLog } from "@/lib/store";
import { runChief } from "@/lib/agent/chief";
import type { Ctx } from "@/lib/http";

// Runs the Chief Kesuni Officer on this order (Claude, or the rule-based planner without an API key).
export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const result = await runChief(id, "The operator pressed Run agent.");
  return NextResponse.json({ result, log: listLog(id) });
}

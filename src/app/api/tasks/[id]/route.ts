import { NextResponse } from "next/server";
import { failWith, readJson, str, type Ctx } from "@/lib/http";
import { completeTask } from "@/lib/printer/actions";

// POST { by } — a person marks an operator task done.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  const r = completeTask(id, str(b?.by));
  if (!r.ok) return failWith(r);
  return NextResponse.json({ task: r.task });
}

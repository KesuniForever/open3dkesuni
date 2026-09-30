import { NextResponse } from "next/server";
import { recordAcceptance } from "@/lib/actions";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// Acceptance is a human decision. It is never derived from model output.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b || typeof b.accepted !== "boolean") return fail(400, "Expected { accepted: boolean, by: string, note: string }");
  const r = recordAcceptance(id, { accepted: b.accepted, by: str(b.by), note: str(b.note) });
  return r.ok ? NextResponse.json({ acceptance: r.acceptance, order: r.order }) : failWith(r);
}

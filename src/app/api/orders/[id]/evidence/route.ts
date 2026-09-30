import { NextResponse } from "next/server";
import { addEvidence } from "@/lib/actions";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Invalid JSON body");
  const r = addEvidence(id, { kind: str(b.kind), note: str(b.note), label: str(b.label) });
  return r.ok ? NextResponse.json({ evidence: r.evidence }, { status: 201 }) : failWith(r);
}

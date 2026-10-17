import { NextResponse } from "next/server";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";
import { replaceCustomerToken } from "@/lib/actions";

// POST { by } — the operator order page gives the order a new customer link; the old one stops working at once (for a
// link seen where it should not be, like a video). Behind the operator password (src/proxy.ts), like every operator
// route. Not an agent tool; moves no money and no printer; writes a decision-log row with who did it, never a token.
// 200 { customerLink }: the new link's path, /c/<token>.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { by }");
  const r = replaceCustomerToken(id, { by: str(b.by) });
  if (!r.ok) return failWith(r);
  return NextResponse.json({ customerLink: `/c/${r.customerToken}` });
}

import { NextResponse } from "next/server";
import { postCustomerMessage } from "@/lib/messages";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// A person at Kesuni writes a short update on the customer's page: POST { text, textId?, by?: "human" } (textId: the same
// message in Indonesian, shown when the customer reads in Indonesian; without it they read the English).
// Only the Chief writes as "agent" (through its tool), so the page never mislabels who wrote what.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { text }");
  if (b.by !== undefined && b.by !== "human") return fail(400, 'Operators write as "human"; only the Chief writes as "agent"');
  const r = postCustomerMessage(id, { text: str(b.text), textId: str(b.textId) }, "human");
  return r.ok ? NextResponse.json({ message: r.message }) : failWith(r);
}

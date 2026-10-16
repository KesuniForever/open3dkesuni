import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { approveByOwner } from "@/lib/actions";
import { ownerRuleReasons } from "@/lib/owner-rules";
import { wakeChief } from "@/lib/agent/chief";
import { agentText } from "@/lib/agent/tools";
import { fail, failWith, readJson, str, type Ctx } from "@/lib/http";

// The owner allows an exception to their rules for one quote of one order. Not an agent tool.
// Body: { quoteId?, by, note }. Without quoteId, the order's only quote that the owner can approve is used.
// Then the Chief is woken to continue (choose the plan); in rules mode the operator runs the agent. An approval the
// policy would still refuse for a reason the owner cannot lift is refused (422, nothing saved, no wake). A price above
// the customer's budget is saved but waits on the customer (their page offers to raise the budget): no wake then.
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const b = await readJson(req);
  if (!b) return fail(400, "Expected { quoteId, by, note }");
  const order = store.getOrder(id);
  let quoteId = str(b.quoteId);
  if (!quoteId && order) {
    const approvable = store.listQuotes(id).filter((q) => ownerRuleReasons(order, q).ownerCanApprove);
    if (approvable.length !== 1) return fail(400, "Say which quote the owner approves (quoteId)");
    quoteId = approvable[0].id;
  }
  const r = approveByOwner(id, { quoteId, by: str(b.by), note: str(b.note) });
  if (!r.ok) return failWith(r);
  if (r.waitsOnCustomer) {
    return NextResponse.json({ order: r.order, waitsOnCustomer: true, note: "Approved. The price is above the customer's budget: their order page offers to raise it." });
  }
  // The owner's note goes to Claude as agentText: it may name the customer.
  wakeChief(id, `The owner approved an exception for quote ${quoteId}: "${agentText(r.order.ownerApproval!.note, r.order)}". Choose the plan now if the rules allow it.`);
  return NextResponse.json({ order: r.order, waitsOnCustomer: false });
}

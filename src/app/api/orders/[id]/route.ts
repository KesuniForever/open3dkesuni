import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, type Ctx } from "@/lib/http";
import { ensureCustomerToken } from "@/lib/actions";
import { agreementCurrent } from "@/lib/agreement";
import { idrPerUsdc } from "@/lib/costing";
import { agentMode, agentModel } from "@/lib/agent/chief";
import { ownerRuleReasons, ownerRules } from "@/lib/owner-rules";
import { pricingConfig } from "@/lib/pricing";
import { publicNetwork } from "@/lib/network";

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!store.getOrder(id)) return fail(404, "Order not found");
  const customerLink = `/c/${ensureCustomerToken(id)}`;
  return NextResponse.json({
    order: store.getOrder(id)!,
    customerLink,
    agreementCurrent: agreementCurrent(store.getOrder(id)!),
    idrPerUsdc: idrPerUsdc(),
    agent: { mode: agentMode(), model: agentModel() },
    ownerRules: ownerRules(),
    pricing: pricingConfig(),
    network: publicNetwork(store.getEscrow(id)?.network),
    // Owner-rule refusals per quote, so the owner sees what they would be approving.
    ownerChecks: store.listQuotes(id).map((q) => ({ quoteId: q.id, ...ownerRuleReasons(store.getOrder(id)!, q) })),
    vendors: store.listVendors(),
    quotes: store.listQuotes(id),
    decisions: store.listDecisions(id),
    evidence: store.listEvidence(id),
    acceptance: store.getAcceptance(id) ?? null,
    agentLog: store.listLog(id),
    paymentIntents: store.listIntents(id),
    escrow: store.getEscrow(id) ?? null,
    tasks: store.listTasks(id),
    attachments: store.listAttachments(id),
    messages: store.listMessages(id),
    printers: store.listPrinters(),
  });
}

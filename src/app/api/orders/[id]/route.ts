import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { fail, type Ctx } from "@/lib/http";
import { ensureCustomerToken } from "@/lib/actions";
import { agreementCurrent } from "@/lib/agreement";
import { idrPerUsdc } from "@/lib/costing";

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!store.getOrder(id)) return fail(404, "Order not found");
  const customerLink = `/c/${ensureCustomerToken(id)}`;
  return NextResponse.json({
    order: store.getOrder(id)!,
    customerLink,
    agreementCurrent: agreementCurrent(store.getOrder(id)!),
    idrPerUsdc: idrPerUsdc(),
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
    printers: store.listPrinters(),
  });
}

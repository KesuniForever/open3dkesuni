// Numbers for the operator's home page. Read-only. Real and simulated money are never added together.
import * as store from "./store";
import { notReadyReason } from "./printer/actions";
import { reputation, type Reputation } from "./reputation";
import type { Order, OperatorTask } from "./types";

export interface Attention { orderId: string; product: string; text: string; kind: "task" | "price" | "pay" | "decide" | "report" }

export interface Dashboard {
  activeReal: number;
  activeSimulated: number;
  escrowHeldMicro: { real: number; simulated: number };   // FUNDED, waiting for the customer's decision
  releasedMicro: { real: number; simulated: number };     // paid out to Kesuni
  printersOnline: number;
  printersTotal: number;
  attention: Attention[];
  reputation: Reputation;
}

const ACTIVE = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED"];

export function dashboard(): Dashboard {
  const orders = store.listOrders();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const held = { real: 0, simulated: 0 };
  const released = { real: 0, simulated: 0 };
  const attention: Attention[] = [];
  const bucket = (o: Order) => (o.label === "real" ? "real" : "simulated");

  for (const o of orders) {
    const e = store.getEscrow(o.id);
    if (e?.state === "FUNDED") held[bucket(o)] += e.amountMicro;
    if (e?.state === "RELEASED") released[bucket(o)] += e.amountMicro;
    const add = (kind: Attention["kind"], text: string) => attention.push({ orderId: o.id, product: o.product, kind, text });
    if (o.status === "CREATED") add("price", store.listQuotes(o.id).length ? "Run the agent to choose a plan" : "Needs a price: open the cost calculator");
    if (o.status === "PLAN_CHOSEN" && (!e || e.state === "AWAITING_DEPOSIT")) add("pay", "Waiting for the customer to approve and pay");
    if (o.status === "EVIDENCE_SUBMITTED") add("decide", "Waiting for the customer to accept or reject");
    if (["EVIDENCE_SUBMITTED", "ACCEPTED", "PAID"].includes(o.status) && !o.actual && o.label === "real") add("report", "Report what production used (plan vs actual)");
  }
  // The same reminder can be raised many times (e.g. on every printer report): show it once, with a count.
  const tasks = new Map<string, Attention & { n: number }>();
  for (const t of store.listOpenTasks() as OperatorTask[]) {
    const key = `${t.orderId}
${t.text}`;
    const seen = tasks.get(key);
    if (seen) seen.n++;
    else tasks.set(key, { orderId: t.orderId, product: byId.get(t.orderId)?.product ?? t.orderId, kind: "task", text: t.text, n: 1 });
  }
  attention.unshift(...[...tasks.values()].map(({ n, ...a }) => ({ ...a, text: n > 1 ? `${a.text} (×${n})` : a.text })));
  const printers = store.listPrinters();
  return {
    activeReal: orders.filter((o) => o.label === "real" && ACTIVE.includes(o.status)).length,
    activeSimulated: orders.filter((o) => o.label !== "real" && ACTIVE.includes(o.status)).length,
    escrowHeldMicro: held,
    releasedMicro: released,
    printersOnline: printers.filter((p) => !(notReadyReason(p) ?? "").startsWith("offline")).length,
    printersTotal: printers.length,
    attention,
    reputation: reputation(orders),
  };
}

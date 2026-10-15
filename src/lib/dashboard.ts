// Numbers for the operator's home page. Read-only. Real and simulated money are never added together, and real
// money is counted per network from each escrow's own label: testnet escrows stay "test USDC" after a mainnet switch.
import * as store from "./store";
import { isPrinterRef, notReadyReason } from "./printer/actions";
import { reputation, type Reputation } from "./reputation";
import type { Escrow, Order, OperatorTask } from "./types";

export interface Attention {
  orderId: string;
  product: string;
  text: string;
  kind: "task" | "price" | "pay" | "decide" | "report" | "printer";
  /** Where the item links to; the order page when missing. Printer faults without an order go to /machines. */
  href?: string;
  printerId?: string;
}

/** Real orders by the escrow's network; simulated (test) orders apart. */
export interface Money { testnet: number; mainnet: number; simulated: number }

export interface Dashboard {
  activeReal: number;
  activeSimulated: number;
  escrowHeldMicro: Money;   // FUNDED, waiting for the customer's decision
  releasedMicro: Money;     // paid out to Kesuni
  printersOnline: number;
  printersTotal: number;
  attention: Attention[];
  reputation: Reputation;
}

const ACTIVE = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED"];

export function dashboard(): Dashboard {
  const orders = store.listOrders();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const held: Money = { testnet: 0, mainnet: 0, simulated: 0 };
  const released: Money = { testnet: 0, mainnet: 0, simulated: 0 };
  const attention: Attention[] = [];
  const bucket = (o: Order, e: Escrow): keyof Money => (o.label !== "real" ? "simulated" : e.label === "mainnet" ? "mainnet" : "testnet");

  for (const o of orders) {
    const e = store.getEscrow(o.id);
    if (e?.state === "FUNDED") held[bucket(o, e)] += e.amountMicro;
    if (e?.state === "RELEASED") released[bucket(o, e)] += e.amountMicro;
    const add = (kind: Attention["kind"], text: string) => attention.push({ orderId: o.id, product: o.product, kind, text });
    if (o.status === "CREATED") add("price", store.listQuotes(o.id).length ? "Run the agent to choose a plan" : "Needs a price: grams per unit from the slicer (price by weight)");
    if (o.status === "PLAN_CHOSEN" && (!e || e.state === "AWAITING_DEPOSIT")) add("pay", "Waiting for the customer to approve and pay");
    if (o.status === "EVIDENCE_SUBMITTED") add("decide", "Waiting for the customer to accept or reject");
    if (["EVIDENCE_SUBMITTED", "ACCEPTED", "PAID"].includes(o.status) && !o.actual && o.label === "real") add("report", "Report what production used (plan vs actual)");
  }
  // The same reminder can be raised many times (e.g. on every printer report): show it once, with a count.
  // Printer faults (HMS, print errors) come first: they stop printing until a person looks.
  const printers = store.listPrinters();
  const printerName = (id?: string) => printers.find((p) => p.id === id)?.name ?? id ?? "";
  const tasks = new Map<string, Attention & { n: number }>();
  for (const t of store.listOpenTasks() as OperatorTask[]) {
    const key = `${t.orderId}
${t.text}`;
    const seen = tasks.get(key);
    if (seen) { seen.n++; continue; }
    const order = byId.get(t.orderId);
    const href = order ? undefined : isPrinterRef(t.orderId) || t.printerId ? "/machines" : undefined;
    tasks.set(key, {
      orderId: t.orderId, product: order?.product ?? (t.printerId ? printerName(t.printerId) : t.orderId),
      kind: t.errorCode ? "printer" : "task", text: t.text, n: 1, ...(href ? { href } : {}), ...(t.printerId ? { printerId: t.printerId } : {}),
    });
  }
  const items = [...tasks.values()].map(({ n, ...a }) => ({ ...a, text: n > 1 ? `${a.text} (×${n})` : a.text }));
  attention.unshift(...items.filter((a) => a.kind === "printer"), ...items.filter((a) => a.kind !== "printer"));
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

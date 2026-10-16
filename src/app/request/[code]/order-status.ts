// "My orders" in the customer portal: one short status per order, from the same view the order page reads
// (GET /api/c/<token>), in the same order of checks as the order page's headline; and the order link in whatever the
// customer pasted. Pure, so the browser and the tests use the same rules.
import type { CustomerView } from "@/lib/customer";

export type OrderStage =
  | "weighing" | "preparing" | "price" | "paying" | "waiting" | "printing" | "paused" | "checking" | "check" | "done" | "refunding" | "refunded";

export interface OrderStatus {
  stage: OrderStage;
  /** English; the page translates it ("Printing {pct}" gets the percent). */
  text: string;
  /** The badge colour. */
  tone: "" | "ok" | "warn" | "testnet";
  /** The customer has something to do on the order page: pay, or accept or reject the item. */
  yourTurn: boolean;
  /** Only while printing. */
  percent: number | null;
}

const PRINTING = ["RUNNING", "PREPARE", "SLICING"];
const status = (stage: OrderStage, text: string, tone: OrderStatus["tone"], yourTurn = false): OrderStatus =>
  ({ stage, text, tone, yourTurn, percent: null });

export function orderStatus(
  v: Pick<CustomerView, "order" | "escrow" | "paying" | "printing" | "printedOn"> & { design?: Pick<NonNullable<CustomerView["design"]>, "state"> | null },
): OrderStatus {
  const s = v.order.status;
  const funded = Boolean(v.escrow && v.escrow.state !== "AWAITING_DEPOSIT");
  if (s === "PAID" || s === "ACCEPTED") return status("done", "Done", "ok");
  if (s === "REJECTED") return v.escrow?.state === "REFUNDED" ? status("refunded", "Refunded", "") : status("refunding", "Refunding", "testnet");
  // The customer's own design is being weighed for the price (the order page says the same).
  if (s === "CREATED") return v.design?.state === "weighing" ? status("weighing", "Weighing your design", "") : status("preparing", "Preparing your price", "");
  if (!funded) return v.paying ? status("paying", "Processing payment", "testnet") : status("price", "Price ready", "warn", true);
  if (s === "EVIDENCE_SUBMITTED") return status("check", "Ready to check", "warn", true);
  if (v.printing && PRINTING.includes(v.printing.state)) {
    return { ...status("printing", "Printing {pct}", "testnet"), percent: Math.max(0, Math.min(100, Math.round(v.printing.percent))) };
  }
  if (v.printing?.state === "PAUSE") return status("paused", "Print paused", "warn");
  if (v.printedOn) return status("checking", "Quality check", "testnet");
  return status("waiting", "Waiting for a printer", "testnet");
}

/** "/c/<token>" from a pasted order link (the whole address, or only its path), or null when it holds none. */
export function orderLinkFrom(text: string): string | null {
  const m = /(?:^|\/)c\/([A-Za-z0-9_-]{16,64})(?=$|[/?#\s])/.exec(text.trim());
  return m ? `/c/${m[1]}` : null;
}

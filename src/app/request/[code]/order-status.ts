// "My orders" in the customer portal: one short status per order, from the same view the order page reads
// (GET /api/c/<token>), in the same order of checks as the order page's headline; and the order link in whatever the
// customer pasted. Pure, so the browser and the tests use the same rules.
import type { CustomerView } from "@/lib/customer";

export type OrderStage =
  | "weighing" | "preparing" | "budget" | "price" | "paying" | "unpaid" | "waiting" | "printing" | "paused" | "checking" | "check" | "done"
  | "refunding" | "refunded";

export interface OrderStatus {
  stage: OrderStage;
  /** English; the page translates it ("Printing {pct}" gets the percent). */
  text: string;
  /** The badge colour. */
  tone: "" | "ok" | "warn" | "testnet";
  /** The customer has something to do on the order page: raise their budget to Kesuni's price, pay (also once production
   *  started before the payment), or accept or reject. */
  yourTurn: boolean;
  /** Only while printing. */
  percent: number | null;
  /** The text's other {placeholders} ("Printed {printed} of {total}"). */
  vars?: Record<string, number>;
}

const PRINTING = ["RUNNING", "PREPARE", "SLICING"];
const status = (stage: OrderStage, text: string, tone: OrderStatus["tone"], yourTurn = false): OrderStatus =>
  ({ stage, text, tone, yourTurn, percent: null });

export function orderStatus(
  v: Pick<CustomerView, "order" | "escrow" | "paying" | "printing" | "printedOn"> & { design?: Pick<NonNullable<CustomerView["design"]>, "state"> | null }
    & Partial<Pick<CustomerView, "overBudget" | "budgetRaised" | "pieces">>,
): OrderStatus {
  const s = v.order.status;
  const funded = Boolean(v.escrow && v.escrow.state !== "AWAITING_DEPOSIT");
  if (s === "PAID" || s === "ACCEPTED") return status("done", "Done", "ok");
  if (s === "REJECTED") return v.escrow?.state === "REFUNDED" ? status("refunded", "Refunded", "") : status("refunding", "Refunding", "testnet");
  // Kesuni's price is above the customer's budget: their turn to raise it on the order page (or message Kesuni).
  if (s === "CREATED" && v.overBudget) return status("budget", "Above your budget", "warn", true);
  // They raised it: Kesuni prepares the agreement at that price (the order page says the same).
  if (s === "CREATED" && v.budgetRaised) return status("preparing", "Preparing your agreement", "");
  // The customer's own design is being weighed for the price (the order page says the same).
  if (s === "CREATED") return v.design?.state === "weighing" ? status("weighing", "Weighing your design", "") : status("preparing", "Preparing your price", "");
  if (v.paying && !funded) return status("paying", "Processing payment", "testnet");
  if (!funded && s === "PLAN_CHOSEN") return status("price", "Price ready", "warn", true);
  // Production may start before the payment (a person can print an unpaid order): the stage follows the order, and the
  // payment stays the customer's turn. Accepting waits for it, so an unpaid finished item reads "Payment still open".
  const pay = !funded;
  if (s === "EVIDENCE_SUBMITTED") return pay ? status("unpaid", "Payment still open", "warn", true) : status("check", "Your turn: check the item", "warn", true);
  if (v.printing && PRINTING.includes(v.printing.state)) {
    return { ...status("printing", "Printing {pct}", "testnet", pay), percent: Math.max(0, Math.min(100, Math.round(v.printing.percent))) };
  }
  if (v.printing?.state === "PAUSE") return status("paused", "Print paused", "warn", pay);
  // Between two runs of an order printed piece by piece: still printing (printedOn waits for the last run).
  if (v.pieces && v.pieces.printed > 0) return { ...status("printing", "Printed {printed} of {total}", "testnet", pay), vars: v.pieces };
  if (v.printedOn) return status("checking", "Quality check", "testnet", pay);
  return pay ? status("unpaid", "Payment still open", "warn", true) : status("waiting", "Waiting for a printer", "testnet");
}

/** "/c/<token>" from a pasted order link (the whole address, or only its path), or null when it holds none. */
export function orderLinkFrom(text: string): string | null {
  const m = /(?:^|\/)c\/([A-Za-z0-9_-]{16,64})(?=$|[/?#\s])/.exec(text.trim());
  return m ? `/c/${m[1]}` : null;
}

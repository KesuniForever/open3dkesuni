// "Done (debug)": the rules that need no store, shared by the app (src/lib/printer/done-debug.ts) and the order page.
// Pure: the browser imports this file too.
import type { Order } from "../types";

/** Orders in production: a plan is chosen and QC has not started. Same as the dispatcher's PRODUCTION_STATUSES. */
export const DEBUG_DONE_STATUSES: readonly Order["status"][] = ["PLAN_CHOSEN", "IN_PRODUCTION"];
export const REAL_ORDER_TEXT = "Only test orders can be marked printed without a print";
export const ON_ITS_WAY_TEXT = "A print of this order is on its way: stop it first";

/** The order may be marked now: not real, in production, not marked yet. The order page shows "Done (debug)" for these. */
export const canMarkPrintDoneDebug = (o: Pick<Order, "label" | "status" | "printDoneDebug">): boolean =>
  o.label !== "real" && DEBUG_DONE_STATUSES.includes(o.status) && !o.printDoneDebug;

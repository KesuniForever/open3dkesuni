// Deterministic policy engine. Pure functions, no I/O, no LLM.
// The model may propose; only these checks decide.
import type {
  Acceptance,
  Escrow,
  Evidence,
  Order,
  PaymentIntent,
  PolicyResult,
  Quote,
  Vendor,
} from "./types";

const MICRO = 1_000_000;

/** Parse a decimal USDC string ("32.5") into micro-USDC. Rejects >6 decimals. */
export function usdcToMicro(input: string): number {
  if (!/^\d+(\.\d{1,6})?$/.test(input)) {
    throw new Error(`Invalid USDC amount "${input}" (max 6 decimals, digits only)`);
  }
  const [whole, frac = ""] = input.split(".");
  return Number(whole) * MICRO + Number(frac.padEnd(6, "0"));
}

export function microToUsdc(micro: number): string {
  if (!Number.isInteger(micro) || micro < 0) throw new Error("micro must be a non-negative integer");
  const whole = Math.floor(micro / MICRO);
  const frac = String(micro % MICRO).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

const result = (reasons: string[]): PolicyResult => ({ ok: reasons.length === 0, reasons });

/** Can this quote be chosen for this order? */
export function checkPlan(order: Order, quote: Quote, vendor: Vendor | undefined): PolicyResult {
  const r: string[] = [];
  if (quote.orderId !== order.id) r.push("Quote belongs to a different order");
  if (!vendor) r.push("Unknown vendor");
  else if (!vendor.approved) r.push(`Vendor ${vendor.id} is not approved`);
  if (!Number.isInteger(quote.priceMicro) || quote.priceMicro <= 0) r.push("Quote price must be a positive integer (micro-USDC)");
  if (quote.priceMicro > order.mandateMicro) {
    r.push(`Quote ${microToUsdc(quote.priceMicro)} USDC exceeds mandate ${microToUsdc(order.mandateMicro)} USDC`);
  }
  const deadlineMs = Date.parse(order.deadline);
  if (Number.isNaN(deadlineMs)) r.push("Order deadline is invalid");
  return result(r);
}

/** May a payment intent be created? Acceptance and evidence are prerequisites. */
export function checkPaymentIntent(args: {
  order: Order;
  chosenQuote: Quote | undefined;
  vendor: Vendor | undefined;
  evidence: Evidence[];
  acceptance: Acceptance | undefined;
  existingIntents: PaymentIntent[];
  proposed: { recipient: string; amountMicro: number; idempotencyKey: string };
}): PolicyResult {
  const { order, chosenQuote, vendor, evidence, acceptance, existingIntents, proposed } = args;
  const r: string[] = [];

  if (!chosenQuote) r.push("No plan chosen for this order");
  if (!acceptance || !acceptance.accepted) r.push("Order has not been accepted");
  if (!evidence.some((e) => e.kind === "qc")) r.push("No QC evidence recorded");

  if (!vendor || !vendor.approved) r.push("Recipient vendor is not approved");
  else if (proposed.recipient.toLowerCase() !== vendor.address.toLowerCase()) {
    r.push("Recipient address does not match the approved vendor address");
  }

  if (!Number.isInteger(proposed.amountMicro) || proposed.amountMicro <= 0) {
    r.push("Amount must be a positive integer (micro-USDC)");
  } else {
    if (chosenQuote && proposed.amountMicro !== chosenQuote.priceMicro) {
      r.push("Amount does not equal the accepted quote price");
    }
    if (proposed.amountMicro > order.mandateMicro) r.push("Amount exceeds order mandate");
  }

  // Duplicate protection. Same key is an idempotent replay (handled by caller);
  // a different key for an order that already has a live intent is refused.
  const live = existingIntents.filter(
    (i) => i.orderId === order.id && i.idempotencyKey !== proposed.idempotencyKey,
  );
  if (live.length > 0) r.push("Order already has a payment intent");

  return result(r);
}

const isAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);
/** Seed/demo addresses like 0x000…0001 belong to nobody: USDC sent there is lost. */
export const isPlaceholderAddress = (a: string) => /^0x0{36}[0-9a-fA-F]{4}$/.test(a);

/** May the escrow be opened? The amount is fixed to the chosen quote's price. */
export function checkEscrowOpen(order: Order, chosenQuote: Quote | undefined, existing: Escrow | undefined): PolicyResult {
  const r: string[] = [];
  if (existing) r.push("Order already has an escrow");
  if (!chosenQuote) r.push("Choose a plan first: the escrow amount is the chosen quote's price");
  else if (chosenQuote.priceMicro > order.mandateMicro) r.push("Quote exceeds order mandate");
  if (["ACCEPTED", "REJECTED", "PAID"].includes(order.status)) r.push(`Order is ${order.status}; too late to open an escrow`);
  return result(r);
}

/**
 * May the escrow be released to the shop? Same prerequisites as a payment intent,
 * plus: escrow is funded, holds at least the amount, and nothing was released or refunded yet.
 */
export function checkRelease(args: {
  order: Order;
  chosenQuote: Quote | undefined;
  vendor: Vendor | undefined;
  evidence: Evidence[];
  acceptance: Acceptance | undefined;
  escrow: Escrow | undefined;
  escrowBalanceMicro: number;
}): PolicyResult {
  const { order, chosenQuote, vendor, evidence, acceptance, escrow, escrowBalanceMicro } = args;
  const r: string[] = [];
  if (!escrow) return result(["Order has no escrow"]);
  if (escrow.state !== "FUNDED") r.push(`Escrow is ${escrow.state}, not FUNDED`);
  if (!chosenQuote) r.push("No plan chosen for this order");
  if (!acceptance || !acceptance.accepted) r.push("Order has not been accepted by the customer");
  if (!evidence.some((e) => e.kind === "qc")) r.push("No QC evidence recorded");
  if (!vendor || !vendor.approved) r.push("Recipient vendor is not approved");
  else if (!isAddress(vendor.address)) r.push("Vendor payout address is not a valid address");
  else if (isPlaceholderAddress(vendor.address)) r.push(`Vendor payout address ${vendor.address} is a placeholder; set a real address first`);
  if (chosenQuote && escrow.amountMicro !== chosenQuote.priceMicro) r.push("Escrow amount does not equal the accepted quote price");
  if (escrow.amountMicro > order.mandateMicro) r.push("Escrow amount exceeds order mandate");
  if (escrowBalanceMicro < escrow.amountMicro) {
    r.push(`Escrow holds ${microToUsdc(escrowBalanceMicro)} USDC, needs ${microToUsdc(escrow.amountMicro)} USDC`);
  }
  if (escrow.txs.some((t) => (t.kind === "release" || t.kind === "refund") && !["FAILED", "DENIED", "CANCELLED"].includes(t.state))) {
    r.push("A release or refund is already in progress or done");
  }
  return result(r);
}

/** May the escrow be refunded to the customer? Only after the customer rejected the goods. */
export function checkRefund(args: {
  acceptance: Acceptance | undefined;
  escrow: Escrow | undefined;
  escrowBalanceMicro: number;
}): PolicyResult {
  const { acceptance, escrow, escrowBalanceMicro } = args;
  const r: string[] = [];
  if (!escrow) return result(["Order has no escrow"]);
  if (escrow.state !== "FUNDED") r.push(`Escrow is ${escrow.state}, not FUNDED`);
  if (!acceptance || acceptance.accepted) r.push("Refund needs the customer to reject the order first");
  if (!isAddress(escrow.customerAddress)) r.push("Customer refund address is not a valid address");
  if (escrowBalanceMicro < escrow.amountMicro) {
    r.push(`Escrow holds ${microToUsdc(escrowBalanceMicro)} USDC, needs ${microToUsdc(escrow.amountMicro)} USDC`);
  }
  if (escrow.txs.some((t) => (t.kind === "release" || t.kind === "refund") && !["FAILED", "DENIED", "CANCELLED"].includes(t.state))) {
    r.push("A release or refund is already in progress or done");
  }
  return result(r);
}

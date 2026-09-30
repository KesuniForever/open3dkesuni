// Deterministic policy engine. Pure functions, no I/O, no LLM.
// The model may propose; only these checks decide.
import type {
  Acceptance,
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

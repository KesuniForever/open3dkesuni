import type { PaymentState } from "./types";

// UNKNOWN means the response was lost: check the original transaction, never blind-retry.
const ALLOWED: Record<PaymentState, PaymentState[]> = {
  ALLOCATED: ["PAYMENT_INTENT_CREATED"],
  PAYMENT_INTENT_CREATED: ["SUBMITTED"],
  SUBMITTED: ["CONFIRMED", "UNKNOWN", "PARTIALLY_PAID"],
  UNKNOWN: ["CONFIRMED", "SUBMITTED", "PARTIALLY_PAID"], // only after checking the original tx
  PARTIALLY_PAID: ["CONFIRMED"],
  CONFIRMED: [],
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) throw new Error(`Illegal payment transition ${from} -> ${to}`);
}

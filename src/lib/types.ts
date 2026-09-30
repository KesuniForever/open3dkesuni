// Shared API contract types. Frontend and backend both import from here.
// Money is always integer micro-USDC (6 decimals). Never floats.

export type Label = "simulated" | "real" | "manual" | "local" | "testnet" | "mainnet";

export type OrderStatus =
  | "CREATED"
  | "PLAN_CHOSEN"
  | "IN_PRODUCTION"
  | "EVIDENCE_SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "PAID";

export type PaymentState =
  | "ALLOCATED"
  | "PAYMENT_INTENT_CREATED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "UNKNOWN"
  | "PARTIALLY_PAID";

export interface Vendor {
  id: string;
  name: string;
  address: string; // payee wallet address
  approved: boolean;
}

export interface Order {
  id: string;
  jobId: string;
  product: string;
  quantity: number;
  deadline: string; // ISO date
  designVersion: string;
  mandateMicro: number; // max spend, micro-USDC
  status: OrderStatus;
  chosenQuoteId?: string;
  label: Label;
}

export interface Quote {
  id: string;
  orderId: string;
  vendorId: string;
  priceMicro: number;
  etaHours: number;
  source: "own" | "partner";
}

export interface Decision {
  orderId: string;
  quoteId: string;
  decidedBy: "agent" | "human";
  reason: string;
  at: string;
}

export interface Evidence {
  id: string;
  orderId: string;
  kind: "log" | "photo" | "qc";
  note: string;
  label: Label;
  at: string;
}

export interface Acceptance {
  orderId: string;
  accepted: boolean;
  by: string;
  note: string;
  at: string;
}

export interface PaymentIntent {
  id: string;
  orderId: string;
  recipient: string;
  amountMicro: number;
  token: "USDC";
  network: string; // e.g. "ARC-TESTNET"
  idempotencyKey: string;
  state: PaymentState;
  txHash?: string;
  label: Label;
  createdAt: string;
}

export interface PolicyResult {
  ok: boolean;
  reasons: string[]; // empty when ok
}

export interface ApiError {
  error: string;
  reasons?: string[];
}

export interface AgentLogEntry {
  id: number;
  orderId: string;
  actor: "agent" | "human";
  tool: string;
  input: unknown;
  ok: boolean; // false when the tool refused or the policy blocked it
  output: unknown;
  at: string;
}

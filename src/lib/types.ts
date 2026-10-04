// Shared API contract types. Frontend and backend both import from here.
// Money is always integer micro-USDC (6 decimals). Never floats.
import type { PrinterSnapshot } from "./printer/bambu";

export type Label = "simulated" | "real" | "manual" | "device" | "local" | "testnet" | "mainnet";

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

// ---------- escrow (Circle developer-controlled SCA wallets on Arc) ----------

/** Circle transaction states. COMPLETE / FAILED / DENIED / CANCELLED are final. */
export type ChainTxState =
  | "NOT_SUBMITTED" // key saved, Circle call not confirmed yet (retry with the SAME key)
  | "INITIATED" | "CLEARED" | "QUEUED" | "SENT" | "CONFIRMED"
  | "COMPLETE" | "FAILED" | "DENIED" | "CANCELLED";

export interface ChainTx {
  kind: "customer_topup" | "deposit" | "release" | "refund";
  from: string;
  to: string;
  amountMicro: number;
  idempotencyKey: string; // UUID v4, saved before calling Circle
  circleTxId?: string;
  state: ChainTxState;
  txHash?: string;
  errorReason?: string;
  at: string;
}

export type EscrowState =
  | "AWAITING_DEPOSIT" // wallets exist, customer has not paid
  | "FUNDED"           // escrow holds the order amount
  | "RELEASED"         // paid to the shop after acceptance
  | "REFUNDED";        // returned to the customer after rejection

export interface Escrow {
  orderId: string;
  amountMicro: number; // = accepted quote price
  escrowWalletId: string;
  escrowAddress: string;
  customerWalletId: string;
  customerAddress: string;
  state: EscrowState;
  txs: ChainTx[];
  network: string; // e.g. "ARC-TESTNET"
  label: Label;    // "testnet" while on Arc testnet
  createdAt: string;
}

// ---------- printer + operator tasks ----------

export interface Printer {
  id: string;            // e.g. "a1"
  name: string;
  currentOrderId?: string; // the order this printer is printing for (linked by a person)
  snapshot?: PrinterSnapshot;
  lastSeen?: string;
}

/** Work only a person can do (change filament, collect the print, QC). Created by the agent or a person. */
export interface OperatorTask {
  id: string;
  orderId: string;
  kind: "change_filament" | "check_printer" | "collect_and_qc" | "reprint";
  text: string;
  status: "open" | "done";
  createdBy: "agent" | "human";
  at: string;
  doneAt?: string;
  doneBy?: string;
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

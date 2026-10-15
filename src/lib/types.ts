// Shared API contract types. Frontend and backend both import from here.
// Money is always integer micro-USDC (6 decimals). Never floats.
import type { PrinterSnapshot } from "./printer/bambu";
import type { CostInput } from "./costing";

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
  /** When the order was taken (ISO). Missing on orders made before this field existed. */
  createdAt?: string;
  /** Name the customer gave (no phone or address: those are never stored here or sent to the LLM). */
  customerName?: string;
  /** What the customer wrote about the order. */
  customerNote?: string;
  /** Secret part of the customer's link (/c/<token>). Anyone with the link can view and pay this order. */
  customerToken?: string;
  /** What exactly will be made, and the quality promised. Part of the agreement the customer approves. */
  spec?: Spec;
  /** The cost calculation behind Kesuni's own quote (rupiah). */
  costing?: { input: CostInput; quoteId: string; at: string };
  /** Kesuni's official price by weight (grams per unit from the slicer) behind its own quote. Rupiah. */
  gramPricing?: GramPricing;
  /** The customer approved this exact price and spec before paying. */
  agreement?: Agreement;
  /** What production actually used, reported by the operator after printing. */
  actual?: ActualReport;
  /** The customer's review, after the order is paid out. */
  review?: Review;
  /** The owner allowed an exception to their rules for one quote at one price (e.g. an order under the minimum
   *  value). A new or re-priced quote needs a new approval. Never set by the agent. */
  ownerApproval?: { quoteId: string; priceMicro: number; by: string; note: string; at: string };
  /** Grams per unit from the slicer, entered by a person at Kesuni. The only grams the agent may price with. */
  slicerGrams?: { gramsPerUnit: number; source: string; by: string; at: string };
}

export interface GramPricing {
  gramsPerUnit: number;
  quantity: number;
  pricePerGramIdr: number;
  costPerGramIdr: number;
  unitPriceIdr: number;
  totalIdr: number;
  costIdr: number;
  source: string;          // where the grams come from (slicer, operator note)
  quoteId: string;
  by: "agent" | "human";
  at: string;
}

export interface Spec {
  dimensions: string;      // "40 × 25 × 10 mm"
  toleranceMm: number;
  material: string;        // "PLA"
  color: string;
  layerMm: number;
  infillPct: number;
  finishing: string;       // "Standard"
  promise: string;         // how the result will be checked, in the customer's words
}

export interface Agreement {
  version: number;
  /** SHA-256 over the order, spec and chosen price. Any change to them needs a new approval. */
  hash: string;
  quoteId: string;
  priceMicro: number;
  by: string;
  at: string;
}

export interface ActualReport {
  filamentGrams: number;
  machineHours: number;
  costIdr: number;
  maxDeviationMm: number;
  unitsPassed: number;     // units that passed QC without rework
  note: string;
  by: string;
  at: string;
}

export interface Review {
  quality: number;         // 1–5
  communication: number;   // 1–5
  value: number;           // 1–5, worth the price
  text: string;
  by: string;
  at: string;
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
  attachmentId?: string; // the photo itself, for photo evidence
}

/** A file attached to an order. Bytes live in the file store under storageKey. */
export interface Attachment {
  id: string;
  orderId: string;
  kind: "design" | "reference" | "qc_photo";
  filename: string; // cleaned original name, for display and download only
  size: number;
  mime: string;
  uploadedBy: string;
  at: string;
  storageKey: string;
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
  /** Independent check of the COMPLETE tx on Arc over RPC (src/lib/arc-verify.ts). Read-only: never changes escrow
   *  state and never blocks a release or refund. ok=false means Arc does not show this transfer as recorded. */
  verified?: TxVerification;
}

export interface TxVerification {
  ok: boolean;
  at: string;
  /** chainId:txHash:logIndex of the one matching USDC Transfer log. */
  logId?: string;
  reason?: string;
  /** customer_topup: an internal test-USDC move from Kesuni's demo-funds wallet, not a customer payment. */
  internal?: boolean;
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
  id: string;            // "a1" (printer #1), "a1-2", "a1-3"
  name: string;
  currentOrderId?: string; // the order this printer is printing for (linked by a person or the agent)
  snapshot?: PrinterSnapshot;
  lastSeen?: string;
  /** The printer cannot see its bed. After a print ends we treat the bed as holding that order's part
   *  until a person marks it collected. */
  bedOccupiedBy?: string;
}

/** Work only a person can do (change filament, collect the print, QC). Created by the agent or a person. */
export interface OperatorTask {
  id: string;
  orderId: string;
  kind: "change_filament" | "check_printer" | "collect_and_qc" | "reprint" | "needs_info";
  printerId?: string;
  text: string;
  status: "open" | "done";
  createdBy: "agent" | "human";
  at: string;
  doneAt?: string;
  doneBy?: string;
}

/** A short update on the customer's order page (/c/<token>), by the Chief (AI) or a person at Kesuni. */
export interface CustomerMessage {
  id: string;
  orderId: string;
  text: string;
  by: "agent" | "human";
  at: string;
}

/** The Chief's daily report to the owner for one Jakarta day. `facts` is DailyFacts (src/lib/agent/daily-review.ts). */
export interface DailyReview {
  day: string;              // YYYY-MM-DD, Asia/Jakarta
  facts: unknown;
  text: string;             // simple English, sections as "## Heading" lines
  mode: "claude" | "template";
  model: string | null;     // null for the code template
  at: string;
  trigger: "schedule" | "button";
  error?: string;           // why Claude was not used, when it was tried and failed
  usage?: { input_tokens: number; output_tokens: number };
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

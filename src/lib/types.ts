// Shared API contract types. Frontend and backend both import from here.
// Money is always integer micro-USDC (6 decimals). Never floats.
import type { PrinterSnapshot } from "./printer/bambu";
import type { CostInput } from "./costing";
import type { ColorMode } from "./pricing";
import type { MeshSize } from "./mesh";

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
  /** Grams per unit from the slicer, entered by a person at Kesuni, or by "slicer" when the studio's slicer weighed the
   *  customer's own design (src/lib/auto-weigh.ts). The only grams the agent may price with.
   *  colorMode sets the print time; missing on rows saved before it existed, which means single colour. */
  slicerGrams?: { gramsPerUnit: number; source: string; by: string; at: string; colorMode?: ColorMode };
  /** The customer's budget in rupiah exactly as typed (or worked out from the USDC typed), with the rate used for
   *  mandateMicro (src/lib/costing.ts idrPerUsdc()). Missing on orders made before 15 Oct 2026: their budget is USDC only. */
  budgetIdr?: number;
  rateIdrPerUsdc?: number;
  /** The customer raised their budget to Kesuni's price on their order page (src/lib/budget-raise.ts), oldest first.
   *  budgetIdr and mandateMicro above are already the raised budget. */
  budgetRaises?: BudgetRaise[];
  /** Material chosen on the order. Older orders only have spec.material (free text). */
  material?: Material;
  /** Colours the customer picked from the spools loaded in the studio (GET /api/studio/colors). */
  preferredColors?: ColorChoice[];
  /** Agent prints for this order, set by a person (src/lib/printer/dispatch.ts setOrderRuns). Missing: 1 run on a real,
   *  paid order; an order that is not real is never printed by the agent until a person sets this. 0 = never. */
  autoPrint?: OrderAutoPrint;
  /** "Done (debug)" on the order page: a person marked this test order's printing as finished WITHOUT printing, to try
   *  QC and the customer's accept or reject quickly (src/lib/printer/done-debug.ts). Never on a real order, never set by
   *  the agent, and nothing was printed: the dispatcher counts its runs as printed (orderGate), printFinished says
   *  printed and the customer page says "Printing finished". A "simulated" log evidence and a log row record it. */
  printDoneDebug?: { by: string; at: string };
}

/**
 * One "Raise my budget" by the customer: from their budget to exactly the price of the quote Kesuni offered them
 * (src/lib/budget-raise.ts offeredQuote): the one the owner approved, else the official price by weight.
 */
export interface BudgetRaise {
  /** null: the order's budget was in USDC only (made before rupiah budgets existed). */
  fromIdr: number | null;
  toIdr: number;           // the offered quote in rupiah (gramPricing.totalIdr, or its USDC price at the order's rate)
  fromMicro: number;
  toMicro: number;         // the quote's priceMicro, exactly
  quoteId: string;
  source: "owner-approved" | "by-weight";
  by: string;              // the name the customer typed (never sent to the Chief)
  at: string;
}

export interface OrderAutoPrint {
  /** How many finished prints of this order are needed (each finished print job of the order counts one). */
  runsNeeded: number;
  by: string;
  at: string;
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
  /** Single or multi colour: sets the print time, never the price. Missing on rows saved before it existed (single). */
  colorMode?: ColorMode;
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
  /** What a Bambu Studio .3mf holds, read right after upload (src/lib/threemf.ts). Missing for other files. */
  parsed3mf?: ThreeMfInfo;
  /** An STL or OBJ: its size in mm and triangle count, read right after upload (src/lib/mesh.ts). Missing for other
   *  files, files uploaded before 16 Oct 2026 and meshes that could not be read. */
  mesh?: MeshSize;
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
  /** A person checked that the material and colour the printer shows for each AMS slot are the real spools (generic
   *  spools default to black). `key` is amsKey() of the trays then: a spool change makes the check stale. */
  colorsChecked?: { by: string; at: string; key: string };
  /** Faults the printer reports now (code -> first seen, ISO). A task is raised once per appearance. */
  faultsSeen?: Record<string, string>;
  /** The latest time a person confirmed the bed is empty. The agent may start ONE print on it (src/lib/printer/bed.ts). */
  bedCheck?: BedCheck;
  /** When a print last started and ended on this printer (server clock, from the reports; src/lib/printer/actions.ts). */
  lastPrintStartAt?: string;
  lastPrintEndAt?: string;
}

/**
 * A person's "Bed is empty" on one printer. Good for one print: the agent's next print uses it up (usedBy), and so does a
 * person's own print. A print that starts or ends on the printer before it is used voids it. Never set by the agent.
 */
export interface BedCheck {
  id: string;              // "BC-<printer>-<time>"
  by: string;              // the person
  at: string;
  /** "button": "Bed is empty" on My machines (POST /api/printers/:id/bed). "task": older rows only (a task marked done
   *  no longer gives a confirmation). */
  via: "button" | "task";
  /** The print job that used it up. */
  usedBy?: string;
  usedAt?: string;
  voidedAt?: string;
  voidReason?: string;
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
  /** Who opened it: the Chief (Claude), code (printer reports, the heartbeat, the dispatcher) or a person. Older tasks: none. */
  by?: "chief" | "code" | "person";
  at: string;
  doneAt?: string;
  doneBy?: string;
  /** The printer fault this task is about ("HMS_0510_0400_0001_0044" or "0700-8011"): one open task per printer and
   *  code, closed by itself when the printer stops reporting it. */
  errorCode?: string;
  /** Code-raised tasks of the agent dispatcher ("autoprint:load:PLA:#FFFFFF", "autoprint:failed:PJ-…"): one open task
   *  per key, closed by code when the cause is gone. */
  key?: string;
}

// ---------- materials, colours, sliced files, printing from the website (Bambu LAN, through the bridge) ----------

/** Materials Kesuni prints and prices by weight. */
export type Material = "PLA" | "PETG";

/** A colour the customer picked. Stored as material + colour, never as a tray (spools move between slots). */
export interface ColorChoice {
  type: Material;
  color: string;   // "#RRGGBB"
  name?: string;   // English colour name (src/lib/colors.ts nameOf), or the spool's name
}

/** One filament of a sliced plate. */
export interface ThreeMfFilament {
  id: number;            // 1-based index into the project's filament list (ams_mapping index = id - 1)
  type: string;          // "PLA", "PETG"
  color: string;         // "#RRGGBB"
  usedG: number | null;
  usedM?: number | null;
  infoIdx?: string | null; // filament preset, "GFA00"
}

export interface ThreeMfPlate {
  index: number;               // 1-based plate number; prints Metadata/plate_<index>.gcode
  predictionSec: number | null; // the slicer's total time estimate, including preparation
  weightG: number | null;      // all filaments of the plate
  filaments: ThreeMfFilament[]; // only the filaments this plate uses
  bedType?: string | null;     // "textured_plate": the person checks the plate on the printer
  nozzle?: string | null;      // "0.4"
  objects?: number;            // number of objects on the plate
}

/** What a Bambu Studio .3mf holds. Only a sliced file ("Export plate sliced file" -> *.gcode.3mf) can be printed. */
export interface ThreeMfInfo {
  sliced: boolean;             // at least one plate has G-code
  plates: ThreeMfPlate[];      // sliced plates only
  printerModel?: string;       // "Bambu Lab A1"
  printerModelId?: string;     // "N2S" = A1
  nozzle?: string;             // "0.4"
  /** Every filament in the project, in order: ams_mapping has one entry per filament here. */
  projectFilaments?: { type: string; color: string }[];
  slicerVersion?: string;
  /** Why the file could not be read (then sliced is false). */
  error?: string;
}

export interface PrintOptions {
  bedLevelling: boolean;   // auto bed levelling before the print (default on)
  flowCali: boolean;       // flow-dynamics calibration (about 1–2 min)
  timelapse: boolean;      // off by default: slows A1 prints
  useAms: boolean;         // false = external spool only
}

export type PrintJobState = "queued" | "uploading" | "sent" | "printing" | "done" | "failed" | "cancelled";

/**
 * A real print started from the website: by a person, or by the agent dispatcher (code, never Claude) after a person
 * confirmed the bed empty (src/lib/printer/jobs.ts createAgentPrintJob). The bridge uploads the file and starts it.
 */
export interface PrintJob {
  id: string;                // "PJ-<n>-<time>"
  orderId?: string;
  printerId: string;
  attachmentId: string;      // the sliced .gcode.3mf on the order
  plate: number;             // 1-based
  fileName: string;          // name on the SD card root, e.g. "ORD-012_p1_1792072000.gcode.3mf"
  amsMapping: number[];      // one entry per project filament: global AMS tray (ams*4 + slot) or -1 (not used)
  options: PrintOptions;
  state: PrintJobState;
  by: string;                // the person who started it (and confirmed the bed is empty)
  createdAt: string;
  updatedAt: string;
  error?: string;
  md5?: string;              // of the 3MF file, for the bridge to check its download
  subtaskName?: string;      // name shown on the printer screen
  /** "ftp": start with url ftp:///<name>, a person's retry when an A1 did not start with file:///sdcard/<name>. */
  urlForm?: "sdcard" | "ftp";
  /** Who started it: missing or "person" = a person (by), "agent" = the dispatcher (by is "agent"). */
  actor?: "person" | "agent";
  /** The bed check (Printer.bedCheck.id) this print used up, and the person who gave it. One print per bed check. */
  bedCheckId?: string;
  bedConfirmedBy?: string;
  /** The dispatcher's reasons for this print (agent prints only). */
  why?: string[];
  /** Agent prints: the spool in each mapped AMS tray when it was queued ("PLA", "#FEC600"). The app ("sent") and the
   *  bridge refuse to send it once a tray holds anything else. */
  expectedTrays?: { tray: number; type: string; color: string }[];
}

export type PrinterCommandKind = "pause" | "resume" | "stop" | "speed" | "light" | "get_version" | "camera_snapshot";
export type PrinterCommandState = "queued" | "sent" | "done" | "failed" | "expired";

/** A control for one printer, asked for by a person on the website and carried out by the bridge. */
export interface PrinterCommand {
  id: string;                // "PC-<n>-<time>"
  printerId: string;
  kind: PrinterCommandKind;
  params: Record<string, string | number | boolean>;  // speed: { level: 1..4 }; light: { on: boolean }; resume: { fixed?: true }
  state: PrinterCommandState;
  by: string;                // the person (read-only kinds: who opened the page)
  createdAt: string;
  doneAt?: string;
  result?: string;           // the printer's answer, or why it failed or expired
}

// ---------- slicing on the website (Bambu Studio's command line on the studio PC, through the LAN bridge) ----------

export type SliceQuality = "draft" | "standard" | "fine";
export type SliceJobState = "queued" | "slicing" | "done" | "failed" | "cancelled";

/**
 * One slice: the studio PC turns an order's STL/OBJ (or an unsliced A1 3MF) into a printable .gcode.3mf for the A1,
 * in ONE colour: the material and colour of the AMS spool that was picked. The result becomes a design file on the
 * order; "Colours & print" prints it like any sliced file. Write through src/lib/slicing.ts. Never prints anything.
 */
export interface SliceJob {
  id: string;                // "SJ-<n>-<time>"
  orderId: string;
  attachmentId: string;      // the source file on the order
  sourceName: string;        // its file name, for display (the bridge passes only a cleaned copy to the slicer)
  /** "mesh": STL/OBJ with the A1 presets below. "project": an unsliced A1 0.4 3MF with one filament keeps its own
   *  settings (quality, infill and supports are then the designer's) and gets the spool's filament and colour. */
  mode: "mesh" | "project";
  printerId: string;         // the printer whose spool was picked: Colours & print presets the AMS mapping to it
  tray: number;              // that spool's global AMS tray (ams*4 + slot), as in amsMapping
  material: Material;
  color: string;             // "#RRGGBB" of the spool when the slice was asked for
  quality: SliceQuality;
  infillPct: number;         // 0..100
  supports: "auto" | "off";  // auto = tree supports where needed
  /** Same source and settings = same key (src/lib/slice-rules.ts sliceKey): one active slice per key. */
  key: string;
  state: SliceJobState;
  /** "system": an automatic slice that only weighs the customer's own design for the price (src/lib/auto-weigh.ts). */
  actor: "person" | "agent" | "system";
  by: string;                // the person, "agent", or AUTO_WEIGH_BY
  /** The dispatcher's reasons, when the agent asked. */
  why?: string[];
  createdAt: string;
  updatedAt: string;
  error?: string;
  /** Why it failed or was cancelled. "model": the model or its output (the slicer refused it, a wrong or too large
   *  output, a timeout): the agent never asks for it again. "studio": the studio PC (not taken, went quiet, could not
   *  download or upload, no Bambu Studio). "person": a person cancelled it. "switch": agent prints were turned off. */
  failKind?: "model" | "studio" | "person" | "switch";
  /** The sliced .gcode.3mf stored on the order. */
  resultAttachmentId?: string;
  /** From the sliced file: the slicer's time (incl. preparation), grams, the price by weight, how long slicing took. */
  result?: { predictionSec: number | null; weightG: number | null; priceIdr: number | null; sliceMs?: number };
}

/** A short update on the customer's order page (/c/<token>), by the Chief (AI) or a person at Kesuni. */
export interface CustomerMessage {
  id: string;
  orderId: string;
  /** In English: the page shows it unless the customer reads in Indonesian and textId is set. */
  text: string;
  /** The same message in Indonesian. The Chief always writes it; a person may (older messages have none). */
  textId?: string;
  by: "agent" | "human";
  at: string;
  /** The order's status and escrow state when the Chief wrote it ("PLAN_CHOSEN/FUNDED"): a new one lets it write sooner. */
  stage?: string;
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
  /** Who really did it: Claude in a Chief run, code (rules, printer reports, the heartbeat) or a person. Older rows: none. */
  by?: "chief" | "code" | "person";
  tool: string;
  input: unknown;
  ok: boolean; // false when the tool refused or the policy blocked it
  output: unknown;
  at: string;
}

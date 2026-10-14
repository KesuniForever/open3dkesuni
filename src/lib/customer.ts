// What the customer can see and do through their private link (/c/<token>).
// The customer never sees wallet ids, vendor addresses, the agent log or other orders.
// Paying, accepting and rejecting go through the same actions and policy checks as the operator;
// after the customer decides, the agent releases or refunds the escrow on its own (policy-gated).
import * as store from "./store";
import { createOrder, recordAcceptance, type Fail } from "./actions";
import { deposit, openEscrow, refund, release, syncEscrow, topUpCustomer } from "./escrow";
import { circle } from "./circle";
import { microToUsdc } from "./policy";
import { notReadyReason } from "./printer/actions";
import { idrPerUsdc } from "./costing";
import { agreementCurrent, costingForChosen, gramPricingForChosen } from "./agreement";
import { isTestnetChain, publicNetwork, type PublicNetwork } from "./network";
import { quoteIdr } from "./owner-rules";
import { wakeChief } from "./agent/chief";
import type { ActualReport, ChainTx, Escrow, Order, Review, Spec } from "./types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const live = (t: ChainTx) => !["FAILED", "DENIED", "CANCELLED"].includes(t.state);
const PAYABLE = ["PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED"];

export { idrPerUsdc };

export const orderForToken = (token: string): Order | undefined =>
  /^[A-Za-z0-9_-]{16,64}$/.test(token) ? store.getOrderByToken(token) : undefined;

export interface CustomerView {
  order: Pick<Order, "id" | "product" | "quantity" | "deadline" | "status" | "label" | "customerName" | "customerNote">;
  price: { usdc: string; idr: number; etaHours: number } | null;
  escrow: {
    state: Escrow["state"]; amountUsdc: string; network: string; label: string;
    /** verifiedOnArc: true = checked on Arc and it matches, false = Arc does not match (Kesuni checks), absent = not checked yet. */
    txs: { kind: ChainTx["kind"]; amountUsdc: string; state: ChainTx["state"]; txHash?: string; at: string; verifiedOnArc?: boolean }[];
  } | null;
  paying: boolean;
  printing: { printer: string; state: string; percent: number; remainingMin: number | null; online: boolean } | null;
  printedOn: string | null;
  updates: { kind: string; note: string; label: string; at: string; photo?: string }[];
  /** Short updates from the Chief (AI) or a person at Kesuni, oldest first. Text, author kind and time only. */
  messages: { text: string; by: "agent" | "human"; at: string }[];
  acceptance: { accepted: boolean; by: string; note: string; at: string } | null;
  idrPerUsdc: number;
  spec: Spec | null;
  /** The customer must approve the current price and spec (this fingerprint) before paying. */
  agreement: { hash: string; version: number; by: string; at: string; current: boolean } | null;
  /** Where the money goes, when Kesuni priced the order with the cost calculator. Rupiah. */
  costs: { lines: { label: string; idr: number }[]; kesuniIdr: number; totalIdr: number } | null;
  /** How the price was made, when Kesuni priced by weight (the official price). No cost or margin here. */
  weightPrice: { gramsPerUnit: number; pricePerGramIdr: number; exactUnitIdr: number; unitPriceIdr: number; quantity: number; totalIdr: number } | null;
  /** The chain this order's money is on (the escrow's, else the configured one). */
  network: PublicNetwork;
  actual: Pick<ActualReport, "filamentGrams" | "machineHours" | "maxDeviationMm" | "unitsPassed" | "note" | "at"> | null;
  /** The measured size deviation is above the agreed tolerance: a warning before "Terima", never a block. */
  overTolerance: boolean;
  review: Review | null;
}

export function customerView(order: Order, token: string): CustomerView {
  const quote = order.chosenQuoteId ? store.getQuote(order.chosenQuoteId) : undefined;
  const escrow = store.getEscrow(order.id);
  const rate = idrPerUsdc();
  const printers = store.listPrinters();
  const p = printers.find((x) => x.currentOrderId === order.id);
  const acc = store.getAcceptance(order.id);
  return {
    order: {
      id: order.id, product: order.product, quantity: order.quantity, deadline: order.deadline, status: order.status,
      label: order.label, customerName: order.customerName, customerNote: order.customerNote,
    },
    // Rupiah as agreed (by weight or calculator), not converted back from whole USDC cents.
    price: quote ? { usdc: microToUsdc(quote.priceMicro), idr: quoteIdr(order, quote), etaHours: quote.etaHours } : null,
    escrow: escrow ? {
      state: escrow.state, amountUsdc: microToUsdc(escrow.amountMicro), network: escrow.network, label: escrow.label,
      txs: escrow.txs.map((t) => ({
        kind: t.kind, amountUsdc: microToUsdc(t.amountMicro), state: t.state, txHash: t.txHash, at: t.at, verifiedOnArc: t.verified?.ok,
      })),
    } : null,
    paying: Boolean(escrow && escrow.state === "AWAITING_DEPOSIT" && escrow.txs.some(live)),
    printing: p?.snapshot ? {
      printer: p.name, state: p.snapshot.state, percent: p.snapshot.percent, remainingMin: p.snapshot.remainingMin,
      online: !(notReadyReason(p) ?? "").startsWith("offline"),
    } : null,
    printedOn: printers.find((x) => x.bedOccupiedBy === order.id)?.name ?? null,
    updates: store.listEvidence(order.id).map((e) => ({
      kind: e.kind, note: e.note, label: e.label, at: e.at,
      photo: e.attachmentId ? `/api/c/${token}/files/${e.attachmentId}` : undefined,
    })),
    messages: store.listMessages(order.id).map((m) => ({ text: m.text, by: m.by, at: m.at })),
    acceptance: acc ? { accepted: acc.accepted, by: acc.by, note: acc.note, at: acc.at } : null,
    idrPerUsdc: rate,
    spec: order.spec ?? null,
    agreement: order.agreement
      ? { hash: order.agreement.hash, version: order.agreement.version, by: order.agreement.by, at: order.agreement.at, current: agreementCurrent(order) }
      : null,
    costs: costsFor(order),
    weightPrice: weightPriceFor(order),
    network: publicNetwork(escrow?.network),
    actual: order.actual ? {
      filamentGrams: order.actual.filamentGrams, machineHours: order.actual.machineHours, maxDeviationMm: order.actual.maxDeviationMm,
      unitsPassed: order.actual.unitsPassed, note: order.actual.note, at: order.actual.at,
    } : null,
    overTolerance: overTolerance(order) !== null,
    review: order.review ?? null,
  };
}

function weightPriceFor(order: Order): CustomerView["weightPrice"] {
  const w = gramPricingForChosen(order);
  if (!w) return null;
  return {
    gramsPerUnit: w.gramsPerUnit, pricePerGramIdr: w.pricePerGramIdr, exactUnitIdr: Math.round(w.gramsPerUnit * w.pricePerGramIdr),
    unitPriceIdr: w.unitPriceIdr, quantity: w.quantity, totalIdr: w.totalIdr,
  };
}

function costsFor(order: Order): CustomerView["costs"] {
  const c = costingForChosen(order);
  if (!c) return null;
  return {
    lines: c.lines.filter((l) => l.idr > 0).map((l) => ({ label: l.label, idr: l.idr })),
    kesuniIdr: c.revenueIdr - c.businessCostIdr - c.feeIdr,
    totalIdr: c.revenueIdr,
  };
}

/**
 * Bring the order's payment up to date: refresh pending Circle transfers, and once the customer's
 * test USDC has arrived, send their payment into escrow (the customer already pressed "Bayar").
 */
export async function refreshPayment(orderId: string): Promise<void> {
  const escrow = store.getEscrow(orderId);
  if (!escrow) return;
  if (escrow.txs.some((t) => !["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(t.state))) await syncEscrow(orderId);
  const now = store.getEscrow(orderId)!;
  if (escrow.state === "AWAITING_DEPOSIT" && now.state === "FUNDED") {
    wakeChief(orderId, "The customer's payment just arrived in escrow. Start production.");
  }
  const toppedUp = now.txs.some((t) => t.kind === "customer_topup" && t.state === "COMPLETE");
  const depositing = now.txs.some((t) => t.kind === "deposit" && live(t));
  if (now.state === "AWAITING_DEPOSIT" && toppedUp && !depositing) await deposit(orderId);
}

/** The customer presses "Bayar": open the escrow if needed, then pay (on testnet, test USDC first). */
export async function customerPay(orderId: string): Promise<{ ok: true } | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Pesanan tidak ditemukan");
  if (!PAYABLE.includes(order.status)) return fail(409, "Pesanan ini belum bisa dibayar");
  let escrow = store.getEscrow(orderId);
  const paid = escrow && escrow.state !== "AWAITING_DEPOSIT";
  if (!paid && !agreementCurrent(order)) return fail(409, "Setujui kesepakatan (harga dan spesifikasi) dulu sebelum membayar");
  if (!escrow) {
    const r = await openEscrow(orderId);
    if (!r.ok) return r;
    escrow = r.escrow;
  }
  if (escrow.state !== "AWAITING_DEPOSIT") return { ok: true };
  if (escrow.txs.some((t) => t.kind === "deposit" && live(t))) return { ok: true };
  const balance = await circle().usdcBalanceMicro(escrow.customerWalletId);
  if (balance >= escrow.amountMicro) {
    const r = await deposit(orderId);
    return r.ok ? { ok: true } : r;
  }
  if (escrow.txs.some((t) => t.kind === "customer_topup" && live(t))) return { ok: true }; // deposit follows on refresh
  // Mainnet: no test USDC. Funding a customer wallet with real USDC is not built yet (docs/PILOT.md).
  if (!isTestnetChain(escrow.network)) {
    return fail(409, "Dompet pembayaranmu belum berisi cukup USDC. Hubungi Kesuni untuk cara mengisinya.");
  }
  const r = await topUpCustomer(orderId);
  return r.ok ? { ok: true } : r;
}

const mm = (n: number) => String(n).replace(".", ",");

/**
 * Quality gate: the operator's measured max deviation is above the tolerance in the agreed spec. Returns the two
 * numbers, or null when within tolerance or not measured yet. Only a warning for the customer; never blocks money.
 */
export function overTolerance(order: Order): { maxDeviationMm: number; toleranceMm: number } | null {
  if (!order.actual || !order.spec) return null;
  const { maxDeviationMm } = order.actual;
  const { toleranceMm } = order.spec;
  return Number.isFinite(maxDeviationMm) && Number.isFinite(toleranceMm) && maxDeviationMm > toleranceMm ? { maxDeviationMm, toleranceMm } : null;
}

/**
 * The customer accepts or rejects the goods. Then the agent releases or refunds the escrow.
 * Accepting needs `checked: true` (the customer ticked that they checked size, colour, finishing and function).
 * Accepting above the agreed tolerance is allowed: it is written in the log and the acceptance note, and the
 * release still goes through the policy as usual.
 */
export async function customerDecide(
  orderId: string, input: { accepted: boolean; by: string; note: string; checked?: boolean },
): Promise<{ ok: true; settled: boolean; reasons?: string[] } | Fail> {
  const escrow = store.getEscrow(orderId);
  if (!escrow || escrow.state !== "FUNDED") return fail(409, "Pembayaran belum masuk escrow, jadi belum bisa diputuskan");
  if (input.accepted && input.checked !== true) {
    return fail(400, "Centang dulu bahwa kamu sudah memeriksa ukuran, warna, finishing, dan fungsi barang yang kamu terima");
  }
  const order = store.getOrder(orderId);
  const over = input.accepted && order ? overTolerance(order) : null;
  const note = over
    ? `${input.note.trim() ? `${input.note.trim()} ` : ""}[Diterima walau selisih ukuran ${mm(over.maxDeviationMm)} mm melebihi batas ±${mm(over.toleranceMm)} mm]`
    : input.note;
  const r = recordAcceptance(orderId, { accepted: input.accepted, by: input.by, note });
  if (!r.ok) return r;
  const at = new Date().toISOString();
  store.addLog({
    orderId, actor: "human", tool: "customer_decision",
    input: { accepted: input.accepted, ...(input.accepted ? { checked: true } : {}), ...(over ? { acceptedOverTolerance: over } : {}) },
    ok: true, output: { by: input.by.trim() }, at,
  });

  // The agent settles on its own; the policy engine decides whether the money may move.
  const tool = input.accepted ? "release_escrow" : "refund_escrow";
  const s = input.accepted ? await release(orderId) : await refund(orderId);
  store.addLog({ orderId, actor: "agent", tool, input: {}, ok: s.ok, output: s.ok ? { state: "submitted" } : { error: s.error, reasons: s.reasons }, at: new Date().toISOString() });
  if (!s.ok) {
    store.saveTask({
      id: store.nextTaskId(), orderId, kind: "check_printer", status: "open", createdBy: "agent", at: new Date().toISOString(),
      text: `Pembayaran ${orderId} ditahan policy: ${(s.reasons ?? [s.error]).join("; ")}. Periksa sebelum mencoba lagi.`,
    });
    return { ok: true, settled: false, reasons: s.reasons ?? [s.error] };
  }
  return { ok: true, settled: true };
}

/** A customer places an order through the invite link. Prices are set later by Kesuni. */
export function customerCreateOrder(input: {
  name: string; product: string; quantity: number; deadline: string; budgetIdr: number; note: string;
}): { ok: true; order: Order } | Fail {
  const r: string[] = [];
  if (!input.name.trim()) r.push("Nama wajib diisi");
  if (input.product.trim().length > 200) r.push("Nama produk terlalu panjang (paling banyak 200 huruf)");
  if (!Number.isFinite(input.budgetIdr) || input.budgetIdr < 1000) r.push("Budget minimal Rp1.000");
  if (r.length) return fail(400, "Pesanan belum lengkap", r);
  const mandateMicro = Math.round((input.budgetIdr / idrPerUsdc()) * 1e6);
  return createOrder({
    product: input.product, quantity: input.quantity, deadline: input.deadline, designVersion: "v1",
    mandateMicro, label: "real", customerName: input.name, customerNote: input.note,
  });
}

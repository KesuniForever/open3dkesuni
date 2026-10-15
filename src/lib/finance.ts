// Studio finance for the /finance page. Read-only: shapes store data, never moves money or calls Circle.
// Money model: customers pay Kesuni in rupiah, outside the app (Indonesian law: rupiah only). Each order's agreed
// price is also locked as test USDC in a Circle escrow wallet on Arc Testnet, released to Kesuni's wallet after the
// customer accepts, or refunded after a rejection.
// Counting rule (same as dashboard.ts and traction.ts): only orders labelled "real" count; simulated orders are
// shown apart and never added in. Real money is split per network by each escrow's own label, so testnet escrows
// stay test USDC after a mainnet switch. Demo top-ups (customer_topup) are internal moves: listed, never booked.
// Amounts are integer micro-USDC (1 USDC = 1_000_000); rupiah are whole rupiah.
import * as store from "./store";
import { microToUsdc } from "./policy";
import { calculate, microToIdr } from "./costing";
import { quoteIdr } from "./owner-rules";
import { agreementCurrent } from "./agreement";
import { explorerTxBase, isTestnetChain, network } from "./network";
import type { ChainTx, ChainTxState, Escrow, EscrowState, Label, Order, OrderStatus, PaymentState, Quote } from "./types";
import { dateLocale, type Locale } from "../i18n/core";

/** Real orders by their escrow's network; simulated (test) orders apart. Never add these together. */
export type Bucket = "testnet" | "mainnet" | "simulated";
/** Where totals add up: the buckets, with simulated money on a mainnet escrow kept apart from simulated test USDC
 *  ("simulated" = simulated orders on a testnet), so test USDC and USDC are never summed under one label. */
export type Pot = Bucket | "simulatedMainnet";
export type Split = Record<Pot, number>;
export const POTS: Pot[] = ["testnet", "mainnet", "simulated", "simulatedMainnet"];

const FINAL: ChainTxState[] = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];
const BOOKED_KINDS = ["deposit", "release", "refund"] as const;
type BookedKind = (typeof BOOKED_KINDS)[number];

const zero = (): Split => ({ testnet: 0, mainnet: 0, simulated: 0, simulatedMainnet: 0 });
const onMainnet = (e: Escrow | undefined): boolean => e?.label === "mainnet" || (e !== undefined && !isTestnetChain(e.network));

/** Which pot an order's money belongs to. An escrow without its order is never counted as real. */
export function bucketOf(order: Order | undefined, escrow?: Escrow): Bucket {
  if (!order || order.label !== "real") return "simulated";
  return onMainnet(escrow) ? "mainnet" : "testnet";
}

/** The pot an order's escrow money is added to: its bucket, with simulated mainnet money apart. */
export function potOf(order: Order | undefined, escrow?: Escrow): Pot {
  const bucket = bucketOf(order, escrow);
  return bucket === "simulated" && onMainnet(escrow) ? "simulatedMainnet" : bucket;
}

/** The one rule for agreed money: the customer approved this price and spec, the approval still matches the order,
 *  and the customer did not reject the print. Use it wherever agreed money is counted. */
export function countsAsAgreed(order: Order): boolean {
  return order.status !== "REJECTED" && agreementCurrent(order);
}

// ---------- the price each order was agreed at ----------

export interface AgreedPrice {
  /** "agreement": the customer approved this price and spec (still current). "quote": a quote is chosen, the
   *  customer has not approved it (yet), or the order predates agreements. */
  basis: "agreement" | "quote";
  quoteId: string;
  micro: number;
  idr: number;
  /** true: rupiah set directly (price by weight or the cost calculator). false: converted from USDC at the display rate. */
  idrExact: boolean;
}

export function agreedPrice(order: Order, quote: Quote | undefined, agreed: boolean): AgreedPrice | undefined {
  if (!quote) return undefined;
  const exact = order.gramPricing?.quoteId === quote.id || order.costing?.quoteId === quote.id;
  return {
    basis: agreed ? "agreement" : "quote", quoteId: quote.id, micro: quote.priceMicro,
    idr: exact ? quoteIdr(order, quote) : microToIdr(quote.priceMicro), idrExact: exact,
  };
}

/** Price minus cost (and the calculator's payment fee), in rupiah: from what production actually used when reported,
 *  else from the price rule. Same sums as quality.ts marginRows. */
export function marginOf(order: Order, price: AgreedPrice | undefined): { idr: number; source: "actual" | "price rule" | "cost calculator" } | undefined {
  if (!price) return undefined;
  const gram = order.gramPricing?.quoteId === price.quoteId ? order.gramPricing : undefined;
  const calc = !gram && order.costing?.quoteId === price.quoteId ? calculate(order.costing.input) : undefined;
  if (order.actual) return { idr: price.idr - (calc?.feeIdr ?? 0) - order.actual.costIdr, source: "actual" };
  if (gram) return { idr: gram.totalIdr - gram.costIdr, source: "price rule" };
  if (calc) return { idr: calc.profitIdr, source: "cost calculator" };
  return undefined;
}

// ---------- escrow transfers ----------

/** Sum of an escrow's COMPLETE transfers of one kind. Pending and failed transfers are not money yet. */
export function completed(txs: ChainTx[], kind: ChainTx["kind"]): number {
  return txs.filter((t) => t.kind === kind && t.state === "COMPLETE").reduce((a, t) => a + t.amountMicro, 0);
}

export interface EscrowFlow { depositedMicro: number; releasedMicro: number; refundedMicro: number; heldMicro: number; pending: number }

export function escrowFlow(e: Escrow | undefined): EscrowFlow {
  if (!e) return { depositedMicro: 0, releasedMicro: 0, refundedMicro: 0, heldMicro: 0, pending: 0 };
  const depositedMicro = completed(e.txs, "deposit");
  const releasedMicro = completed(e.txs, "release");
  const refundedMicro = completed(e.txs, "refund");
  return {
    depositedMicro, releasedMicro, refundedMicro,
    heldMicro: Math.max(0, depositedMicro - releasedMicro - refundedMicro),
    pending: e.txs.filter((t) => !FINAL.includes(t.state)).length,
  };
}

// ---------- position of each order ----------

export interface OrderPosition extends EscrowFlow {
  orderId: string;
  product: string;
  customerName?: string;
  status: OrderStatus;
  label: Label;
  bucket: Bucket;
  pot: Pot;
  createdAt?: string;
  price?: AgreedPrice;
  /** The price is (or will be) locked as test USDC: the escrow's network, or the current one before it opens. */
  testMoney: boolean;
  escrow?: { state: EscrowState; network: string; testMoney: boolean; amountMicro: number };
  /** Escrow open, customer has not deposited yet: the test USDC still to come in. 0 once deposited. */
  awaitingMicro: number;
  margin?: ReturnType<typeof marginOf>;
  /** The latest payout record (payment intent) the policy engine created for the release. */
  payout?: { state: PaymentState; amountMicro: number };
}

// ---------- every Arc transfer ----------

export interface TransferRow {
  key: string;            // idempotency key
  orderId: string;
  product?: string;
  bucket: Bucket;
  kind: ChainTx["kind"];
  /** customer_topup: test USDC from Kesuni's demo-funds wallet to the customer's wallet. Not a customer payment. */
  internal: boolean;
  amountMicro: number;
  state: ChainTxState;
  network: string;
  testMoney: boolean;
  txHash?: string;
  explorerUrl?: string;
  /** true = checked on Arc and it matches; false = Arc does not match; null = not checked yet. */
  verified: boolean | null;
  verifyReason?: string;
  at: string;
}

// ---------- journal (double entry, from completed escrow transfers) ----------

export type Account = "escrow_held" | "customer_funds" | "kesuni_wallet" | "revenue";
export const ACCOUNTS: Record<Account, { name: string; side: "debit" | "credit"; note: string }> = {
  escrow_held: { name: "Escrow held", side: "debit", note: "Asset: test USDC locked in the order's escrow wallet." },
  customer_funds: { name: "Customer funds held", side: "credit", note: "Owed back to the customer until they accept the print." },
  kesuni_wallet: { name: "Kesuni wallet", side: "debit", note: "Asset: test USDC released to Kesuni's wallet." },
  revenue: { name: "Service revenue", side: "credit", note: "Earned when the customer accepts and the escrow is released." },
};

export interface JournalLine { account: Account; debitMicro: number; creditMicro: number }

export interface JournalEntry {
  id: string;             // the transfer's idempotency key
  at: string;
  orderId: string;
  product?: string;
  kind: BookedKind;
  bucket: Bucket;
  pot: Pot;
  network: string;
  testMoney: boolean;
  txHash?: string;
  explorerUrl?: string;
  verified: boolean | null;
  lines: JournalLine[];
}

const dr = (account: Account, micro: number): JournalLine => ({ account, debitMicro: micro, creditMicro: 0 });
const cr = (account: Account, micro: number): JournalLine => ({ account, debitMicro: 0, creditMicro: micro });

/** The double-entry lines for one completed escrow transfer. Each set balances (debit = credit). */
export function journalLines(kind: BookedKind, micro: number): JournalLine[] {
  if (kind === "deposit") return [dr("escrow_held", micro), cr("customer_funds", micro)];
  if (kind === "release") return [dr("kesuni_wallet", micro), cr("escrow_held", micro), dr("customer_funds", micro), cr("revenue", micro)];
  return [dr("customer_funds", micro), cr("escrow_held", micro)];
}

export interface Ledger {
  entries: JournalEntry[];                       // newest first
  balances: Record<Pot, Record<Account, number>>;
  debitMicro: number;
  creditMicro: number;
  balanced: boolean;
}

// ---------- the whole page ----------

/** A rupiah sum of prices; approx = at least one was converted from USDC at the display rate. */
export interface PriceSum { count: number; idr: number; approx: boolean }

export interface Finance {
  positions: OrderPosition[];                    // newest order first
  transfers: TransferRow[];                      // newest first
  ledger: Ledger;
  totals: {
    /** countsAsAgreed: current customer agreement, print not rejected. */
    agreed: { real: PriceSum; simulated: PriceSum };
    /** A quote is chosen, the customer has not approved it (or the order predates agreements). Rejected orders left out. */
    quoted: { real: PriceSum; simulated: PriceSum };
    held: Split; heldOrders: Split;
    released: Split; releasedOrders: Split;
    refunded: Split; refundedOrders: Split;
  };
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const newestFirst = <T extends { at: string }>(a: T, b: T) => time(b.at) - time(a.at);

export function finance(): Finance {
  const orders = store.listOrders();
  const byId = new Map(orders.map((o) => [o.id, o]));
  const escrows = store.listEscrows();
  const escrowOf = new Map(escrows.map((e) => [e.orderId, e]));

  const sum = (): PriceSum => ({ count: 0, idr: 0, approx: false });
  const agreed = { real: sum(), simulated: sum() };
  const quoted = { real: sum(), simulated: sum() };
  const testnetNow = network().isTestnet;
  const positions: OrderPosition[] = orders.map((o) => {
    const e = escrowOf.get(o.id);
    const quote = o.chosenQuoteId ? store.getQuote(o.chosenQuoteId) : undefined;
    const price = agreedPrice(o, quote, agreementCurrent(o));
    const flow = escrowFlow(e);
    const bucket = bucketOf(o, e);
    if (price && o.status !== "REJECTED") {
      const group = countsAsAgreed(o) ? agreed : quoted;
      const a = o.label === "real" ? group.real : group.simulated;
      a.count++;
      a.idr += price.idr;
      a.approx ||= !price.idrExact;
    }
    const intent = store.listIntents(o.id).at(-1);
    return {
      orderId: o.id, product: o.product, customerName: o.customerName, status: o.status, label: o.label, bucket,
      pot: potOf(o, e), createdAt: o.createdAt, price, testMoney: e ? isTestnetChain(e.network) : testnetNow,
      escrow: e && { state: e.state, network: e.network, testMoney: isTestnetChain(e.network), amountMicro: e.amountMicro },
      ...flow,
      awaitingMicro: e?.state === "AWAITING_DEPOSIT" && flow.depositedMicro === 0 ? e.amountMicro : 0,
      margin: marginOf(o, price),
      payout: intent && { state: intent.state, amountMicro: intent.amountMicro },
    };
  });
  // Newest first; orders made before createdAt existed come after the dated ones, newest added first.
  const added = new Map(orders.map((o, i) => [o.id, i]));
  positions.sort((a, b) => time(b.createdAt) - time(a.createdAt) || added.get(b.orderId)! - added.get(a.orderId)!);

  const held = zero(), released = zero(), refunded = zero();
  const heldOrders = zero(), releasedOrders = zero(), refundedOrders = zero();
  for (const p of positions) {
    if (p.heldMicro > 0) { held[p.pot] += p.heldMicro; heldOrders[p.pot]++; }
    if (p.releasedMicro > 0) { released[p.pot] += p.releasedMicro; releasedOrders[p.pot]++; }
    if (p.refundedMicro > 0) { refunded[p.pot] += p.refundedMicro; refundedOrders[p.pot]++; }
  }
  // Escrows whose order is gone still show up in the transfer list and journal (as not counted), never in the totals.

  const transfers: TransferRow[] = [];
  const entries: JournalEntry[] = [];
  for (const e of escrows) {
    const o = byId.get(e.orderId);
    const bucket = bucketOf(o, e);
    const pot = potOf(o, e);
    const testMoney = isTestnetChain(e.network);
    for (const t of e.txs) {
      const explorerUrl = t.txHash ? `${explorerTxBase(e.network)}${t.txHash}` : undefined;
      const verified = t.verified ? t.verified.ok : null;
      transfers.push({
        key: t.idempotencyKey, orderId: e.orderId, product: o?.product, bucket, kind: t.kind, internal: t.kind === "customer_topup",
        amountMicro: t.amountMicro, state: t.state, network: e.network, testMoney, txHash: t.txHash, explorerUrl,
        verified, verifyReason: t.verified?.ok === false ? t.verified.reason : undefined, at: t.at,
      });
      if (t.state !== "COMPLETE" || !(BOOKED_KINDS as readonly string[]).includes(t.kind)) continue;
      entries.push({
        id: t.idempotencyKey, at: t.at, orderId: e.orderId, product: o?.product, kind: t.kind as BookedKind, bucket, pot,
        network: e.network, testMoney, txHash: t.txHash, explorerUrl, verified, lines: journalLines(t.kind as BookedKind, t.amountMicro),
      });
    }
  }
  transfers.sort(newestFirst);
  entries.sort(newestFirst);

  const balances = Object.fromEntries(POTS.map((b) => [
    b, Object.fromEntries((Object.keys(ACCOUNTS) as Account[]).map((a) => [a, 0])),
  ])) as Ledger["balances"];
  let debitMicro = 0, creditMicro = 0;
  for (const en of entries) {
    for (const l of en.lines) {
      debitMicro += l.debitMicro;
      creditMicro += l.creditMicro;
      balances[en.pot][l.account] += ACCOUNTS[l.account].side === "debit" ? l.debitMicro - l.creditMicro : l.creditMicro - l.debitMicro;
    }
  }

  return {
    positions, transfers,
    ledger: { entries, balances, debitMicro, creditMicro, balanced: debitMicro === creditMicro },
    totals: { agreed, quoted, held, heldOrders, released, releasedOrders, refunded, refundedOrders },
  };
}

// ---------- display helpers (server and client safe) ----------

/** Rupiah with dot thousands, as everywhere else in the app: Rp1.650. */
export const rp = (n: number): string => `${n < 0 ? "−" : ""}Rp${Math.abs(Math.round(n)).toLocaleString("id-ID")}`;

/** "13 Oct, 17:11 WIB" (Asia/Jakarta); in Indonesian "13 Okt, 17.11 WIB". */
export const wib = (iso: string, locale: Locale = "en"): string =>
  `${new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} WIB`;

/** micro-USDC as a USDC string ("0.1"); re-exported so pages format money one way. */
export const usdc = (micro: number): string => microToUsdc(micro);

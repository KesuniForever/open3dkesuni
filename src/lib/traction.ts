// "Real usage" numbers for the home page card and GET /api/traction (the submission). Read-only.
// Counting rule: only orders labelled "real" count. Their escrow transfers count when they are a deposit, release or
// refund that Circle reports COMPLETE with an Arc tx hash. Simulated orders, demo top-ups (customer_topup: test USDC
// from Kesuni's demo-funds wallet into the customer's wallet) and other internal transfers are not counted.
// No customer names, phones or addresses leave this module: customers are only counted.
import * as store from "./store";
import { microToUsdc } from "./policy";
import { explorerTxBase, isTestnetChain } from "./network";
import type { ChainTx, Order, OrderStatus } from "./types";

export const COUNTING_RULE = "Simulated orders, demo top-ups and internal transfers are not counted.";
const COUNTED_KINDS: ChainTx["kind"][] = ["deposit", "release", "refund"];
const STATUSES: OrderStatus[] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "REJECTED", "PAID"];

export interface TractionTx {
  orderId: string;
  kind: "deposit" | "release" | "refund";
  amountMicro: number;
  amountUsdc: string;
  network: string;               // Circle chain enum, e.g. "ARC-TESTNET"
  networkLabel: "testnet" | "mainnet";
  txHash: string;
  explorerUrl: string;
  /** true = checked on Arc and it matches; false = Arc does not match; null = not checked yet. */
  verifiedOnArc: boolean | null;
  at: string;
}

export interface Volume { micro: number; usdc: string }

export interface Traction {
  computedAt: string;
  rule: string;
  /** Distinct customers of real orders (same name = one customer; an order without a name counts on its own). */
  realCustomers: number;
  realOrders: number;
  realOrdersByStatus: Record<OrderStatus, number>;
  arcTxs: {
    count: number;
    byKind: Record<TractionTx["kind"], number>;
    verifiedOnArc: number;
    mismatchOnArc: number;
    notCheckedYet: number;
    /** Sum of the counted transfers per network (a deposit and its release are two transfers). */
    volume: { testnet: Volume; mainnet: Volume };
    last: TractionTx[];
  };
  excluded: { simulatedOrders: number; demoTopups: number };
}

const volume = (micro: number): Volume => ({ micro, usdc: microToUsdc(micro) });

/** Identity for counting distinct customers; never returned. */
function customerKey(o: Order): string {
  const name = o.customerName?.trim().toLowerCase().replace(/\s+/g, " ");
  return name ? `name:${name}` : `order:${o.customerToken ?? o.id}`;
}

export function traction(opts: { now?: Date; last?: number } = {}): Traction {
  const orders = store.listOrders();
  const real = orders.filter((o) => o.label === "real");
  const realIds = new Set(real.map((o) => o.id));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const o of real) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const txs: TractionTx[] = [];
  let demoTopups = 0;
  for (const e of store.listEscrows()) {
    if (!realIds.has(e.orderId)) continue;
    const testnet = isTestnetChain(e.network);
    for (const t of e.txs) {
      if (t.kind === "customer_topup") {
        if (t.state === "COMPLETE") demoTopups++;
        continue;
      }
      if (!COUNTED_KINDS.includes(t.kind) || t.state !== "COMPLETE" || !t.txHash) continue;
      txs.push({
        orderId: e.orderId, kind: t.kind as TractionTx["kind"], amountMicro: t.amountMicro, amountUsdc: microToUsdc(t.amountMicro),
        network: e.network, networkLabel: testnet ? "testnet" : "mainnet", txHash: t.txHash,
        explorerUrl: `${explorerTxBase(e.network)}${t.txHash}`,
        verifiedOnArc: t.verified ? t.verified.ok : null, at: t.at,
      });
    }
  }
  txs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const sum = (label: "testnet" | "mainnet") => txs.filter((t) => t.networkLabel === label).reduce((a, t) => a + t.amountMicro, 0);

  return {
    computedAt: (opts.now ?? new Date()).toISOString(),
    rule: COUNTING_RULE,
    realCustomers: new Set(real.map(customerKey)).size,
    realOrders: real.length,
    realOrdersByStatus: byStatus,
    arcTxs: {
      count: txs.length,
      byKind: {
        deposit: txs.filter((t) => t.kind === "deposit").length,
        release: txs.filter((t) => t.kind === "release").length,
        refund: txs.filter((t) => t.kind === "refund").length,
      },
      verifiedOnArc: txs.filter((t) => t.verifiedOnArc === true).length,
      mismatchOnArc: txs.filter((t) => t.verifiedOnArc === false).length,
      notCheckedYet: txs.filter((t) => t.verifiedOnArc === null).length,
      volume: { testnet: volume(sum("testnet")), mainnet: volume(sum("mainnet")) },
      last: txs.slice(0, opts.last ?? 10),
    },
    excluded: { simulatedOrders: orders.length - real.length, demoTopups },
  };
}

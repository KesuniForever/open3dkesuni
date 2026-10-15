// Data for the Circle & Arc page (/arc). Pure functions over store data: no network, no writes, no secrets.
// Escrow transfers with their Arc check counts, and every wallet the app knows from its escrows.
// Test top-ups (customer_topup) are internal moves from Kesuni's demo-funds wallet: listed, never counted as payments.
import { isPlaceholderAddress } from "./policy";
import type { ChainTx, Escrow, EscrowState, Label, Order } from "./types";

export interface TransferRow { escrow: Escrow; order?: Order; tx: ChainTx }

/** "removed": the order was deleted but its escrow stays. Like simulated, it is never real business. */
export type OrderTag = "real" | "simulated" | "removed";
export const orderTag = (order: Order | undefined): OrderTag =>
  !order ? "removed" : order.label === "real" ? "real" : "simulated";

/** Every transfer of every escrow, in escrow order then transfer order. */
export function transferRows(escrows: Escrow[], orderOf: (id: string) => Order | undefined): TransferRow[] {
  return escrows.flatMap((escrow) => {
    const order = orderOf(escrow.orderId);
    return escrow.txs.map((tx) => ({ escrow, order, tx }));
  });
}

export interface TransferCounts {
  /** Deposits, releases and refunds (test top-ups left out). */
  transfers: number;
  verified: number;
  mismatch: number;
  /** COMPLETE with a hash, but not checked on Arc yet. */
  unchecked: number;
  /** Test top-ups from the demo-funds wallet. */
  internal: number;
  /** Of `transfers`: on real orders, and on simulated (test) or removed orders, which are never business numbers. */
  onReal: number;
  onSimulated: number;
}

export function transferCounts(rows: TransferRow[]): TransferCounts {
  const money = rows.filter((r) => r.tx.kind !== "customer_topup");
  return {
    transfers: money.length,
    verified: money.filter((r) => r.tx.verified?.ok === true).length,
    mismatch: money.filter((r) => r.tx.verified?.ok === false).length,
    unchecked: money.filter((r) => !r.tx.verified && r.tx.state === "COMPLETE" && Boolean(r.tx.txHash)).length,
    internal: rows.length - money.length,
    onReal: money.filter((r) => orderTag(r.order) === "real").length,
    onSimulated: money.filter((r) => orderTag(r.order) !== "real").length,
  };
}

export type WalletRole = "kesuni_payout" | "demo_funds" | "escrow" | "customer" | "shop_payout";

/** Highest first: the role a wallet is shown under when it has several. */
const ROLE_ORDER: WalletRole[] = ["kesuni_payout", "demo_funds", "escrow", "customer", "shop_payout"];

export const ROLE_LABEL: Record<WalletRole, string> = {
  kesuni_payout: "Kesuni payout",
  demo_funds: "Demo funds",
  escrow: "Escrow",
  customer: "Customer",
  shop_payout: "Shop payout",
};

export interface KnownWallet {
  address: string;
  role: WalletRole;
  roles: WalletRole[];
  /** Orders whose escrow uses this wallet: real, simulated or removed (unset without `orderOf`). */
  orders: { id: string; tag?: OrderTag }[];
  /** Circle blockchain, e.g. "ARC-TESTNET". */
  network: string;
  /** "testnet" or "mainnet" (from the escrow, or the current network for the payout address). */
  label: Label;
  /** Stored transfers from or to this wallet. */
  transfers: number;
  lastAt?: string;
  /** Escrow wallets: the escrow's state. */
  escrowState?: EscrowState;
}

export const isRealAddress = (a: string | undefined): a is string =>
  Boolean(a && /^0x[0-9a-fA-F]{40}$/.test(a) && !isPlaceholderAddress(a));

/**
 * Every wallet the app knows: Kesuni's payout address, then the escrow and customer wallets of each escrow, plus the
 * addresses its transfers touch (demo funds for test top-ups, the shop for releases). One entry per address
 * (case-insensitive); placeholder addresses are left out.
 */
export function knownWallets(
  escrows: Escrow[],
  opts: { payoutAddress?: string; network: { blockchain: string; label: Label }; orderOf?: (id: string) => Order | undefined },
): KnownWallet[] {
  const byKey = new Map<string, KnownWallet & { seen: Set<string> }>();
  const touch = (address: string | undefined, role: WalletRole, net: { blockchain: string; label: Label }, orderId?: string) => {
    if (!isRealAddress(address)) return undefined;
    const key = address.toLowerCase();
    let w = byKey.get(key);
    if (!w) {
      w = { address, role, roles: [], orders: [], network: net.blockchain, label: net.label, transfers: 0, seen: new Set() };
      byKey.set(key, w);
    }
    if (!w.roles.includes(role)) w.roles.push(role);
    if (orderId && !w.orders.some((o) => o.id === orderId)) w.orders.push({ id: orderId, tag: opts.orderOf ? orderTag(opts.orderOf(orderId)) : undefined });
    return w;
  };

  touch(opts.payoutAddress, "kesuni_payout", opts.network);
  for (const e of escrows) {
    const net = { blockchain: e.network, label: e.label };
    const escrowWallet = touch(e.escrowAddress, "escrow", net, e.orderId);
    if (escrowWallet) escrowWallet.escrowState = e.state;
    touch(e.customerAddress, "customer", net, e.orderId);
    for (const tx of e.txs) {
      if (tx.kind === "customer_topup") touch(tx.from, "demo_funds", net);
      if (tx.kind === "release") touch(tx.to, "shop_payout", net);
      for (const a of [tx.from, tx.to]) {
        const w = isRealAddress(a) ? byKey.get(a.toLowerCase()) : undefined;
        if (!w || w.seen.has(tx.idempotencyKey)) continue;
        w.seen.add(tx.idempotencyKey);
        w.transfers++;
        if (!w.lastAt || tx.at > w.lastAt) w.lastAt = tx.at;
      }
    }
  }

  const byRole = (a: WalletRole, b: WalletRole) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b);
  const rank = (w: KnownWallet) => Math.min(ROLE_ORDER.indexOf(w.role), 2);
  return [...byKey.values()]
    .map((w): KnownWallet => {
      const roles = [...w.roles].sort(byRole);
      return {
        address: w.address, role: roles[0], roles, orders: w.orders, network: w.network, label: w.label,
        transfers: w.transfers, lastAt: w.lastAt, escrowState: w.escrowState,
      };
    })
    // Kesuni payout and demo funds first; escrow and customer wallets stay in escrow order (sort is stable).
    .sort((a, b) => rank(a) - rank(b));
}

/** 0xE4E4…E302 */
export const shortAddress = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Host of an RPC URL only (no path, query or user info, which may carry a key). null when it is not a URL. */
export function rpcHost(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** ".../tx/" explorer base -> ".../address/". null when the base has no /tx/ to swap. */
export function explorerAddressBase(txBase: string): string | null {
  return /\/tx\/?$/.test(txBase) ? txBase.replace(/\/tx\/?$/, "/address/") : null;
}

/** The explorer's home page (origin), e.g. https://explorer.testnet.arc.io. null when the base is not a URL. */
export function explorerHome(txBase: string): string | null {
  try {
    return new URL(txBase).origin;
  } catch {
    return null;
  }
}

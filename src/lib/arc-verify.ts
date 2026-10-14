// Independent check of escrow transfers on Arc, read-only over JSON-RPC (viem). Circle says a transfer is COMPLETE;
// this asks Arc itself: the receipt succeeded, its block is canonical, and it holds exactly one USDC Transfer log
// with the expected sender, recipient and amount (ERC-20 USDC on Arc has 6 decimals, so the log amount is micro-USDC).
// The result is stored on the ChainTx as `verified`. It never changes escrow state, never blocks a release or refund
// and never moves money; there is no signing key here.
//
// RPC: KESUNI_ARC_RPC_URL (may contain a key, so it is never logged or returned), default the public Arc Testnet RPC.
// Chain id: Arc Testnet 5042002. On a mainnet chain both KESUNI_ARC_RPC_URL and KESUNI_ARC_CHAIN_ID must be set.
// Tests inject a fake reader with setArcReader(); under vitest the default reader never touches the network.
import {
  BlockNotFoundError, TransactionReceiptNotFoundError, createPublicClient, defineChain, erc20Abi, http, isAddress, isHash,
} from "viem";
import * as store from "./store";
import { microToUsdc } from "./policy";
import { network } from "./network";
import { createTask } from "./printer/actions";
import type { ChainTx, Escrow, OperatorTask, TxVerification } from "./types";

export const ARC_TESTNET_CHAIN_ID = 5042002;
export const ARC_TESTNET_RPC = "https://rpc.testnet.arc.io";
/** keccak256("Transfer(address,address,uint256)") */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** A COMPLETE tx whose hash Arc still does not know this long after the first "not found" is reported as a mismatch
 *  (before: retried). Counted from the first not-found answer, not from when the tx was made. */
export const NOT_FOUND_GRACE_MS = 60 * 60_000;

type Hex = `0x${string}`;

export interface ArcLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number;
  transactionHash: string;
  blockHash: string;
  removed?: boolean;
}
export interface ArcReceipt {
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  status: "success" | "reverted";
  logs: ArcLog[];
}
export interface ArcBlock { number: bigint; hash: string; timestamp: bigint }

/** The four read-only RPC calls we need. viem in production, a fake in tests. */
export interface ArcReader {
  chainId(): Promise<number>;
  /** null when the RPC does not know the hash (yet). */
  receipt(hash: Hex): Promise<ArcReceipt | null>;
  /** The latest block when n is undefined; null when not found. */
  block(n?: bigint): Promise<ArcBlock | null>;
  decimals(token: Hex): Promise<number>;
}

export type ArcConfig = { ok: true; rpcUrl: string; chainId: number; custom: boolean } | { ok: false; reason: string };

export function arcConfig(): ArcConfig {
  const net = network();
  const rpcUrl = process.env.KESUNI_ARC_RPC_URL?.trim();
  const chainEnv = Number(process.env.KESUNI_ARC_CHAIN_ID);
  const chainId = Number.isInteger(chainEnv) && chainEnv > 0 ? chainEnv : undefined;
  if (!net.isTestnet && (!rpcUrl || !chainId)) {
    return { ok: false, reason: `Arc check is not configured for ${net.name}: set KESUNI_ARC_RPC_URL and KESUNI_ARC_CHAIN_ID` };
  }
  return { ok: true, rpcUrl: rpcUrl || ARC_TESTNET_RPC, chainId: chainId ?? ARC_TESTNET_CHAIN_ID, custom: Boolean(rpcUrl) };
}

/** Error text without the RPC URL (it may carry an API key) and without long viem details. */
export function safeRpcError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string };
  const text = (err?.shortMessage || err?.message || String(e)).split("\n")[0];
  return text.replace(/https?:\/\/\S+/gi, "<rpc>").replace(/(TEST|LIVE)_API_KEY:\S+/g, "<key>").slice(0, 200);
}

function viemReader(cfg: Extract<ArcConfig, { ok: true }>): ArcReader {
  const chain = defineChain({
    id: cfg.chainId,
    name: cfg.chainId === ARC_TESTNET_CHAIN_ID ? "Arc Testnet" : "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // native gas view; the ERC-20 interface uses 6
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
  const client = createPublicClient({ chain, transport: http(cfg.rpcUrl, { timeout: 8_000, retryCount: 1 }) });
  return {
    chainId: () => client.getChainId(),
    async receipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          transactionHash: r.transactionHash, blockHash: r.blockHash, blockNumber: r.blockNumber, status: r.status,
          logs: r.logs.map((l) => ({
            address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex ?? -1,
            transactionHash: l.transactionHash ?? "", blockHash: l.blockHash ?? "", removed: l.removed,
          })),
        };
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        throw e;
      }
    },
    async block(n) {
      try {
        const b = n === undefined ? await client.getBlock() : await client.getBlock({ blockNumber: n });
        if (b.number === null || b.hash === null) return null;
        return { number: b.number, hash: b.hash, timestamp: b.timestamp };
      } catch (e) {
        if (e instanceof BlockNotFoundError) return null;
        throw e;
      }
    },
    decimals: (token) => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  };
}

const offlineReader: ArcReader = {
  chainId: () => Promise.reject(new Error("Arc RPC is off in tests (inject a reader)")),
  receipt: () => Promise.reject(new Error("Arc RPC is off in tests (inject a reader)")),
  block: () => Promise.reject(new Error("Arc RPC is off in tests (inject a reader)")),
  decimals: () => Promise.reject(new Error("Arc RPC is off in tests (inject a reader)")),
};

const g = globalThis as unknown as {
  __kesuniArcReader?: ArcReader; __kesuniArcTried?: Map<string, number>;
  /** orderId:idempotencyKey -> ms of the first "not found" answer in the current run of not-found answers. */
  __kesuniArcNotFoundSince?: Map<string, number>;
};

/** The reader in use: an injected one, else viem over the configured RPC (never the network under vitest). */
export function arcReader(cfg: ArcConfig = arcConfig()): ArcReader | null {
  if (g.__kesuniArcReader) return g.__kesuniArcReader;
  if (process.env.VITEST) return offlineReader;
  return cfg.ok ? viemReader(cfg) : null;
}

/** Tests only: replace the RPC reader with a fake (undefined restores the default) and forget not-found first-seen times. */
export function setArcReader(r: ArcReader | undefined): void {
  g.__kesuniArcReader = r;
  g.__kesuniArcNotFoundSince?.clear();
}

// ---------- one transfer ----------

export interface TransferInput { txHash: string; from: string; to: string; amountMicro: number }

export type ArcCheck =
  | { status: "verified"; chainId: number; logId: string; logIndex: number; blockNumber: string }
  | { status: "mismatch"; reason: string }    // Arc answered and it does not match: report it
  | { status: "not_found"; reason: string }   // the RPC does not know the hash (yet): retry later
  | { status: "unavailable"; reason: string } // RPC down, wrong chain or not configured: retry later
  | { status: "invalid"; reason: string };    // the input itself is malformed

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const topicOf = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;

export function validateTransferInput(i: TransferInput): string | null {
  if (!isHash(i.txHash)) return "Transaction hash must be 0x followed by 64 hex characters";
  if (!isAddress(i.from, { strict: false })) return "Sender must be a 0x address (40 hex characters)";
  if (!isAddress(i.to, { strict: false })) return "Recipient must be a 0x address (40 hex characters)";
  if (!Number.isSafeInteger(i.amountMicro) || i.amountMicro <= 0) return "Amount must be more than 0 USDC (max 6 decimals)";
  return null;
}

/**
 * Check one USDC transfer on Arc: receipt status success, canonical block, exactly one USDC Transfer log
 * from -> to for amountMicro (6 decimals). Never throws; read-only.
 */
export async function verifyTransfer(
  input: TransferInput,
  opts: { reader?: ArcReader; usdc?: string; config?: ArcConfig } = {},
): Promise<ArcCheck> {
  const bad = validateTransferInput(input);
  if (bad) return { status: "invalid", reason: bad };
  const cfg = opts.config ?? arcConfig();
  if (!cfg.ok) return { status: "unavailable", reason: cfg.reason };
  const reader = opts.reader ?? arcReader(cfg);
  if (!reader) return { status: "unavailable", reason: "Arc RPC is not configured" };
  const usdc = (opts.usdc ?? network().usdcAddress).toLowerCase();
  const hash = input.txHash.toLowerCase() as Hex;

  let receipt: ArcReceipt | null;
  let block: ArcBlock | null;
  try {
    const chainId = await reader.chainId();
    if (chainId !== cfg.chainId) {
      return { status: "unavailable", reason: `The Arc RPC is on chain ${chainId}, expected ${cfg.chainId}; nothing was checked` };
    }
    receipt = await reader.receipt(hash);
    if (!receipt) return { status: "not_found", reason: "Arc has no receipt for this transaction hash (yet)" };
    block = await reader.block(receipt.blockNumber);
  } catch (e) {
    return { status: "unavailable", reason: `Arc RPC unreachable: ${safeRpcError(e)}` };
  }

  if (receipt.transactionHash.toLowerCase() !== hash) return { status: "mismatch", reason: "The receipt belongs to a different transaction" };
  if (receipt.status !== "success") return { status: "mismatch", reason: "The transaction failed (reverted) on Arc" };
  if (!block) return { status: "not_found", reason: `Block ${receipt.blockNumber} of the receipt is not available yet` };
  if (block.number !== receipt.blockNumber || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) {
    return { status: "mismatch", reason: `The receipt's block ${receipt.blockNumber} is not on the canonical chain (reorg?)` };
  }

  const transfers = receipt.logs.filter((l) =>
    !l.removed && l.address.toLowerCase() === usdc && l.topics.length === 3 && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC
    && l.transactionHash.toLowerCase() === hash && l.blockHash.toLowerCase() === receipt.blockHash.toLowerCase());
  const amountOf = (data: string) => (/^0x[0-9a-fA-F]{1,64}$/.test(data) ? BigInt(data) : BigInt(-1));
  const matches = transfers.filter((l) =>
    l.topics[1]?.toLowerCase() === topicOf(input.from) && l.topics[2]?.toLowerCase() === topicOf(input.to)
    && amountOf(l.data) === BigInt(input.amountMicro));
  const want = `${microToUsdc(input.amountMicro)} USDC from ${short(input.from)} to ${short(input.to)}`;
  if (matches.length === 0) {
    return { status: "mismatch", reason: `No USDC Transfer of ${want} in this transaction (it has ${transfers.length} USDC transfer${transfers.length === 1 ? "" : "s"})` };
  }
  if (matches.length > 1) return { status: "mismatch", reason: `${matches.length} identical USDC Transfers of ${want}; expected exactly one` };
  const logIndex = matches[0].logIndex;
  return {
    status: "verified", chainId: cfg.chainId, logIndex, logId: `${cfg.chainId}:${hash}:${logIndex}`,
    blockNumber: receipt.blockNumber.toString(),
  };
}

// ---------- escrow txs ----------

export interface TxRef { orderId: string; escrow: Escrow; tx: ChainTx }

const MONEY_KINDS: ChainTx["kind"][] = ["deposit", "release", "refund"];
const keyOf = (r: { orderId: string; tx: ChainTx }) => `${r.orderId}:${r.tx.idempotencyKey}`;

/** COMPLETE txs with a real hash on the configured chain that have not been checked yet. Money txs first. */
export function unverifiedTxs(): TxRef[] {
  const chain = network().blockchain;
  const out: TxRef[] = [];
  for (const escrow of store.listEscrows()) {
    if (escrow.network !== chain) continue; // an old escrow on another chain cannot be checked with this RPC
    for (const tx of escrow.txs) {
      if (tx.state === "COMPLETE" && tx.txHash && isHash(tx.txHash) && !tx.verified) out.push({ orderId: escrow.orderId, escrow, tx });
    }
  }
  const rank = (r: TxRef) => (MONEY_KINDS.includes(r.tx.kind) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

export type StoredCheck = { check: ArcCheck; saved?: TxVerification };

/**
 * Check one stored tx and save the outcome on it when Arc gave a definite answer. Retryable outcomes (RPC down,
 * hash not known yet) are not saved, except a hash still unknown NOT_FOUND_GRACE_MS after Arc first said "not found".
 * A not-found answer never replaces an earlier verified result (a lagging RPC node is not evidence of a mismatch).
 * Only `verified` on the tx is written: escrow state, other txs and money are never touched.
 */
export async function verifyStoredTx(
  orderId: string, idempotencyKey: string, opts: { reader?: ArcReader; now?: Date } = {},
): Promise<StoredCheck | { error: string }> {
  const escrow = store.getEscrow(orderId);
  const tx = escrow?.txs.find((t) => t.idempotencyKey === idempotencyKey);
  if (!escrow || !tx) return { error: "Transaction not found" };
  if (tx.state !== "COMPLETE" || !tx.txHash) return { error: "Only COMPLETE transactions with a hash can be checked on Arc" };
  if (escrow.network !== network().blockchain) return { error: `This escrow is on ${escrow.network}, the app is configured for ${network().blockchain}` };

  const key = `${orderId}:${idempotencyKey}`;
  (g.__kesuniArcTried ??= new Map()).set(key, Date.now());
  const check = await verifyTransfer({ txHash: tx.txHash, from: tx.from, to: tx.to, amountMicro: tx.amountMicro }, { reader: opts.reader });
  const now = opts.now ?? new Date();
  const internal = tx.kind === "customer_topup" ? { internal: true } : {};
  const notFoundSince = (g.__kesuniArcNotFoundSince ??= new Map());
  if (check.status !== "not_found" && check.status !== "unavailable") notFoundSince.delete(key);
  let saved: TxVerification | undefined;
  if (check.status === "verified") saved = { ok: true, at: now.toISOString(), logId: check.logId, ...internal };
  else if (check.status === "mismatch" || check.status === "invalid") saved = { ok: false, at: now.toISOString(), reason: check.reason, ...internal };
  else if (check.status === "not_found") {
    // The grace runs from the first not-found answer this process saw, so one answer from a lagging node is never final.
    const since = notFoundSince.get(key) ?? now.getTime();
    notFoundSince.set(key, since);
    if (now.getTime() - since > NOT_FOUND_GRACE_MS) {
      saved = { ok: false, at: now.toISOString(), reason: `${check.reason}, still unknown ${Math.round((now.getTime() - since) / 60_000)} min after the first check`, ...internal };
    }
  }
  if (saved) {
    // Re-read after the await and write only this tx's `verified` (no await between read and write).
    const fresh = store.getEscrow(orderId);
    const target = fresh?.txs.find((t) => t.idempotencyKey === idempotencyKey);
    // A not-found answer never downgrades a transfer Arc already verified.
    if (check.status === "not_found" && target?.verified?.ok) return { check };
    if (fresh && target) {
      target.verified = saved;
      store.saveEscrow(fresh);
      if (check.status === "not_found") notFoundSince.delete(key);
    }
  }
  return { check, saved };
}

const TX_KIND_ID: Record<ChainTx["kind"], string> = {
  customer_topup: "test top-up (internal)", deposit: "payment into escrow", release: "release to Kesuni", refund: "refund",
};

/**
 * Open one needs_info task (simple English) for a transfer that does not match on Arc, unless an open task with
 * the same text already exists. Used by the heartbeat and by the manual "Check now". Never touches escrow or money.
 */
export function openArcMismatchTask(orderId: string, tx: ChainTx, saved: TxVerification): { task: OperatorTask; opened: boolean } {
  const text = `Transfer (${TX_KIND_ID[tx.kind]}) of ${microToUsdc(tx.amountMicro)} USDC for ${orderId} does not match on Arc ` +
    `(hash ${(tx.txHash ?? "").slice(0, 10)}…): ${saved.reason}. Check it in the explorer and in Circle. The escrow was not changed.`;
  const existing = store.listTasks(orderId).find((x) => x.status === "open" && x.text === text);
  if (existing) return { task: existing, opened: false };
  return { task: createTask(orderId, "needs_info", text), opened: true };
}

export interface BatchResult {
  checked: { orderId: string; tx: ChainTx; check: ArcCheck; saved?: TxVerification }[];
  /** Set when the RPC was down (or not configured): the batch stopped; everything is retried next time. */
  unavailable?: string;
}

/** Check up to `limit` unverified txs, least recently tried first. Stops at the first RPC outage. Never throws. */
export async function verifyBatch(opts: { limit?: number; reader?: ArcReader; now?: Date } = {}): Promise<BatchResult> {
  const out: BatchResult = { checked: [] };
  try {
    const tried = (g.__kesuniArcTried ??= new Map());
    const todo = unverifiedTxs()
      .map((r, i) => ({ r, i, last: tried.get(keyOf(r)) ?? 0 }))
      .sort((a, b) => a.last - b.last || a.i - b.i)
      .slice(0, opts.limit ?? 5);
    for (const { r } of todo) {
      const res = await verifyStoredTx(r.orderId, r.tx.idempotencyKey, { reader: opts.reader, now: opts.now });
      if ("error" in res) continue;
      if (res.check.status === "unavailable") {
        out.unavailable = res.check.reason;
        break;
      }
      out.checked.push({ orderId: r.orderId, tx: r.tx, check: res.check, saved: res.saved });
    }
  } catch (e) {
    out.unavailable = `Arc check failed: ${safeRpcError(e)}`;
  }
  return out;
}

// ---------- network health ----------

export interface ArcHealth {
  status: "ok" | "stale" | "wrong_chain" | "bad_token" | "unreachable" | "not_configured";
  expectedChainId?: number;
  chainId?: number;
  blockNumber?: string;
  blockAgeSec?: number;
  usdcDecimals?: number;
  customRpc?: boolean;
  reason?: string;
}

const STALE_MS = 5 * 60_000;

/** eth_chainId, latest block age (STALE over 5 min) and USDC decimals() == 6. Read-only; never throws. */
export async function arcHealth(opts: { reader?: ArcReader; now?: Date } = {}): Promise<ArcHealth> {
  const cfg = arcConfig();
  if (!cfg.ok) return { status: "not_configured", reason: cfg.reason };
  const reader = opts.reader ?? arcReader(cfg);
  if (!reader) return { status: "not_configured", reason: "Arc RPC is not configured" };
  const base = { expectedChainId: cfg.chainId, customRpc: cfg.custom };
  try {
    const chainId = await reader.chainId();
    if (chainId !== cfg.chainId) return { ...base, status: "wrong_chain", chainId, reason: `RPC is on chain ${chainId}, expected ${cfg.chainId}` };
    const [block, decimals] = await Promise.all([reader.block(), reader.decimals(network().usdcAddress as Hex)]);
    if (!block) return { ...base, status: "unreachable", chainId, reason: "No latest block" };
    const ageMs = (opts.now ?? new Date()).getTime() - Number(block.timestamp) * 1000;
    const out = { ...base, chainId, blockNumber: block.number.toString(), blockAgeSec: Math.round(ageMs / 1000), usdcDecimals: Number(decimals) };
    if (Number(decimals) !== 6) return { ...out, status: "bad_token", reason: `USDC decimals() is ${decimals}, expected 6` };
    if (ageMs > STALE_MS) return { ...out, status: "stale", reason: "Latest block is older than 5 minutes" };
    return { ...out, status: "ok" };
  } catch (e) {
    return { ...base, status: "unreachable", reason: safeRpcError(e) };
  }
}

// Read-only health of the two networks the money runs on, for the home page card (GET /api/health/chain).
// Arc: eth_chainId, latest block age, USDC decimals (arc-verify.ts). Circle: the wallet set is reachable and the
// demo-funds wallet (KESUNI_DEMO_FUNDS_ADDRESS) with its USDC balance, through the Circle gateway. Each side fails
// on its own as "unreachable" (Circle needs WARP on some ISPs) and never breaks the page. Results are cached ~60 s
// in memory. Nothing here creates wallets, signs or moves money; no URL, key or secret is returned.
import { arcHealth, safeRpcError, type ArcHealth, type ArcReader } from "./arc-verify";
import { circle, type CircleGateway } from "./circle";
import { microToUsdc } from "./policy";
import { network, type PublicNetwork, publicNetwork } from "./network";

export interface CircleHealthView {
  status: "ok" | "unreachable" | "not_configured";
  walletSet?: "reachable" | "not found";
  /** The demo-funds wallet, address shortened. null: no wallet with that address in Circle. */
  wallet?: { address: string; blockchain: string; state: string; usdc: string } | null;
  reason?: string;
}

export interface ChainHealth {
  at: string;
  network: PublicNetwork;
  arc: ArcHealth;
  circle: CircleHealthView;
  cached: boolean;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 10_000;
const g = globalThis as unknown as { __kesuniChainHealth?: { at: number; value: ChainHealth } };

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const NOT_CONFIGURED = /is not configured|is missing/i;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`${what} timed out`)), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export async function circleHealth(gateway?: CircleGateway): Promise<CircleHealthView> {
  let gw: CircleGateway;
  try {
    gw = gateway ?? circle();
  } catch (e) {
    const reason = safeRpcError(e);
    return { status: NOT_CONFIGURED.test(reason) ? "not_configured" : "unreachable", reason };
  }
  if (!gw.health) return { status: "not_configured", reason: "This Circle gateway has no health check" };
  try {
    const h = await withTimeout(gw.health(process.env.KESUNI_DEMO_FUNDS_ADDRESS || undefined), "Circle");
    return {
      status: h.walletSetReachable ? "ok" : "unreachable",
      walletSet: h.walletSetReachable ? "reachable" : "not found",
      wallet: h.wallet === undefined ? undefined : h.wallet === null ? null : {
        address: short(h.wallet.address), blockchain: h.wallet.blockchain, state: h.wallet.state, usdc: microToUsdc(h.wallet.usdcMicro),
      },
    };
  } catch (e) {
    return { status: "unreachable", reason: safeRpcError(e) };
  }
}

/** Both checks, cached for 60 s unless `fresh`. Never throws. */
export async function chainHealth(opts: { fresh?: boolean; reader?: ArcReader; gateway?: CircleGateway; now?: Date } = {}): Promise<ChainHealth> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const hit = g.__kesuniChainHealth;
  if (!opts.fresh && hit && nowMs - hit.at < TTL_MS) return { ...hit.value, cached: true };
  const [arc, circ] = await Promise.all([
    withTimeout(arcHealth({ reader: opts.reader, now: opts.now }), "Arc RPC")
      .catch((e): ArcHealth => ({ status: "unreachable", reason: safeRpcError(e) })),
    circleHealth(opts.gateway),
  ]);
  const value: ChainHealth = { at: new Date(nowMs).toISOString(), network: publicNetwork(network().blockchain), arc, circle: circ, cached: false };
  g.__kesuniChainHealth = { at: nowMs, value };
  return value;
}

/** Tests only. */
export function clearChainHealthCache(): void {
  g.__kesuniChainHealth = undefined;
}

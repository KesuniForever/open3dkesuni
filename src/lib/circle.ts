// Thin gateway to Circle developer-controlled wallets on Arc. Server-only.
// Everything that touches Circle goes through CircleGateway, so tests can swap in a fake
// and no other module needs the API key or entity secret.
// The chain comes from network.ts (CIRCLE_BLOCKCHAIN). On a mainnet chain every wallet creation and
// transfer is refused unless KESUNI_ALLOW_MAINNET=1 (checked here, for the real and the fake gateway).
import { initiateDeveloperControlledWalletsClient, type Blockchain } from "@circle-fin/developer-controlled-wallets";
import { microToUsdc, usdcToMicro } from "./policy";
import { assertMoneyAllowed, isTestnetChain, network } from "./network";
import type { ChainTxState } from "./types";

export { ARC_USDC } from "./network";
export const FINAL_STATES: ChainTxState[] = ["COMPLETE", "FAILED", "DENIED", "CANCELLED"];

export interface CircleTransfer {
  circleTxId: string;
  state: ChainTxState;
  txHash?: string;
  errorReason?: string;
}

export interface CircleGateway {
  network: string;
  /** SCA wallets: Circle Gas Station pays gas, so a wallet can send its whole balance. */
  createWallet(name: string, refId: string): Promise<{ walletId: string; address: string }>;
  usdcBalanceMicro(walletId: string): Promise<number>;
  transferUsdc(args: {
    fromAddress: string; to: string; amountMicro: number; idempotencyKey: string; refId: string;
  }): Promise<CircleTransfer>;
  getTransfer(circleTxId: string): Promise<CircleTransfer>;
  /** Read-only health check (optional; test fakes may leave it out): the wallet set is reachable, and the wallet at
   *  `address` (if given and found) with its USDC balance. Never creates or moves anything. */
  health?(address?: string): Promise<CircleHealth>;
}

export interface CircleHealth {
  walletSetReachable: boolean;
  wallet?: { address: string; blockchain: string; state: string; custodyType?: string; usdcMicro: number } | null; // null: not found
}

/**
 * Refuse an API key from the wrong Circle environment, before any client is made. A LIVE key moves real money, so
 * it needs KESUNI_ALLOW_MAINNET=1 (and a mainnet chain); a TEST key cannot work on a mainnet chain. The key itself
 * is never put in the error.
 */
export function assertApiKeyMatchesChain(apiKey: string, blockchain: string): void {
  const live = apiKey.startsWith("LIVE_API_KEY");
  const test = apiKey.startsWith("TEST_API_KEY");
  if (live && process.env.KESUNI_ALLOW_MAINNET !== "1") {
    throw new Error(
      "Refusing a Circle LIVE API key: it moves real USDC. Use a TEST_API_KEY on Arc Testnet, or set KESUNI_ALLOW_MAINNET=1 " +
      "only after the owner and Sabina approve and the checks in docs/PILOT.md are done.",
    );
  }
  if (live && isTestnetChain(blockchain)) {
    throw new Error(`A Circle LIVE API key cannot be used on ${blockchain} (a testnet). Use a TEST_API_KEY, or set CIRCLE_BLOCKCHAIN to a mainnet chain.`);
  }
  if (test && !isTestnetChain(blockchain)) {
    throw new Error(`A Circle TEST API key cannot be used on ${blockchain} (mainnet). Use a LIVE_API_KEY, or set CIRCLE_BLOCKCHAIN=ARC-TESTNET.`);
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Circle is not configured: ${name} is missing (see .env.example)`);
  return v;
}

function realGateway(): CircleGateway {
  const net = network();
  const apiKey = env("CIRCLE_API_KEY");
  assertApiKeyMatchesChain(apiKey, net.blockchain);
  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret: env("CIRCLE_ENTITY_SECRET"),
  });
  const walletSetId = env("CIRCLE_WALLET_SET_ID");
  const blockchain = net.blockchain as Blockchain;
  const usdc = net.usdcAddress;
  const toTransfer = (t: { id: string; state: string; txHash?: string; errorReason?: string }): CircleTransfer => ({
    circleTxId: t.id, state: t.state as ChainTxState, txHash: t.txHash || undefined, errorReason: t.errorReason || undefined,
  });

  return {
    network: blockchain,
    async createWallet(name, refId) {
      const res = await client.createWallets({
        walletSetId, blockchains: [blockchain], count: 1, accountType: "SCA",
        metadata: [{ name, refId }],
      });
      const w = res.data?.wallets?.[0];
      if (!w) throw new Error("Circle returned no wallet");
      return { walletId: w.id, address: w.address };
    },
    async usdcBalanceMicro(walletId) {
      const res = await client.getWalletTokenBalance({ id: walletId, tokenAddresses: [usdc] });
      const amount = res.data?.tokenBalances?.[0]?.amount ?? "0";
      return usdcToMicro(amount);
    },
    async transferUsdc({ fromAddress, to, amountMicro, idempotencyKey, refId }) {
      const res = await client.createTransaction({
        walletAddress: fromAddress, blockchain: blockchain as "ARC-TESTNET", tokenAddress: usdc, destinationAddress: to,
        amount: [microToUsdc(amountMicro)], fee: { type: "level", config: { feeLevel: "MEDIUM" } },
        idempotencyKey, refId,
      });
      const d = res.data;
      if (!d?.id) throw new Error("Circle returned no transaction id");
      return { circleTxId: d.id, state: d.state as ChainTxState };
    },
    async getTransfer(circleTxId) {
      const res = await client.getTransaction({ id: circleTxId });
      const t = res.data?.transaction;
      if (!t) throw new Error(`Circle transaction ${circleTxId} not found`);
      return toTransfer(t);
    },
    async health(address) {
      const set = await client.getWalletSet({ id: walletSetId });
      const out: CircleHealth = { walletSetReachable: Boolean(set.data?.walletSet?.id) };
      if (!address) return out;
      const res = await client.listWallets({ address, blockchain });
      const w = res.data?.wallets?.[0];
      if (!w) return { ...out, wallet: null };
      const bal = await client.getWalletTokenBalance({ id: w.id, tokenAddresses: [usdc] });
      return {
        ...out,
        wallet: {
          address: w.address, blockchain: w.blockchain, state: w.state, custodyType: w.custodyType,
          usdcMicro: usdcToMicro(bal.data?.tokenBalances?.[0]?.amount ?? "0"),
        },
      };
    },
  };
}

const g = globalThis as unknown as { __kesuniCircle?: CircleGateway };

/** The mainnet safety switch wraps whichever gateway is in use: no wallets, no transfers without it. */
function guarded(gw: CircleGateway): CircleGateway {
  return {
    ...gw,
    async createWallet(name, refId) {
      assertMoneyAllowed(gw.network);
      return gw.createWallet(name, refId);
    },
    async transferUsdc(args) {
      assertMoneyAllowed(gw.network);
      return gw.transferUsdc(args);
    },
  };
}

export function circle(): CircleGateway {
  return guarded((g.__kesuniCircle ??= realGateway()));
}

/** Tests only: replace the gateway with a fake. */
export function setCircleGateway(gw: CircleGateway | undefined): void {
  g.__kesuniCircle = gw;
}

// Thin gateway to Circle developer-controlled wallets on Arc. Server-only.
// Everything that touches Circle goes through CircleGateway, so tests can swap in a fake
// and no other module needs the API key or entity secret.
import { initiateDeveloperControlledWalletsClient, type Blockchain } from "@circle-fin/developer-controlled-wallets";
import { microToUsdc, usdcToMicro } from "./policy";
import type { ChainTxState } from "./types";

/** USDC on Arc: ERC-20 interface at this address, 6 decimals (native gas view uses 18; never mix). */
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
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
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Circle is not configured: ${name} is missing (see .env.example)`);
  return v;
}

function realGateway(): CircleGateway {
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: env("CIRCLE_API_KEY"),
    entitySecret: env("CIRCLE_ENTITY_SECRET"),
  });
  const walletSetId = env("CIRCLE_WALLET_SET_ID");
  const blockchain = (process.env.CIRCLE_BLOCKCHAIN ?? "ARC-TESTNET") as Blockchain;
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
      const res = await client.getWalletTokenBalance({ id: walletId, tokenAddresses: [ARC_USDC] });
      const amount = res.data?.tokenBalances?.[0]?.amount ?? "0";
      return usdcToMicro(amount);
    },
    async transferUsdc({ fromAddress, to, amountMicro, idempotencyKey, refId }) {
      const res = await client.createTransaction({
        walletAddress: fromAddress, blockchain: blockchain as "ARC-TESTNET", tokenAddress: ARC_USDC, destinationAddress: to,
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
  };
}

const g = globalThis as unknown as { __kesuniCircle?: CircleGateway };

export function circle(): CircleGateway {
  return (g.__kesuniCircle ??= realGateway());
}

/** Tests only: replace the gateway with a fake. */
export function setCircleGateway(gw: CircleGateway | undefined): void {
  g.__kesuniCircle = gw;
}

// Shared by tests: an in-memory Circle gateway.
import type { CircleGateway, CircleTransfer } from "./circle";

export const DEMO = "0x00000000000000000000000000000000000000de";

/** In-memory Circle: wallets with balances; transfers COMPLETE on the next getTransfer. */
export function fakeCircle() {
  const balances = new Map<string, number>(); // address -> micro
  const walletAddr = new Map<string, string>(); // walletId -> address
  const txs = new Map<string, { from: string; to: string; amount: number; state: CircleTransfer["state"] }>();
  const byKey = new Map<string, string>(); // idempotencyKey -> circleTxId
  let n = 0;
  const calls = { transfers: 0 };
  let failNextTransfer = false;
  balances.set(DEMO, 1_000_000_000);
  const gw: CircleGateway = {
    network: "ARC-TESTNET",
    async createWallet() {
      n++;
      const address = `0x${String(n).padStart(40, "a")}`;
      walletAddr.set(`w${n}`, address);
      balances.set(address, 0);
      return { walletId: `w${n}`, address };
    },
    async usdcBalanceMicro(walletId) {
      return balances.get(walletAddr.get(walletId)!) ?? 0;
    },
    async transferUsdc({ fromAddress, to, amountMicro, idempotencyKey }) {
      if (failNextTransfer) { failNextTransfer = false; throw new Error("network timeout"); }
      const existing = byKey.get(idempotencyKey);
      if (existing) return { circleTxId: existing, state: txs.get(existing)!.state }; // Circle idempotency
      calls.transfers++;
      const id = `tx${txs.size + 1}`;
      byKey.set(idempotencyKey, id);
      txs.set(id, { from: fromAddress, to, amount: amountMicro, state: "INITIATED" });
      return { circleTxId: id, state: "INITIATED" };
    },
    async getTransfer(id) {
      const t = txs.get(id)!;
      if (t.state === "INITIATED") {
        balances.set(t.from, (balances.get(t.from) ?? 0) - t.amount);
        balances.set(t.to, (balances.get(t.to) ?? 0) + t.amount);
        t.state = "COMPLETE";
      }
      return { circleTxId: id, state: t.state, txHash: `0xhash${id}` };
    },
  };
  return { gw, balances, calls, failNext: () => { failNextTransfer = true; } };
}


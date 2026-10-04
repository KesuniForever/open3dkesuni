// Real Arc testnet run through Circle. Skipped unless RUN_ARC_E2E=1 (moves test USDC).
//   RUN_ARC_E2E=1 npx vitest run src/lib/escrow.e2e.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_ARC_E2E === "1";
if (enabled) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!enabled)("escrow on Arc testnet (real Circle)", () => {
  it("customer pays 0.5 USDC into escrow, accepts, escrow releases to Kesuni", async () => {
    const store = await import("./store");
    const actions = await import("./actions");
    const escrow = await import("./escrow");

    const o = actions.createOrder({
      product: "E2E test clicker", quantity: 1, deadline: "2026-10-09", designVersion: "e2e",
      mandateMicro: 1_000_000, label: "simulated",
    });
    if (!o.ok) throw new Error(o.error);
    const id = o.order.id;
    const q = actions.addQuote(id, { vendorId: "own", priceMicro: 500_000, etaHours: 24 });
    if (!q.ok) throw new Error(q.error);
    expect(actions.chooseQuote(id, q.quote.id, "agent", "e2e").ok).toBe(true);

    const until = async (want: string) => {
      for (let i = 0; i < 40; i++) {
        const r = await escrow.syncEscrow(id);
        if (r.ok && r.escrow.state === want) return r.escrow;
        if (r.ok && r.escrow.txs.every((t) => ["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(t.state))) {
          if (r.escrow.state === want) return r.escrow;
        }
        await sleep(2000);
      }
      throw new Error(`escrow never reached ${want}: ${JSON.stringify(store.getEscrow(id))}`);
    };
    const settled = async () => {
      for (let i = 0; i < 40; i++) {
        const r = await escrow.syncEscrow(id);
        if (r.ok && r.escrow.txs.every((t) => ["COMPLETE", "FAILED", "DENIED", "CANCELLED"].includes(t.state))) return r.escrow;
        await sleep(2000);
      }
      throw new Error("transfers never settled");
    };

    const opened = await escrow.openEscrow(id);
    if (!opened.ok) throw new Error(`${opened.error} ${opened.reasons ?? ""}`);
    const top = await escrow.topUpCustomer(id);
    if (!top.ok) throw new Error(`${top.error} ${top.reasons ?? ""}`);
    await settled();
    const dep = await escrow.deposit(id);
    if (!dep.ok) throw new Error(`${dep.error} ${dep.reasons ?? ""}`);
    await until("FUNDED");

    actions.addEvidence(id, { kind: "qc", note: "e2e qc", label: "manual" });
    expect(actions.recordAcceptance(id, { accepted: true, by: "e2e", note: "ok" }).ok).toBe(true);
    const rel = await escrow.release(id);
    if (!rel.ok) throw new Error(`${rel.error} ${rel.reasons ?? ""}`);
    const final = await until("RELEASED");

    console.log(JSON.stringify({
      escrow: final.escrowAddress, customer: final.customerAddress,
      txs: final.txs.map((t) => ({ kind: t.kind, state: t.state, txHash: t.txHash, amount: t.amountMicro / 1e6 })),
      intent: store.listIntents(id)[0], order: store.getOrder(id)?.status,
    }, null, 2));
    expect(store.getOrder(id)?.status).toBe("PAID");
  }, 300_000);
});

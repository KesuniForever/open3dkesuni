import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { circle, setCircleGateway } from "./circle";
import { chooseQuote, createPaymentIntent } from "./actions";
import { openEscrow } from "./escrow";
import { DEMO, fakeCircle } from "./fake-circle.test-helper";
import { ARC_USDC, explorerTxBase, network, publicNetwork } from "./network";

const ENV = ["CIRCLE_BLOCKCHAIN", "KESUNI_ALLOW_MAINNET", "KESUNI_EXPLORER_TX_URL", "KESUNI_USDC_ADDRESS"];
afterEach(() => { for (const k of ENV) delete process.env[k]; });
afterAll(() => setCircleGateway(undefined));

describe("network config (testnet now, mainnet by configuration)", () => {
  it("defaults to Arc Testnet, exactly as before", () => {
    expect(network()).toMatchObject({
      blockchain: "ARC-TESTNET", isTestnet: true, label: "testnet", name: "Arc Testnet",
      explorerTxBase: "https://explorer.testnet.arc.io/tx/", usdcAddress: ARC_USDC,
    });
    expect(network().explorerTxUrl("0xabc")).toBe("https://explorer.testnet.arc.io/tx/0xabc");
  });

  it("CIRCLE_BLOCKCHAIN=ARC is mainnet; explorer and USDC address can be set", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    expect(network()).toMatchObject({ blockchain: "ARC", isTestnet: false, label: "mainnet", name: "Arc" });
    process.env.KESUNI_EXPLORER_TX_URL = "https://example.org/tx";
    process.env.KESUNI_USDC_ADDRESS = "0x00000000000000000000000000000000000000aa";
    expect(network().explorerTxUrl("0x1")).toBe("https://example.org/tx/0x1");
    expect(network().usdcAddress).toBe("0x00000000000000000000000000000000000000aa");
    // An escrow opened earlier on testnet keeps its testnet explorer link.
    expect(explorerTxBase("ARC-TESTNET")).toBe("https://explorer.testnet.arc.io/tx/");
    expect(publicNetwork("ARC-TESTNET")).toMatchObject({ isTestnet: true, name: "Arc Testnet" });
  });
});

describe("mainnet safety switch", () => {
  const SHOP = "0x1111111111111111111111111111111111111111";
  let fake: ReturnType<typeof fakeCircle>;
  beforeEach(() => {
    process.env.KESUNI_PAYOUT_ADDRESS = SHOP;
    store.resetDb();
    fake = fakeCircle();
  });
  afterAll(() => { delete process.env.KESUNI_PAYOUT_ADDRESS; });

  const onMainnet = () => setCircleGateway({ ...fake.gw, network: "ARC" });

  it("without KESUNI_ALLOW_MAINNET no wallet is created and no USDC moves", async () => {
    onMainnet();
    await expect(circle().createWallet("x", "y")).rejects.toThrow(/Mainnet is locked/);
    await expect(circle().transferUsdc({ fromAddress: DEMO, to: SHOP, amountMicro: 1, idempotencyKey: "k", refId: "r" })).rejects.toThrow(/KESUNI_ALLOW_MAINNET=1/);
    expect(fake.calls.transfers).toBe(0);
    chooseQuote("ORD-001", "Q-own", "human", "ok");
    const r = await openEscrow("ORD-001");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Mainnet is locked/);
    expect(store.getEscrow("ORD-001")).toBeUndefined();
  });

  it("with KESUNI_ALLOW_MAINNET=1 the escrow opens and is labelled mainnet", async () => {
    onMainnet();
    process.env.KESUNI_ALLOW_MAINNET = "1";
    chooseQuote("ORD-001", "Q-own", "human", "ok");
    const r = await openEscrow("ORD-001");
    expect(r.ok && r.escrow).toMatchObject({ network: "ARC", label: "mainnet" });
  });

  it("testnet needs no switch", async () => {
    setCircleGateway(fake.gw);
    await expect(circle().createWallet("x", "y")).resolves.toMatchObject({ walletId: "w1" });
  });

  it("payment intents record the configured chain", () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    store.saveOrder({ ...store.getOrder("ORD-001")!, status: "ACCEPTED", chosenQuoteId: "Q-own" });
    store.saveAcceptance({ orderId: "ORD-001", accepted: true, by: "Aini", note: "", at: new Date().toISOString() });
    store.addEvidence({ id: "E-1", orderId: "ORD-001", kind: "qc", note: "ok", label: "manual", at: new Date().toISOString() });
    const r = createPaymentIntent("ORD-001", { recipient: SHOP, amountMicro: 30_000_000, idempotencyKey: "k1" });
    expect(r.ok && r.intent.network).toBe("ARC");
  });
});

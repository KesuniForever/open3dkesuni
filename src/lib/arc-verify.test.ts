import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { ARC_USDC } from "./network";
import {
  ARC_TESTNET_CHAIN_ID, TRANSFER_TOPIC, arcConfig, arcHealth, arcReader, setArcReader, unverifiedTxs, verifyBatch, verifyStoredTx,
  verifyTransfer, type ArcBlock, type ArcLog, type ArcReader, type ArcReceipt,
} from "./arc-verify";
import { runHeartbeat } from "./agent/heartbeat";
import { setLlmGateway } from "./agent/chief";
import { customerView } from "./customer";
import type { ChainTx, Escrow } from "./types";
import { POST } from "@/app/api/arc/verify/route";

const ORDER = "ORD-001";
const CUSTOMER = "0x" + "c".repeat(40);
const ESCROW = "0x" + "e".repeat(40);
const SHOP = "0x" + "5".repeat(40);
const DEMO = "0x" + "d".repeat(40);
const H1 = "0x" + "1".repeat(64);
const H2 = "0x" + "2".repeat(64);
const H3 = "0x" + "3".repeat(64);
const BLOCK_HASH = "0x" + "b".repeat(64);
const SECRET_RPC = "https://arc.example/v1/secret-key-123";

const topic = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
const amountData = (micro: bigint) => "0x" + micro.toString(16).padStart(64, "0");

function transferLog(from: string, to: string, micro: bigint, logIndex: number, txHash: string, extra: Partial<ArcLog> = {}): ArcLog {
  return {
    address: ARC_USDC, topics: [TRANSFER_TOPIC, topic(from), topic(to)], data: amountData(micro), logIndex,
    transactionHash: txHash, blockHash: BLOCK_HASH, ...extra,
  };
}
function receipt(txHash: string, logs: ArcLog[], extra: Partial<ArcReceipt> = {}): ArcReceipt {
  return { transactionHash: txHash, blockHash: BLOCK_HASH, blockNumber: BigInt(100), status: "success", logs, ...extra };
}

/** A fake Arc RPC. Counts calls so tests can prove what was (not) asked. */
function fakeArc(o: {
  chainId?: number; receipts?: Record<string, ArcReceipt>; block?: ArcBlock | null; latest?: ArcBlock; decimals?: number; down?: Error;
} = {}) {
  const calls = { chainId: 0, receipt: 0 };
  const canonical: ArcBlock = { number: BigInt(100), hash: BLOCK_HASH, timestamp: BigInt(1_800_000_000) };
  const reader: ArcReader = {
    async chainId() { calls.chainId++; if (o.down) throw o.down; return o.chainId ?? ARC_TESTNET_CHAIN_ID; },
    async receipt(h) { calls.receipt++; if (o.down) throw o.down; return o.receipts?.[h] ?? null; },
    async block(n) {
      if (o.down) throw o.down;
      if (n === undefined) return o.latest ?? canonical;
      return o.block === undefined ? canonical : o.block;
    },
    async decimals() { if (o.down) throw o.down; return o.decimals ?? 6; },
  };
  return { reader, calls };
}

const INPUT = { txHash: H1, from: CUSTOMER, to: ESCROW, amountMicro: 12_500_000 };

describe("verifyTransfer", () => {
  it("verifies exactly one matching USDC Transfer (6 decimals) and returns chainId:txHash:logIndex", async () => {
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 7, H1)]) } });
    expect(await verifyTransfer(INPUT, { reader })).toEqual({
      status: "verified", chainId: 5042002, logIndex: 7, logId: `5042002:${H1}:7`, blockNumber: "100",
    });
  });

  it("accepts checksummed / upper-case addresses and hashes", async () => {
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]) } });
    const r = await verifyTransfer({ ...INPUT, txHash: H1.toUpperCase().replace("0X", "0x"), from: CUSTOMER.toUpperCase().replace("0X", "0x") }, { reader });
    expect(r.status).toBe("verified");
  });

  it("an amount in 18 decimals (native gas view) is not a 6-decimal USDC match", async () => {
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000) * BigInt(10) ** BigInt(12), 0, H1)]) } });
    const r = await verifyTransfer(INPUT, { reader });
    expect(r).toMatchObject({ status: "mismatch" });
    expect(r.status === "mismatch" && r.reason).toContain("No USDC Transfer of 12.5 USDC");
  });

  it("rejects the wrong sender, recipient, token contract, a removed log and a log from another tx", async () => {
    const logs = [
      transferLog(DEMO, ESCROW, BigInt(12_500_000), 0, H1),
      transferLog(CUSTOMER, SHOP, BigInt(12_500_000), 1, H1),
      transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 2, H1, { address: "0x" + "9".repeat(40) }),
      transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 3, H1, { removed: true }),
      transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 4, H2),
    ];
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, logs) } });
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "mismatch", reason: expect.stringContaining("it has 2 USDC transfers") });
  });

  it("two identical transfers are not exactly one", async () => {
    const logs = [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1), transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 1, H1)];
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, logs) } });
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "mismatch", reason: expect.stringContaining("expected exactly one") });
  });

  it("a reverted transaction is a mismatch", async () => {
    const { reader } = fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)], { status: "reverted" }) } });
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "mismatch", reason: expect.stringContaining("reverted") });
  });

  it("a receipt whose block is not canonical is a mismatch", async () => {
    const { reader } = fakeArc({
      receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]) },
      block: { number: BigInt(100), hash: "0x" + "f".repeat(64), timestamp: BigInt(1) },
    });
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "mismatch", reason: expect.stringContaining("canonical") });
  });

  it("an unknown hash is not_found (retry), not a mismatch", async () => {
    const { reader } = fakeArc();
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "not_found" });
  });

  it("an RPC on another chain checks nothing", async () => {
    const { reader, calls } = fakeArc({ chainId: 1 });
    expect(await verifyTransfer(INPUT, { reader })).toMatchObject({ status: "unavailable", reason: expect.stringContaining("chain 1") });
    expect(calls.receipt).toBe(0);
  });

  it("an RPC outage is unavailable and never leaks the RPC URL", async () => {
    const { reader } = fakeArc({ down: new Error(`HTTP request failed.\n\nURL: ${SECRET_RPC}\nDetails: fetch failed`) });
    const r = await verifyTransfer(INPUT, { reader });
    expect(r.status).toBe("unavailable");
    expect(JSON.stringify(r)).not.toContain("secret-key");
    const r2 = await verifyTransfer(INPUT, { reader: fakeArc({ down: new Error(`fetch ${SECRET_RPC} failed`) }).reader });
    expect(JSON.stringify(r2)).not.toContain("secret-key");
  });

  it("validates the input before asking Arc", async () => {
    const { reader, calls } = fakeArc();
    expect(await verifyTransfer({ ...INPUT, txHash: "0x123" }, { reader })).toMatchObject({ status: "invalid" });
    expect(await verifyTransfer({ ...INPUT, to: "0xnope" }, { reader })).toMatchObject({ status: "invalid" });
    expect(await verifyTransfer({ ...INPUT, amountMicro: 0 }, { reader })).toMatchObject({ status: "invalid" });
    expect(calls.chainId).toBe(0);
  });
});

describe("config", () => {
  afterEach(() => {
    delete process.env.KESUNI_ARC_RPC_URL;
    delete process.env.KESUNI_ARC_CHAIN_ID;
    delete process.env.CIRCLE_BLOCKCHAIN;
  });

  it("defaults to the public Arc Testnet RPC and chain 5042002; KESUNI_ARC_RPC_URL overrides the URL", () => {
    expect(arcConfig()).toEqual({ ok: true, rpcUrl: "https://rpc.testnet.arc.io", chainId: 5042002, custom: false });
    process.env.KESUNI_ARC_RPC_URL = SECRET_RPC;
    expect(arcConfig()).toMatchObject({ ok: true, rpcUrl: SECRET_RPC, custom: true });
  });

  it("on a mainnet chain it refuses to guess the RPC or chain id", async () => {
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    expect(arcConfig()).toMatchObject({ ok: false });
    expect(await verifyTransfer(INPUT, { reader: fakeArc().reader })).toMatchObject({ status: "unavailable" });
  });

  it("never reaches the network under vitest without an injected reader", async () => {
    setArcReader(undefined);
    const r = await verifyTransfer(INPUT, { reader: arcReader()! });
    expect(r).toMatchObject({ status: "unavailable", reason: expect.stringContaining("off in tests") });
  });
});

describe("arcHealth", () => {
  const now = new Date(1_800_000_000_000 + 30_000);
  it("ok: chain 5042002, fresh block, USDC decimals 6", async () => {
    expect(await arcHealth({ reader: fakeArc().reader, now })).toMatchObject({
      status: "ok", chainId: 5042002, blockNumber: "100", blockAgeSec: 30, usdcDecimals: 6,
    });
  });
  it("STALE when the latest block is older than 5 minutes", async () => {
    expect(await arcHealth({ reader: fakeArc().reader, now: new Date(1_800_000_000_000 + 6 * 60_000) })).toMatchObject({ status: "stale" });
  });
  it("wrong chain, wrong decimals and an outage are reported, never thrown", async () => {
    expect(await arcHealth({ reader: fakeArc({ chainId: 1 }).reader, now })).toMatchObject({ status: "wrong_chain", chainId: 1 });
    expect(await arcHealth({ reader: fakeArc({ decimals: 18 }).reader, now })).toMatchObject({ status: "bad_token", usdcDecimals: 18 });
    const down = await arcHealth({ reader: fakeArc({ down: new Error(`URL: ${SECRET_RPC}`) }).reader, now });
    expect(down.status).toBe("unreachable");
    expect(JSON.stringify(down)).not.toContain("secret-key");
  });
});

// ---------- stored escrow txs + heartbeat ----------

function tx(kind: ChainTx["kind"], from: string, to: string, amountMicro: number, txHash: string, extra: Partial<ChainTx> = {}): ChainTx {
  return { kind, from, to, amountMicro, idempotencyKey: `key-${kind}`, state: "COMPLETE", txHash, at: new Date().toISOString(), ...extra };
}
function saveEscrow(txs: ChainTx[], extra: Partial<Escrow> = {}): Escrow {
  const e: Escrow = {
    orderId: ORDER, amountMicro: 12_500_000, escrowWalletId: "w-e", escrowAddress: ESCROW, customerWalletId: "w-c", customerAddress: CUSTOMER,
    state: "FUNDED", txs, network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(), ...extra,
  };
  store.saveEscrow(e);
  return e;
}

beforeEach(() => {
  store.resetDb();
  setArcReader(undefined);
  process.env.KESUNI_DAILY_REVIEW_HOUR = "off";
  process.env.KESUNI_AGENT_MODE = "rules";
  setLlmGateway(async () => { throw new Error("no Claude in this test"); });
});
afterAll(() => {
  setArcReader(undefined);
  setLlmGateway(undefined);
  delete process.env.KESUNI_DAILY_REVIEW_HOUR;
  delete process.env.KESUNI_AGENT_MODE;
});

describe("stored escrow txs", () => {
  it("lists only COMPLETE, unchecked txs with a real hash on this chain, money txs before top-ups", () => {
    saveEscrow([
      tx("customer_topup", DEMO, CUSTOMER, 12_500_000, H3),
      tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1),
      tx("release", ESCROW, SHOP, 12_500_000, H2, { state: "SENT" }),
      tx("refund", ESCROW, CUSTOMER, 12_500_000, "0xhashtx1"),
    ]);
    expect(unverifiedTxs().map((r) => r.tx.kind)).toEqual(["deposit", "customer_topup"]);
    store.saveEscrow({ ...store.getEscrow(ORDER)!, network: "ARC" });
    expect(unverifiedTxs()).toEqual([]);
  });

  it("saves a verification on the tx only; the escrow state and the other txs stay as they were", async () => {
    const before = saveEscrow([tx("customer_topup", DEMO, CUSTOMER, 12_500_000, H3), tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1)]);
    const { reader } = fakeArc({ receipts: {
      [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 2, H1)]),
      [H3]: receipt(H3, [transferLog(DEMO, CUSTOMER, BigInt(12_500_000), 0, H3)]),
    } });
    const r = await verifyBatch({ reader });
    expect(r.checked.map((c) => c.check.status)).toEqual(["verified", "verified"]);
    const after = store.getEscrow(ORDER)!;
    expect(after.state).toBe(before.state);
    expect(after.amountMicro).toBe(before.amountMicro);
    expect(after.txs.map(({ verified, ...rest }) => { void verified; return rest; })).toEqual(before.txs);
    expect(after.txs[1].verified).toMatchObject({ ok: true, logId: `5042002:${H1}:2` });
    expect(after.txs[0].verified).toMatchObject({ ok: true, internal: true });
    expect(after.txs[1].verified!.internal).toBeUndefined();
  });

  it("a hash Arc does not know is retried, and only reported after an hour", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1, { at: "2026-10-14T00:00:00Z" })]);
    const { reader } = fakeArc();
    const soon = await verifyStoredTx(ORDER, "key-deposit", { reader, now: new Date("2026-10-14T00:10:00Z") });
    expect(soon).toMatchObject({ check: { status: "not_found" } });
    expect("saved" in soon && soon.saved).toBeUndefined();
    expect(store.getEscrow(ORDER)!.txs[0].verified).toBeUndefined();
    await verifyStoredTx(ORDER, "key-deposit", { reader, now: new Date("2026-10-14T02:00:00Z") });
    expect(store.getEscrow(ORDER)!.txs[0].verified).toMatchObject({ ok: false, reason: expect.stringContaining("no receipt") });
  });

  it("an older transfer is not marked a mismatch on its first not-found: the hour runs from the first not-found", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1, { at: "2026-10-14T00:00:00Z" })]);
    const { reader } = fakeArc();
    const first = await verifyStoredTx(ORDER, "key-deposit", { reader, now: new Date("2026-10-14T02:00:00Z") });
    expect(first).toMatchObject({ check: { status: "not_found" } });
    expect("saved" in first && first.saved).toBeUndefined();
    expect(unverifiedTxs()).toHaveLength(1); // still retried by the heartbeat
    await verifyStoredTx(ORDER, "key-deposit", { reader, now: new Date("2026-10-14T02:50:00Z") });
    expect(store.getEscrow(ORDER)!.txs[0].verified).toBeUndefined();
    await verifyStoredTx(ORDER, "key-deposit", { reader, now: new Date("2026-10-14T03:01:00Z") });
    expect(store.getEscrow(ORDER)!.txs[0].verified).toMatchObject({ ok: false, reason: expect.stringContaining("61 min after the first check") });
  });

  it("a found answer resets the not-found clock", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1, { at: "2026-10-14T00:00:00Z" })]);
    await verifyStoredTx(ORDER, "key-deposit", { reader: fakeArc().reader, now: new Date("2026-10-14T01:00:00Z") });
    const reverted = fakeArc({ receipts: { [H1]: receipt(H1, [], { status: "reverted" }) } }).reader;
    await verifyStoredTx(ORDER, "key-deposit", { reader: reverted, now: new Date("2026-10-14T01:30:00Z") });
    store.saveEscrow({ ...store.getEscrow(ORDER)!, txs: [{ ...store.getEscrow(ORDER)!.txs[0], verified: undefined }] });
    const r = await verifyStoredTx(ORDER, "key-deposit", { reader: fakeArc().reader, now: new Date("2026-10-14T03:00:00Z") });
    expect("saved" in r && r.saved).toBeUndefined();
  });

  it("a not-found answer never turns an earlier verified result into a mismatch", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1, { at: "2026-10-14T00:00:00Z" })]);
    const good = fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]) } }).reader;
    await verifyStoredTx(ORDER, "key-deposit", { reader: good, now: new Date("2026-10-14T00:05:00Z") });
    const verified = store.getEscrow(ORDER)!.txs[0].verified;
    expect(verified).toMatchObject({ ok: true });
    const lagging = fakeArc().reader; // a node that is behind: "receipt not found"
    await verifyStoredTx(ORDER, "key-deposit", { reader: lagging, now: new Date("2026-10-14T01:00:00Z") });
    const late = await verifyStoredTx(ORDER, "key-deposit", { reader: lagging, now: new Date("2026-10-14T03:00:00Z") });
    expect(late).toMatchObject({ check: { status: "not_found" } });
    expect("saved" in late ? late.saved : undefined).toBeUndefined();
    expect(store.getEscrow(ORDER)!.txs[0].verified).toEqual(verified);
  });

  it("checks at most `limit` txs and stops at the first RPC outage", async () => {
    saveEscrow([
      tx("deposit", CUSTOMER, ESCROW, 1, H1), tx("release", ESCROW, SHOP, 1, H2), tx("customer_topup", DEMO, CUSTOMER, 1, H3),
    ]);
    const down = fakeArc({ down: new Error("ECONNRESET") });
    const r = await verifyBatch({ reader: down.reader, limit: 5 });
    expect(r.unavailable).toContain("ECONNRESET");
    expect(down.calls.chainId).toBe(1);
    const ok = fakeArc();
    await verifyBatch({ reader: ok.reader, limit: 2 });
    expect(ok.calls.receipt).toBe(2);
  });
});

describe("heartbeat Arc check", () => {
  const beat = async () => {
    const r = await runHeartbeat({ trigger: "button" });
    if (!r.ok) throw new Error(r.error);
    return r.summary;
  };

  it("a verified transfer is logged; a mismatch opens one needs_info task and a log entry, once", async () => {
    saveEscrow([
      tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1),
      tx("release", ESCROW, SHOP, 12_500_000, H2),
    ], { state: "RELEASED" });
    setArcReader(fakeArc({ receipts: {
      [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]),
      [H2]: receipt(H2, [transferLog(ESCROW, SHOP, BigInt(9_000_000), 0, H2)]), // wrong amount
    } }).reader);
    const s = await beat();
    expect(s.actions).toContain(`Verified on Arc: deposit of ${ORDER}`);
    expect(s.actions).toContain(`Arc mismatch on release of ${ORDER}: task opened`);
    const tasks = store.listTasks(ORDER).filter((t) => t.kind === "needs_info");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toContain("(release to Kesuni) of 12.5 USDC");
    expect(tasks[0].text).toContain("The escrow was not changed");
    const logs = store.listLog(ORDER).filter((e) => e.tool === "arc_verify");
    expect(logs.map((e) => e.ok).sort()).toEqual([false, true]);
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");

    await beat(); // both are checked now: nothing new
    expect(store.listTasks(ORDER).filter((t) => t.kind === "needs_info")).toHaveLength(1);
    expect(store.listLog(ORDER).filter((e) => e.tool === "arc_verify")).toHaveLength(2);
  });

  it("an RPC outage creates no task, saves nothing and is retried next beat", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1)]);
    setArcReader(fakeArc({ down: new Error("socket hang up") }).reader);
    const s = await beat();
    expect(s.errors).toEqual([]);
    expect(s.actions.some((a) => a.startsWith("Arc check postponed"))).toBe(true);
    expect(store.listTasks(ORDER)).toEqual([]);
    expect(store.getEscrow(ORDER)!.txs[0].verified).toBeUndefined();

    setArcReader(fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]) } }).reader);
    await beat();
    expect(store.getEscrow(ORDER)!.txs[0].verified).toMatchObject({ ok: true });
  });

  it("checks at most 5 transfers per beat", async () => {
    const hashes = Array.from({ length: 7 }, (_, i) => "0x" + String(i + 1).repeat(64).slice(0, 64));
    saveEscrow(hashes.map((h, i) => tx("deposit", CUSTOMER, ESCROW, 1, h, { idempotencyKey: `k${i}` })));
    const arc = fakeArc({ receipts: Object.fromEntries(hashes.map((h) => [h, receipt(h, [transferLog(CUSTOMER, ESCROW, BigInt(1), 0, h)])])) });
    setArcReader(arc.reader);
    await beat();
    expect(arc.calls.receipt).toBe(5);
    expect(store.getEscrow(ORDER)!.txs.filter((t) => t.verified).length).toBe(5);
  });
});

describe("POST /api/arc/verify and the customer page", () => {
  const post = (body: unknown) => POST(new Request("http://localhost/api/arc/verify", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));

  it("checks a pasted transfer (USDC amount in, 6 decimals) without saving anything", async () => {
    setArcReader(fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 3, H1)]) } }).reader);
    const res = await post({ txHash: H1, from: CUSTOMER, to: ESCROW, amountUsdc: "12.5" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.check).toMatchObject({ status: "verified", logId: `5042002:${H1}:3` });
    expect(j.explorerUrl).toContain(H1);
    expect((await post({ txHash: H1, from: CUSTOMER, to: ESCROW, amountUsdc: "12.4" }).then((r) => r.json())).check.status).toBe("mismatch");
    expect((await post({ txHash: H1, from: CUSTOMER, to: ESCROW, amountUsdc: "abc" })).status).toBe(400);
    expect((await post({ txHash: "0x12", from: CUSTOMER, to: ESCROW, amountUsdc: "1" })).status).toBe(400);
  });

  it("an RPC outage answers 502 without the RPC URL", async () => {
    setArcReader(fakeArc({ down: new Error(`URL: ${SECRET_RPC}`) }).reader);
    const res = await post({ txHash: H1, from: CUSTOMER, to: ESCROW, amountUsdc: "12.5" });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("secret-key");
  });

  it("re-checks a stored escrow tx, saves it, logs it, and the customer sees 'verified on Arc'", async () => {
    saveEscrow([tx("deposit", CUSTOMER, ESCROW, 12_500_000, H1)]);
    setArcReader(fakeArc({ receipts: { [H1]: receipt(H1, [transferLog(CUSTOMER, ESCROW, BigInt(12_500_000), 0, H1)]) } }).reader);
    const order = store.getOrder(ORDER)!;
    expect(customerView(order, "t").escrow!.txs[0].verifiedOnArc).toBeUndefined();
    const j = await (await post({ orderId: ORDER, idempotencyKey: "key-deposit" })).json();
    expect(j.saved).toMatchObject({ ok: true });
    expect(store.listLog(ORDER).filter((e) => e.tool === "arc_verify" && e.actor === "human")).toHaveLength(1);
    expect(customerView(order, "t").escrow!.txs[0].verifiedOnArc).toBe(true);
    expect((await post({ orderId: ORDER, idempotencyKey: "nope" })).status).toBe(404);
  });

  it("a mismatch found with 'Check now' opens exactly one needs_info task, like the heartbeat; escrow is unchanged", async () => {
    saveEscrow([tx("release", ESCROW, SHOP, 12_500_000, H2)], { state: "RELEASED" });
    setArcReader(fakeArc({ receipts: { [H2]: receipt(H2, [transferLog(ESCROW, SHOP, BigInt(9_000_000), 0, H2)]) } }).reader);
    const j = await (await post({ orderId: ORDER, idempotencyKey: "key-release" })).json();
    expect(j.saved).toMatchObject({ ok: false });
    await post({ orderId: ORDER, idempotencyKey: "key-release" }); // a second click: same text, no second task
    const tasks = store.listTasks(ORDER).filter((t) => t.kind === "needs_info");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toContain("(release to Kesuni) of 12.5 USDC");
    expect(tasks[0].text).toContain("The escrow was not changed");
    expect(store.getEscrow(ORDER)!.state).toBe("RELEASED");

    await runHeartbeat({ trigger: "button" }); // already checked: the heartbeat adds nothing
    expect(store.listTasks(ORDER).filter((t) => t.kind === "needs_info")).toHaveLength(1);
  });
});

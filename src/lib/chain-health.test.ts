import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { chainHealth, circleHealth, clearChainHealthCache } from "./chain-health";
import { ARC_TESTNET_CHAIN_ID, setArcReader, type ArcReader } from "./arc-verify";
import { setCircleGateway, type CircleGateway } from "./circle";
import { fakeCircle } from "./fake-circle.test-helper";
import { GET } from "@/app/api/health/chain/route";

const NOW = new Date(1_800_000_000_000 + 20_000);
const DEMO_FUNDS = "0x" + "d".repeat(40);

function reader(calls = { n: 0 }, down = false): ArcReader {
  return {
    async chainId() { calls.n++; if (down) throw new Error("fetch failed"); return ARC_TESTNET_CHAIN_ID; },
    async receipt() { return null; },
    async block() { return { number: BigInt(5), hash: "0x" + "b".repeat(64), timestamp: BigInt(1_800_000_000) }; },
    async decimals() { return 6; },
  };
}
function gateway(health: CircleGateway["health"]): CircleGateway {
  return { ...fakeCircle().gw, health };
}

beforeEach(() => {
  clearChainHealthCache();
  process.env.KESUNI_DEMO_FUNDS_ADDRESS = DEMO_FUNDS;
});
afterAll(() => {
  setArcReader(undefined);
  setCircleGateway(undefined);
  delete process.env.KESUNI_DEMO_FUNDS_ADDRESS;
});

describe("chain health", () => {
  it("reports Arc and the demo-funds wallet balance (address shortened)", async () => {
    const h = await chainHealth({
      reader: reader(), now: NOW,
      gateway: gateway(async (address) => ({
        walletSetReachable: true,
        wallet: { address: address!, blockchain: "ARC-TESTNET", state: "LIVE", custodyType: "DEVELOPER", usdcMicro: 250_500_000 },
      })),
    });
    expect(h.arc).toMatchObject({ status: "ok", chainId: 5042002, usdcDecimals: 6, blockAgeSec: 20 });
    expect(h.circle).toEqual({
      status: "ok", walletSet: "reachable", wallet: { address: "0xdddd…dddd", blockchain: "ARC-TESTNET", state: "LIVE", usdc: "250.5" },
    });
    expect(h.network).toMatchObject({ blockchain: "ARC-TESTNET", isTestnet: true });
  });

  it("Circle unreachable (e.g. ISP block) or Arc down never throws; each side says so", async () => {
    const h = await chainHealth({
      reader: reader({ n: 0 }, true), now: NOW,
      gateway: gateway(async () => { throw new Error("connect ETIMEDOUT"); }),
    });
    expect(h.arc.status).toBe("unreachable");
    expect(h.circle).toMatchObject({ status: "unreachable", reason: expect.stringContaining("ETIMEDOUT") });
  });

  it("Circle without configuration is not_configured", async () => {
    setCircleGateway(undefined);
    delete process.env.CIRCLE_API_KEY;
    expect(await circleHealth()).toMatchObject({ status: "not_configured", reason: expect.stringContaining("CIRCLE_API_KEY") });
    expect(await circleHealth(fakeCircle().gw)).toMatchObject({ status: "not_configured" }); // a gateway without health()
  });

  it("caches for about a minute unless fresh", async () => {
    const calls = { n: 0 };
    const gw = gateway(async () => ({ walletSetReachable: true }));
    await chainHealth({ reader: reader(calls), gateway: gw, now: NOW });
    const again = await chainHealth({ reader: reader(calls), gateway: gw, now: new Date(NOW.getTime() + 30_000) });
    expect(again.cached).toBe(true);
    expect(calls.n).toBe(1);
    await chainHealth({ reader: reader(calls), gateway: gw, now: new Date(NOW.getTime() + 61_000) });
    expect(calls.n).toBe(2);
    await chainHealth({ reader: reader(calls), gateway: gw, now: new Date(NOW.getTime() + 62_000), fresh: true });
    expect(calls.n).toBe(3);
  });

  it("GET /api/health/chain answers 200 with both sides", async () => {
    setArcReader(reader());
    setCircleGateway(gateway(async () => ({ walletSetReachable: true, wallet: null })));
    const res = await GET(new Request("http://localhost/api/health/chain?fresh=1"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.arc.chainId).toBe(5042002);
    expect(j.circle).toMatchObject({ status: "ok", wallet: null });
  });
});

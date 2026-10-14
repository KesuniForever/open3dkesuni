import { afterEach, describe, expect, it } from "vitest";
import { assertApiKeyMatchesChain, circle, setCircleGateway } from "./circle";

const LIVE = "LIVE_API_KEY:abc123:def456";
const TEST = "TEST_API_KEY:abc123:def456";

afterEach(() => {
  delete process.env.KESUNI_ALLOW_MAINNET;
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_BLOCKCHAIN;
  setCircleGateway(undefined);
});

describe("Circle API key guard", () => {
  it("refuses a LIVE key unless KESUNI_ALLOW_MAINNET=1", () => {
    expect(() => assertApiKeyMatchesChain(LIVE, "ARC")).toThrow(/Refusing a Circle LIVE API key.*KESUNI_ALLOW_MAINNET=1/);
    process.env.KESUNI_ALLOW_MAINNET = "1";
    expect(() => assertApiKeyMatchesChain(LIVE, "ARC")).not.toThrow();
  });

  it("refuses a LIVE key on a testnet chain, even when mainnet is allowed", () => {
    process.env.KESUNI_ALLOW_MAINNET = "1";
    expect(() => assertApiKeyMatchesChain(LIVE, "ARC-TESTNET")).toThrow(/LIVE API key cannot be used on ARC-TESTNET/);
  });

  it("refuses a TEST key on a mainnet chain, and accepts it on Arc Testnet", () => {
    expect(() => assertApiKeyMatchesChain(TEST, "ARC")).toThrow(/TEST API key cannot be used on ARC \(mainnet\)/);
    expect(() => assertApiKeyMatchesChain(TEST, "ARC-TESTNET")).not.toThrow();
  });

  it("never puts the key in the error", () => {
    for (const [key, chain] of [[LIVE, "ARC"], [TEST, "ARC"]]) {
      try {
        assertApiKeyMatchesChain(key, chain);
      } catch (e) {
        expect(String(e)).not.toContain("abc123");
      }
    }
  });

  it("the real gateway refuses a LIVE key before any Circle client is made", () => {
    setCircleGateway(undefined);
    process.env.CIRCLE_API_KEY = LIVE;
    expect(() => circle()).toThrow(/Refusing a Circle LIVE API key/);
    process.env.CIRCLE_API_KEY = TEST;
    process.env.CIRCLE_BLOCKCHAIN = "ARC";
    expect(() => circle()).toThrow(/TEST API key cannot be used on ARC/);
  });
});

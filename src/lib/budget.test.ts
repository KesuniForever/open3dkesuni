import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";
import { tLib } from "./lib-text";
import { budgetFromRupiah } from "./actions";
import { idrPerUsdc, idrToMicro } from "./costing";
import {
  budgetEquals, budgetFrom, budgetFromBody, budgetText, idrBudget, looksLikeThousands, parseIdr, parseUsdcMicro, rateText, usdcBudget, usdcText, usdText,
} from "./budget";
import { chiefAuthority } from "./agent/authority";
import { emptySnapshot, type AmsTray } from "./printer/bambu";
import { POST } from "@/app/api/orders/route";

const en = makeT("en", ID);
const id = makeT("id", ID);
const RATE = 16_500;
const ENV = ["IDR_PER_USDC", "KESUNI_PRICE_PER_GRAM_IDR_PETG", "KESUNI_COST_PER_GRAM_IDR_PETG"];
beforeEach(() => store.resetDb());
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("typing the budget", () => {
  it("reads whole rupiah the way people type them, and refuses anything ambiguous", () => {
    for (const s of ["50000", "50.000", "50,000", "50 000", "Rp50.000", "Rp 50.000", "rp. 50.000", " 1.250.000 "]) {
      expect(parseIdr(s), s).toBe(s.includes("1.250") ? 1_250_000 : 50_000);
    }
    expect(parseIdr(33_000)).toBe(33_000);
    for (const s of ["", "0", "-5", "50.5", "50.000,50", "1.000,000", "5.00", "abc", "1e6"]) expect(parseIdr(s), s).toBeNull();
    expect(parseIdr(12.5)).toBeNull();
  });

  it("reads USDC with up to 6 decimals, exactly; a decimal comma only where it cannot be a thousands separator", () => {
    expect(parseUsdcMicro("32")).toBe(32_000_000);
    expect(parseUsdcMicro("32.5")).toBe(32_500_000);
    expect(parseUsdcMicro("3.030303")).toBe(3_030_303);
    expect(parseUsdcMicro("0.000001")).toBe(1);
    expect(parseUsdcMicro("3,5")).toBe(3_500_000);
    expect(parseUsdcMicro("3,5151")).toBe(3_515_100);
    for (const s of ["", "0", "1,000", "1,000.5", "1.000,5", "0.0000001", "3,1234567", "-1", "1e3"]) expect(parseUsdcMicro(s), s).toBeNull();
  });

  it("rupiah typed: kept as typed, the mandate is rupiah / rate to the micro-USDC", () => {
    expect(idrBudget(50_000, RATE)).toEqual({ budgetIdr: 50_000, rateIdrPerUsdc: RATE, mandateMicro: 3_030_303 });
    expect(idrBudget(33_000, RATE).mandateMicro).toBe(2_000_000);
    expect(idrBudget(58_000, RATE).mandateMicro).toBe(3_515_152); // rounded, not cut
  });

  it("USDC typed: the mandate is exactly what was typed, the rupiah is rounded to the rupiah", () => {
    expect(usdcBudget(3_500_000, RATE)).toEqual({ budgetIdr: 57_750, rateIdrPerUsdc: RATE, mandateMicro: 3_500_000 });
    expect(usdcBudget(1, RATE).budgetIdr).toBe(0); // 0.0165 rupiah: createOrder refuses it
    expect(usdcBudget(123_456_789_123_456, RATE).budgetIdr).toBe(2_037_037_020_537); // no precision lost on big numbers
    expect(usdcBudget(1_000_000, 16_250.5).budgetIdr).toBe(16_251);
  });

  it("from a form: what was typed in which currency; empty and bad input give a reason", () => {
    expect(budgetFrom("50.000", "IDR", RATE)).toEqual({ ok: true, budget: idrBudget(50_000, RATE) });
    expect(budgetFrom("3.5", "USDC", RATE)).toEqual({ ok: true, budget: usdcBudget(3_500_000, RATE) });
    expect(budgetFrom("", "IDR", RATE)).toEqual({ ok: false, reasons: ["The budget is required (rupiah or USDC)"] });
    expect(budgetFrom("3.5", "IDR", RATE)).toEqual({ ok: false, reasons: ["Type the budget in whole rupiah, like 50.000"] });
    expect(budgetFrom("50.000,5", "USDC", RATE)).toEqual({ ok: false, reasons: ["Budget must be a USDC amount like 32 or 32.5 (max 6 decimals)"] });
  });

  it("from a request body: budgetIdr or budgetUsdc (a string, as before), not both", () => {
    expect(budgetFromBody({ budgetUsdc: "32.5" }, RATE)).toMatchObject({ ok: true, budget: { mandateMicro: 32_500_000, budgetIdr: 536_250 } });
    expect(budgetFromBody({ budgetIdr: "50.000" }, RATE)).toMatchObject({ ok: true, budget: { mandateMicro: 3_030_303, budgetIdr: 50_000 } });
    expect(budgetFromBody({ budgetIdr: 50_000 }, RATE)).toMatchObject({ ok: true, budget: { budgetIdr: 50_000 } });
    expect(budgetFromBody({ budgetIdr: "50000", budgetUsdc: "3" }, RATE)).toEqual({ ok: false, reasons: ["Give the budget in rupiah or in USDC, not both"] });
    expect(budgetFromBody({ budgetUsdc: 32.5 }, RATE).ok).toBe(false);
    expect(budgetFromBody({}, RATE)).toEqual({ ok: false, reasons: ["The budget is required (rupiah or USDC)"] });
  });

  it("the customer's invite flow gets the same fields from the app rate", () => {
    process.env.IDR_PER_USDC = "16000";
    expect(budgetFromRupiah(48_000)).toEqual({ budgetIdr: 48_000, rateIdrPerUsdc: 16_000, mandateMicro: 3_000_000 });
    delete process.env.IDR_PER_USDC;
    expect(budgetFromRupiah(50_000)).toEqual(idrBudget(50_000, 16_500));
  });
});

describe("showing the budget", () => {
  it("in rupiah, USDC (every decimal) and US$ (to the cent)", () => {
    expect(budgetEquals(idrBudget(50_000, RATE))).toBe("Rp50.000 = 3.030303 USDC ≈ US$3.03");
    expect(budgetEquals(usdcBudget(1_234_500_000, RATE))).toBe("Rp20.369.250 = 1234.5 USDC = US$1,234.50");
    expect(looksLikeThousands("1.000")).toBe(true);
    expect(looksLikeThousands("3.5")).toBe(false);
    expect(looksLikeThousands("1000")).toBe(false);
    expect(usdcText(32_000_000)).toBe("32");
    expect(usdText(5_000)).toBe("US$0.01");
    expect(rateText(16_500)).toBe("Rp16.500");
    expect(rateText(16_250.5)).toBe("Rp16.250,5");
  });

  it("order lists: Rp · USDC, test USDC on a testnet, USDC only for orders made before rupiah budgets", () => {
    const o = { mandateMicro: 3_030_303, budgetIdr: 50_000 };
    expect(budgetText(o, en)).toBe("Rp50.000 · 3.030303 USDC");
    expect(budgetText(o, en, true)).toBe("Rp50.000 · 3.030303 test USDC");
    expect(budgetText(o, id, true)).toBe("Rp50.000 · 3.030303 USDC uji");
    expect(budgetText({ mandateMicro: 32_000_000 }, en)).toBe("32 USDC");
  });

  it("every new text has Indonesian", () => {
    for (const s of [
      "Budget", "Currency", "1 USDC = US$1 = {rate} (app rate)", "Type the budget in whole rupiah, like 50.000",
      "The budget is required (rupiah or USDC)", "Give the budget in rupiah or in USDC, not both", "{id} · {units} · budget {budget} · due {due} ·",
      "Sanded", "Primed for paint", "Standard", "Finishing must be Standard, Sanded or Primed for paint", "Material must be PLA or PETG",
      "Budget must be a USDC amount like 32 or 32.5 (max 6 decimals)",
    ]) expect(id(s), s).not.toBe(s);
  });
});

describe("POST /api/orders (the New order form)", () => {
  const post = (body: Record<string, unknown>) => POST(new Request("http://x/api/orders", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ product: "Gantungan kunci", quantity: 10, deadline: "2099-12-31", designVersion: "v1", label: "real", ...body }),
  }));

  it("rupiah typed: stores the rupiah as typed, the app rate and the mandate to the micro-USDC", async () => {
    const res = await post({ budgetIdr: "50.000", material: "PETG" });
    expect(res.status).toBe(201);
    const { order } = await res.json();
    expect(store.getOrder(order.id)).toMatchObject({ budgetIdr: 50_000, rateIdrPerUsdc: 16_500, mandateMicro: 3_030_303, material: "PETG" });
  });

  it("USDC typed: the mandate is exactly the USDC; the rupiah is USDC × the app rate", async () => {
    process.env.IDR_PER_USDC = "16000";
    const { order } = await (await post({ budgetUsdc: "3.5", material: "PLA" })).json();
    expect(store.getOrder(order.id)).toMatchObject({ budgetIdr: 56_000, rateIdrPerUsdc: 16_000, mandateMicro: 3_500_000, material: "PLA" });
  });

  it("refuses a bad budget, both currencies, another material, and colours not loaded in the studio", async () => {
    const reasons = async (body: Record<string, unknown>) => (await (await post(body)).json()).reasons;
    expect(await reasons({ budgetIdr: "50.000,5" })).toEqual(["Type the budget in whole rupiah, like 50.000"]);
    expect(await reasons({ budgetIdr: "1", budgetUsdc: "1" })).toEqual(["Give the budget in rupiah or in USDC, not both"]);
    expect(await reasons({})).toEqual(["The budget is required (rupiah or USDC)"]);
    expect(await reasons({ budgetUsdc: "0.000001" })).toEqual(["Budget in rupiah must be a positive amount"]);
    expect(await reasons({ budgetIdr: "50000", material: "ABS" })).toEqual(["Material must be PLA or PETG"]);
    expect(await reasons({ budgetIdr: "50000", preferredColors: [{ type: "PETG", color: "#0085D5" }] }))
      .toEqual(["PETG Blue (#0085D5) is not loaded in the studio right now"]);
  });

  it("takes colours that are loaded in the studio's AMS right now", async () => {
    const now = new Date().toISOString();
    const tray: AmsTray = { ams: 0, slot: 1, empty: false, type: "PETG", subBrand: null, infoIdx: null, color: "#0085D5", colors: ["#0085D5"], remainPct: null, bambu: false };
    store.savePrinter({ id: "a1-3", name: "A1 Combo #3", lastSeen: now,
      snapshot: { ...emptySnapshot(now), state: "IDLE", ams: { trays: [tray], activeSlot: null, externalActive: false, humidity: null, lite: true } } });
    const res = await post({ budgetIdr: "50000", material: "PETG", preferredColors: [{ type: "PETG", color: "#0085d5" }] });
    expect(res.status).toBe(201);
    expect((await res.json()).order.preferredColors).toEqual([{ type: "PETG", color: "#0085D5", name: "Blue" }]);
  });

  it("still takes an order without a material, as API clients did before", async () => {
    const { order } = await (await post({ budgetUsdc: "32" })).json();
    expect(order).toMatchObject({ mandateMicro: 32_000_000, budgetIdr: 528_000 });
    expect(order).not.toHaveProperty("material");
  });
});

describe("the authority card prices PLA and PETG", () => {
  const priceText = () => chiefAuthority(new Date("2026-10-15T15:00:00+07:00")).decidesAlone.find((d) => d.id === "price_by_weight")!.text;

  it("one price when PETG costs the same (the default), both when it does not; Indonesian either way", () => {
    expect(priceText()).toBe("Price PLA and PETG by weight from the slicer grams a person entered: Rp1.500/g, unit price rounded up to Rp500");
    expect(id(priceText())).toBe("Harga PLA dan PETG per berat dari gram slicer yang diisi orang: Rp1.500/g, harga satuan dibulatkan ke atas ke Rp500");
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "1800";
    expect(priceText()).toBe("Price PLA and PETG by weight from the slicer grams a person entered: PLA Rp1.500/g, PETG Rp1.800/g, unit price rounded up to Rp500");
    expect(tLib(id, priceText())).toBe("Harga PLA dan PETG per berat dari gram slicer yang diisi orang: PLA Rp1.500/g, PETG Rp1.800/g, harga satuan dibulatkan ke atas ke Rp500");
  });
});

describe("quotes in rupiah against a rupiah budget", () => {
  it("a price equal to the budget is never over it: quotes round to the micro-USDC like the mandate", () => {
    for (const idr of [58_000, 50_000, 500_000, 1_200_000, 33_333]) expect(idrToMicro(idr)).toBe(idrBudget(idr, idrPerUsdc()).mandateMicro);
  });
});

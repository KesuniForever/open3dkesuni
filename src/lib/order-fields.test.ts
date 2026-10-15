import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { createOrder } from "./actions";

const base = { product: "Gantungan kunci", quantity: 10, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 2_000_000, label: "real" as const };
beforeEach(() => store.resetDb());

describe("new order fields (budget in rupiah, material, colours)", () => {
  it("are optional: an order without them is as before", () => {
    const r = createOrder(base);
    expect(r.ok && r.order).not.toHaveProperty("material");
    expect(r.ok && r.order).not.toHaveProperty("budgetIdr");
  });

  it("stores the rupiah as typed with its rate, the material and the colours", () => {
    const r = createOrder({ ...base, budgetIdr: 33_000, rateIdrPerUsdc: 16_500, material: "PETG", preferredColors: [{ type: "PETG", color: "#0085d5" }] });
    expect(r.ok).toBe(true);
    expect(store.getOrder(r.ok ? r.order.id : "")).toMatchObject({
      budgetIdr: 33_000, rateIdrPerUsdc: 16_500, mandateMicro: 2_000_000, material: "PETG", preferredColors: [{ type: "PETG", color: "#0085D5", name: "Blue" }],
    });
  });

  it("the rupiah are whole rupiah", () => {
    expect(createOrder({ ...base, budgetIdr: 33_000.5, rateIdrPerUsdc: 16_500 })).toMatchObject({ ok: false, reasons: ["Budget in rupiah must be a positive amount"] });
    expect(createOrder({ ...base, budgetIdr: 0, rateIdrPerUsdc: 16_500 }).ok).toBe(false);
  });

  it("refuses a material other than PLA or PETG, a budget without its rate, and bad colours", () => {
    const r = createOrder({ ...base, budgetIdr: 33_000, material: "ABS", preferredColors: [{ type: "PLA", color: "merah" }] });
    expect(r).toMatchObject({ ok: false, status: 400, reasons: [
      "The rupiah per USDC rate must be a positive number", "Material must be PLA or PETG", "A colour must be written as #RRGGBB",
    ] });
  });
});

import { describe, expect, it } from "vitest";
import { KESUNI_DEFAULTS, calculate, parseCostInput, type CostInput } from "./costing";

// The worked example from the TIMBAL Fabric prototype ("Organizer meja modular", 8 units).
const ORGANIZER: CostInput = {
  quantity: 8, gramsPerUnit: 45, supportWastePct: 12, filamentIdrPerKg: 180_000,
  machineHours: 10, avgWatts: 120, idrPerKwh: 1_700,
  laborHours: 1.5, laborIdrPerHour: 25_000, machineIdrPerHour: 3_500,
  finishingIdr: 16_000, packagingIdr: 12_000, shippingIdr: 18_000, overheadIdr: 15_000,
  reprintRiskPct: 8, unitPriceIdr: 40_000, targetMarginPct: 25, feePct: 5,
};

describe("costing", () => {
  it("matches the TIMBAL worked example to the rupiah", () => {
    const c = calculate(ORGANIZER);
    const line = (k: string) => c.lines.find((l) => l.key === k)!.idr;
    expect(c.filamentGrams).toBe(404);
    expect(c.kwh).toBe(1.2);
    expect(line("material")).toBe(72_576);
    expect(line("power")).toBe(2_040);
    expect(line("labor")).toBe(37_500);
    expect(line("machine")).toBe(35_000);
    expect(line("reserve")).toBe(14_184);
    expect(line("packing")).toBe(30_000);
    expect(c.businessCostIdr).toBe(222_300);
    expect(c.revenueIdr).toBe(320_000);
    expect(c.feeIdr).toBe(16_000);
    expect(c.profitIdr).toBe(81_700);
    expect(c.marginPct).toBe(25.5);
    expect(c.targetUnitPriceIdr).toBe(39_697);
    expect(c.breakEvenUnitPriceIdr).toBe(29_250);
  });

  it("the lines add up to the business cost", () => {
    const c = calculate(ORGANIZER);
    const sum = c.lines.reduce((s, l) => s + l.idr, 0);
    expect(Math.abs(sum - c.businessCostIdr)).toBeLessThanOrEqual(1);
  });

  it("a price below break-even shows a loss", () => {
    const c = calculate({ ...ORGANIZER, unitPriceIdr: 20_000 });
    expect(c.profitIdr).toBeLessThan(0);
  });

  it("parses form values and refuses nonsense", () => {
    const ok = parseCostInput({ quantity: "2", gramsPerUnit: "30", unitPriceIdr: "" });
    expect(ok.ok && ok.input).toMatchObject({ quantity: 2, gramsPerUnit: 30, unitPriceIdr: KESUNI_DEFAULTS.unitPriceIdr });
    const bad = parseCostInput({ quantity: "1.5", gramsPerUnit: "-1", reprintRiskPct: 100 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reasons).toHaveLength(3);
  });
});

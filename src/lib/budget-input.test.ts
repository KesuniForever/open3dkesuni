import { describe, expect, it } from "vitest";
import { parseIdrTyped } from "./budget-input";

describe("the budget as people type it", () => {
  it("reads plain rupiah like the server does", () => {
    expect(parseIdrTyped("150000")).toBe(150_000);
    expect(parseIdrTyped("150.000")).toBe(150_000);
    expect(parseIdrTyped("Rp 150.000")).toBe(150_000);
    expect(parseIdrTyped("Rp150.000,00")).toBe(150_000);
    expect(parseIdrTyped(" 1.500.000 ")).toBe(1_500_000);
  });

  it("reads rb, ribu, k, jt and juta, with a decimal comma or dot", () => {
    expect(parseIdrTyped("150rb")).toBe(150_000);
    expect(parseIdrTyped("150 ribu")).toBe(150_000);
    expect(parseIdrTyped("150K")).toBe(150_000);
    expect(parseIdrTyped("1,5jt")).toBe(1_500_000);
    expect(parseIdrTyped("1.5 juta")).toBe(1_500_000);
    expect(parseIdrTyped("2 Juta")).toBe(2_000_000);
    expect(parseIdrTyped("Rp 2,25 jt")).toBe(2_250_000);
    expect(parseIdrTyped("1.500rb")).toBe(1_500_000);
  });

  it("refuses what is not one clear amount", () => {
    for (const bad of ["", "0", "abc", "1,5", "1.000,000", "-50000", "150 rupiah", "1,5jt2", "rb"]) {
      expect(parseIdrTyped(bad), bad).toBeNull();
    }
  });
});

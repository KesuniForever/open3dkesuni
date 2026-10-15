import { describe, expect, it } from "vitest";
import { printTimeText, rangeText, readyInText } from "./print-time";
import { priceByWeight, type ColorMode } from "./pricing";
import { makeT } from "../i18n/core";
import { ID } from "../i18n/id";

const en = makeT("en", {});
const id = makeT("id", ID);
const both = (min: number, max: number) => [printTimeText({ min, max }, en, "en"), printTimeText({ min, max }, id, "id")];

describe("print time as people read it", () => {
  it("minutes under an hour", () => {
    expect(both(3, 5)).toEqual(["3–5 min", "3–5 mnt"]);
    expect(both(30, 50)).toEqual(["30–50 min", "30–50 mnt"]);
    expect(both(5, 15)).toEqual(["5–15 min", "5–15 mnt"]);
    expect(both(0.3, 0.5)).toEqual(["1 min", "1 mnt"]); // never "0 min"
  });

  it("each end keeps its own unit when they differ, never 0 h", () => {
    expect(both(50, 150)).toEqual(["50 min – 2.5 h", "50 mnt – 2,5 jam"]);
    expect(both(59.6, 61)).toEqual(["1 h", "1 jam"]);
  });

  it("hours with one decimal, in the page's language", () => {
    expect(both(90, 150)).toEqual(["1.5–2.5 h", "1,5–2,5 jam"]);
    expect(both(816, 1360)).toEqual(["13.6–22.7 h", "13,6–22,7 jam"]);
  });

  it("days for very long jobs", () => {
    expect(both(3000, 6000)).toEqual(["2.1–4.2 days", "2,1–4,2 hari"]);
    expect(both(1360, 4080)).toEqual(["22.7 h – 2.8 days", "22,7 jam – 2,8 hari"]);
  });

  it("ready in: hours, with days for long jobs", () => {
    expect([readyInText(2, en, "en"), readyInText(2, id, "id")]).toEqual(["± 2 hours", "± 2 jam"]);
    expect(readyInText(1, en, "en")).toBe("± 1 hour");
    expect([readyInText(76, en, "en"), readyInText(76, id, "id")]).toEqual(["± 76 hours · about 3.2 days", "± 76 jam · sekitar 3,2 hari"]);
  });

  it("minutes per gram", () => {
    expect(rangeText({ min: 3, max: 5 }, "en")).toBe("3–5");
    expect(rangeText({ min: 3.5, max: 4.5 }, "id")).toBe("3,5–4,5");
    expect(rangeText({ min: 4, max: 4 }, "en")).toBe("4");
  });

  it("QA's case on the calculator: 1 g and 10 g, single and multi colour", () => {
    const show = (g: number, mode: ColorMode) => {
      const r = priceByWeight(g, 1, mode);
      if (!r.ok) throw new Error(r.reasons.join());
      return `${printTimeText(r.price.printMinutes, en, "en")} · ${readyInText(r.price.etaHours, en, "en")}`;
    };
    expect(show(1, "single")).toBe("3–5 min · ± 2 hours");
    expect(show(10, "single")).toBe("30–50 min · ± 2 hours");
    expect(show(1, "multi")).toBe("5–15 min · ± 2 hours");
    expect(show(10, "multi")).toBe("50 min – 2.5 h · ± 4 hours");
  });
});

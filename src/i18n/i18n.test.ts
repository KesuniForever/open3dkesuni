import { describe, expect, it } from "vitest";
import { makeT, toLocale } from "./core";
import { ID } from "./id";

describe("i18n", () => {
  it("is English unless the cookie says id", () => {
    expect(toLocale(undefined)).toBe("en");
    expect(toLocale("")).toBe("en");
    expect(toLocale("fr")).toBe("en");
    expect(toLocale("id")).toBe("id");
  });

  it("translates, falls back to English, and fills placeholders", () => {
    const dict = { "Printers online": "Printer online", "{n} printers": "{n} printer" };
    const en = makeT("en", dict);
    const id = makeT("id", dict);
    expect(en("Printers online")).toBe("Printers online");
    expect(id("Printers online")).toBe("Printer online");
    expect(id("Not in the dictionary")).toBe("Not in the dictionary");
    expect(id("{n} printers", { n: 3 })).toBe("3 printer");
    expect(en("{n} printers", { n: 3 })).toBe("3 printers");
  });

  it("every Indonesian entry is filled and keeps the same placeholders as its English key", () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [en, id] of Object.entries(ID)) {
      expect(id.trim(), en).not.toBe("");
      expect(holes(id), en).toBe(holes(en));
      expect(en, "key has no stray spaces").toBe(en.trim());
    }
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ColorPicker, { ChoiceSummary, keepOffered, swatchesFor, type Choice, type StudioColor } from "./ColorPicker";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/core";

// The studio on 15 Oct 2026 as GET /api/studio/colors gives it (two near-identical reds on printer #1).
const PALETTE: StudioColor[] = [
  { type: "PETG", color: "#000000", name: "Black", checked: false },
  { type: "PETG", color: "#0085D5", name: "Blue", checked: false },
  { type: "PETG", color: "#FFFFFF", name: "White", checked: false },
  { type: "PLA", color: "#000000", name: "Black", checked: false },
  { type: "PLA", color: "#3F8E43", name: "Green", checked: true },
  { type: "PLA", color: "#C52C18", name: "Red", checked: false },
  { type: "PLA", color: "#C12E1F", name: "Red", checked: true },
  { type: "PLA", color: "#FEC600", name: "Yellow", checked: true },
];
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const render = (value: Choice, locale: Locale = "en", palette: StudioColor[] | null = PALETTE) => renderToStaticMarkup(
  <LocaleProvider locale={locale}><ColorPicker value={value} onChange={() => {}} palette={palette} /></LocaleProvider>,
);

describe("customer colour picker", () => {
  it("shows two spools of nearly the same colour as one swatch, the checked one", () => {
    const s = swatchesFor(PALETTE);
    expect(s.filter((c) => c.type === "PLA" && c.name === "Red")).toEqual([{ type: "PLA", color: "#C12E1F", name: "Red", checked: true }]);
    expect(s.filter((c) => c.name === "Black").map((c) => c.type)).toEqual(["PETG", "PLA"]); // same colour, other material
    expect(s).toHaveLength(7);
  });

  it("drops chosen colours that are no longer offered (spools changed), so a save cannot fail on them", () => {
    const choice: Choice = { material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "PLA", color: "#123456", name: "Blue" }] };
    expect(keepOffered(choice, swatchesFor(PALETTE))).toEqual({ material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    const fine: Choice = { material: "PETG", colors: [] };
    expect(keepOffered(fine, PALETTE)).toBe(fine);
  });

  it("groups the swatches by material with translated names, the choice pressed, the other material dimmed", () => {
    const html = render({ material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    expect(text(html)).toMatch(/Material.*PLA PETG.*Colours.*Single colour Multi colour.*Available colours.*PLA Black Green Red Yellow PETG Black Blue White/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*?Yellow/);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toContain('class="cc-group other" role="group" aria-label="PETG"');
    expect(html).not.toContain("3MF"); // single colour: no multi-colour note
    const id = text(render({ material: "PLA", colors: [] }, "id"));
    expect(id).toMatch(/Bahan.*Warna.*Satu warna Multi warna.*Warna yang tersedia.*PLA Hitam Hijau Merah Kuning PETG Hitam Biru Putih/);
  });

  it("multi colour: counts the colours and says Kesuni helps on WhatsApp; the 3MF stays behind the ⓘ", () => {
    const two: Choice = { material: "PLA", colors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "PLA", color: "#3F8E43", name: "Green" }] };
    const html = render(two);
    expect(text(html)).toMatch(/Colours · 2 of 4.*More than one colour\? Kesuni will help you set the colours on WhatsApp\./);
    expect(html).toMatch(/<span class="info-pop" role="tooltip">An STL file has no colours\./);
    expect(text(render(two, "id"))).toMatch(/Warna · 2 dari 4.*Lebih dari satu warna\? Kesuni akan bantu atur warnanya lewat WhatsApp\./);
  });

  it("says so while loading and when nothing is loaded in the studio", () => {
    expect(text(render({ material: null, colors: [] }, "en", null))).toContain("Loading colours…");
    expect(text(render({ material: null, colors: [] }, "id", []))).toContain("Belum ada warna yang bisa ditampilkan. Tulis warna yang Anda inginkan di catatan.");
  });

  it("no printer reporting now: the colours are the ones Kesuni usually has, not \"loaded now\"", () => {
    const html = (locale: Locale) => renderToStaticMarkup(
      <LocaleProvider locale={locale}><ColorPicker value={{ material: null, colors: [] }} onChange={() => {}} palette={PALETTE} live={false} /></LocaleProvider>,
    );
    expect(text(html("en"))).toContain("Colours Kesuni usually has");
    expect(text(html("en"))).not.toMatch(/Available colours|loaded in Kesuni's printers right now/);
    expect(text(html("id"))).toContain("Warna yang biasanya ada di Kesuni");
    expect(text(render({ material: null, colors: [] }))).toContain("Available colours");
  });

  it("the order page summary: material, colour names, or not chosen yet", () => {
    const sum = (c: Choice, locale: Locale = "en") => text(renderToStaticMarkup(<LocaleProvider locale={locale}><ChoiceSummary choice={c} /></LocaleProvider>));
    expect(sum({ material: "PETG", colors: [{ type: "PETG", color: "#0085D5", name: "Blue" }] }, "id")).toMatch(/PETG Biru/);
    expect(sum({ material: "PLA", colors: [] })).toMatch(/PLA Any colour/);
    expect(sum({ material: null, colors: [] }, "id")).toMatch(/Belum dipilih/);
  });
});

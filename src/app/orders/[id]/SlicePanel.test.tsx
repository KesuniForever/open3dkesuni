import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { LocaleProvider } from "@/i18n/client";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import type { Attachment, Order, Printer, SliceJob } from "@/lib/types";
import SlicePanel, { type SliceData } from "./SlicePanel";

// Step 2 · Slice, as the server renders it first. Printers: #1 with yellow PLA (slot 1) and white PETG (slot 3); #2
// with no AMS report. The customer chose white PETG.
const AT = new Date().toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const tray = (slot: number, type: string | null, color: string | null): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu: false,
});
const snap = (trays: AmsTray[]): PrinterSnapshot => ({
  ...emptySnapshot(AT), state: "IDLE", sdcard: true, nozzle: { diameter: "0.4", type: "stainless_steel" },
  ams: { trays, activeSlot: null, externalActive: false, humidity: null, lite: true },
});
const printers: Printer[] = [
  { id: "a1", name: "A1 Combo #1", lastSeen: AT, snapshot: snap([tray(0, "PLA", "#FEC600"), tray(1, null, null), tray(2, "PETG", "#FFFFFF"), tray(3, null, null)]) },
  { id: "a1-2", name: "A1 Combo #2", lastSeen: AT, snapshot: { ...emptySnapshot(AT), state: "IDLE" } },
];
const stl: Attachment = { id: "F-stl", orderId: "ORD-9", kind: "design", filename: "Clip.stl", size: 684, mime: "model/stl", uploadedBy: "Aini", at: AT, storageKey: "k" };
const order: Order = {
  id: "ORD-9", jobId: "J", product: "Clip", quantity: 3, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 10_000_000, status: "PLAN_CHOSEN",
  label: "simulated", material: "PETG", preferredColors: [{ type: "PETG", color: "#FFFFFF", name: "White" }],
};
const job = (over: Partial<SliceJob>): SliceJob => ({
  id: "SJ-1", orderId: "ORD-9", attachmentId: "F-stl", sourceName: "Clip.stl", mode: "mesh", printerId: "a1", tray: 2, material: "PETG", color: "#FFFFFF",
  quality: "standard", infillPct: 20, supports: "auto", key: "k", state: "queued", actor: "person", by: "Khelda", createdAt: AT, updatedAt: AT, ...over,
});
const data = (jobs: SliceJob[], ready = true): SliceData => ({ jobs, slicer: { seenAt: AT, ready }, reload: () => {} });
const render = (jobs: SliceJob[], locale: Locale = "en", ready = true, o: Order = order) => renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <SlicePanel order={o} attachments={[stl]} printers={printers} data={data(jobs, ready)} t={makeT(locale, ID)} locale={locale} />
  </LocaleProvider>,
);
const slicePanel = (jobs: SliceJob[], locale: Locale = "en", ready = true, o: Order = order) => text(render(jobs, locale, ready, o));

describe("order page: step 2 · Slice", () => {
  it("what the customer wants, then printer and the customer's spool, the settings folded, and the Slice button", () => {
    const html = render([]);
    const en = text(html);
    expect(en).toMatch(/^ Customer wants 3 units · PETG Customer's colours PETG White #1 slot 3 /);
    expect(en).toMatch(/Printer #1 Spool Slot 1 · PLA Yellow Slot 3 · PETG White · customer's colour ✓ Settings: Standard 0\.20 mm · infill 20% · supports auto/);
    expect(html).toMatch(/<details class="fold sp-settings"><summary>Settings: Standard 0\.20 mm · infill 20% · supports auto<\/summary>.*Quality.*Infill %.*Supports.*One colour: an STL carries no colours\.<\/p><\/details>/);
    expect(en).toMatch(/Slice Studio PC ready/);
    // #2 reports no spools: not offered. The customer's white PETG is preselected and carries the mark.
    expect(html).not.toMatch(/<option value="a1-2"/);
    expect(html).toMatch(/<option value="2" selected="">Slot 3 · PETG White · customer&#x27;s colour ✓<\/option>/);
    expect(html).toMatch(/<input type="number" min="0" max="100" step="1" inputMode="numeric" value="20"/);
    expect(html).toMatch(/<button class="primary">Slice<\/button>/);
    expect(en).not.toMatch(/not one of the customer's colours/);
  });

  it("a spool that is not one of the customer's colours says so; the spec colour shows", () => {
    const red = { ...order, preferredColors: [{ type: "PLA" as const, color: "#C52C18", name: "Red" }], spec: { color: "Merah" } as Order["spec"] };
    const en = slicePanel([], "en", true, red);
    expect(en).toMatch(/PLA Red not loaded now Spec colour: Merah/);
    expect(en).toMatch(/This spool is not one of the customer's colours\./);
  });

  it("the slices: the newest one, with time and grams only; a weighing is for the price only; older ones folded", () => {
    const en = slicePanel([
      job({ id: "SJ-3", state: "done", resultAttachmentId: "F-out", result: { predictionSec: 1710, weightG: 3.69, priceIdr: 6000, sliceMs: 650 } }),
      job({ id: "SJ-2", state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" }),
      job({ id: "SJ-1", state: "done", actor: "system", result: { predictionSec: 1500, weightG: 3.5, priceIdr: 5000 } }),
    ], "en", false);
    expect(en).toMatch(/Clip\.stl PETG White · Standard 0\.20 mm · 20% · #1 Slot 3 Sliced 29 min · 3\.69 g Older slices \(2\)/);
    expect(en).not.toMatch(/Rp|Print it/);
    expect(en).toMatch(/Failed The model does not fit on the A1 bed \(256 x 256 x 256 mm\) or is empty/);
    expect(en).toMatch(/For the price only Sliced 25 min · 3\.5 g/);
    expect(slicePanel([job({ state: "queued", actor: "agent" })])).toMatch(/#1 Slot 3 · by the agent Waiting for the studio PC Cancel/);
  });

  it("the studio PC is off: one line says what to do, and the button stays on (a slice waits 15 min)", () => {
    const html = render([], "en", false);
    expect(text(html)).toMatch(/Slice The slicing PC is off\. Turn on the studio PC \(Bambu Studio and the Kesuni bridge\) or tell the owner\. A slice waits up to 15 min\./);
    // The dot's own label would say the same thing a second time.
    expect(text(html)).not.toMatch(/Studio PC not seen/);
    expect(html).toMatch(/<button class="primary">Slice<\/button>/);
    expect(text(render([]))).not.toMatch(/slicing PC is off/);
  });

  it("in Indonesian", () => {
    const idText = slicePanel([job({ state: "done", actor: "system", result: { predictionSec: 1710, weightG: 3.69, priceIdr: 6000 } }), job({ id: "SJ-2", state: "slicing" })], "id", false);
    expect(idText).toMatch(/Keinginan pelanggan 3 unit · PETG Warna pilihan pelanggan PETG Putih/);
    expect(idText).toMatch(/Spool Slot 1 · PLA Kuning Slot 3 · PETG Putih · warna pelanggan ✓ Pengaturan: Standar 0,20 mm/);
    expect(idText).toMatch(/Satu warna: STL tidak membawa warna\. Slice PC untuk slice sedang mati\./);
    expect(idText).toMatch(/Hanya untuk harga Sudah di-slice 29 mnt · 3,69 g/);
    // One wording for slicing, as in the Now line ("Sedang di-slice di PC studio…").
    expect(idText).toMatch(/Sedang di-slice… Batal/);
  });

  it("a STEP file only: what the customer wants, then one line saying how to slice it", () => {
    const step = { ...stl, id: "F-step", filename: "Bracket.step" };
    const en = text(renderToStaticMarkup(
      <LocaleProvider locale="en">
        <SlicePanel order={order} attachments={[step]} printers={printers} data={data([])} t={makeT("en", ID)} locale="en" />
      </LocaleProvider>,
    ));
    expect(en.trim()).toBe("Customer wants 3 units · PETG Customer's colours PETG White #1 slot 3 STEP files cannot be sliced here: export an STL from the CAD program");
  });

  it("only a sliced file (nothing to slice here): the customer's colours still show", () => {
    const gcode: Attachment = { ...stl, id: "F-g", filename: "Clip.gcode.3mf", mime: "model/3mf", parsed3mf: { sliced: true, plates: [] } };
    const en = text(renderToStaticMarkup(
      <LocaleProvider locale="en">
        <SlicePanel order={order} attachments={[gcode]} printers={printers} data={data([])} t={makeT("en", ID)} locale="en" />
      </LocaleProvider>,
    ));
    expect(en.trim()).toBe("Customer wants 3 units · PETG Customer's colours PETG White #1 slot 3");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { LocaleProvider } from "@/i18n/client";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import type { Attachment, Order, Printer, SliceJob } from "@/lib/types";
import PrintPanel from "./PrintPanel";
import SlicePanel, { type SliceData } from "./SlicePanel";

// "Slice here" in Colours & print, as the server renders it first. Printers: #1 with yellow PLA (slot 1) and white
// PETG (slot 3); #2 with no AMS report.
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
  id: "ORD-9", jobId: "J", product: "Clip", quantity: 1, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 10_000_000, status: "PLAN_CHOSEN",
  label: "simulated", preferredColors: [{ type: "PETG", color: "#FFFFFF", name: "White" }],
};
const job = (over: Partial<SliceJob>): SliceJob => ({
  id: "SJ-1", orderId: "ORD-9", attachmentId: "F-stl", sourceName: "Clip.stl", mode: "mesh", printerId: "a1", tray: 2, material: "PETG", color: "#FFFFFF",
  quality: "standard", infillPct: 20, supports: "auto", key: "k", state: "queued", actor: "person", by: "Khelda", createdAt: AT, updatedAt: AT, ...over,
});
const data = (jobs: SliceJob[], ready = true): SliceData => ({ jobs, slicer: { seenAt: AT, ready }, reload: () => {} });
const slicePanel = (jobs: SliceJob[], locale: Locale = "en", ready = true) => text(renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <SlicePanel order={order} attachments={[stl]} printers={printers} data={data(jobs, ready)} onPrint={() => {}} t={makeT(locale, ID)} locale={locale} />
  </LocaleProvider>,
));

describe("order page: Slice here", () => {
  it("an STL: printer, the customer's spool, quality, infill, supports, one colour, and the Slice button", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="en">
        <PrintPanel order={order} attachments={[stl]} printers={printers} paid={false} issueTexts={{}} busy={false} act={async () => {}} onChange={() => {}} />
      </LocaleProvider>,
    );
    const en = text(html);
    expect(en).toMatch(/Slice here .* Printer #1 Spool Slot 1 · PLA Yellow Slot 3 · PETG White Quality Standard 0\.20 mm Fine 0\.16 mm Draft 0\.24 mm Infill % Supports Auto Off/);
    expect(en).toMatch(/One colour: an STL carries no colours\. Slice Studio PC not seen/);
    expect(en).toMatch(/No sliced file yet\. Slice it above, or upload a \.gcode\.3mf from Bambu Studio under Files\./);
    // #2 reports no spools: not offered. The customer's white PETG is preselected.
    expect(html).not.toMatch(/<option value="a1-2"/);
    expect(html).toMatch(/<option value="2" selected="">Slot 3 · PETG White<\/option>/);
    expect(html).toMatch(/<input type="number" min="0" max="100" step="1" inputMode="numeric" value="20"/);
    expect(html).toMatch(/<button class="primary">Slice<\/button>/);
  });

  it("the slices: waiting, then the result with time, grams and the price, or the reason it failed", () => {
    const en = slicePanel([
      job({ id: "SJ-3", state: "done", resultAttachmentId: "F-out", result: { predictionSec: 1710, weightG: 3.69, priceIdr: 6000, sliceMs: 650 } }),
      job({ id: "SJ-2", state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" }),
      job({ id: "SJ-1", state: "queued" }),
    ], "en", false);
    expect(en).toMatch(/Clip\.stl PETG White · Standard 0\.20 mm · 20% · #1 Slot 3 Sliced 29 min 3\.69 g Rp6\.000 Print it/);
    expect(en).toMatch(/Failed The model does not fit on the A1 bed \(256 x 256 x 256 mm\) or is empty/);
    expect(en).toMatch(/Waiting for the studio PC Cancel/);
    expect(en).toMatch(/The studio PC has not asked for slices in the last 2 min: is the bridge running with Bambu Studio\?/);
  });

  it("in Indonesian", () => {
    const idText = slicePanel([job({ state: "done", result: { predictionSec: 1710, weightG: 3.69, priceIdr: 6000 } }), job({ id: "SJ-2", state: "slicing" })], "id");
    expect(idText).toMatch(/Slice di sini/);
    expect(idText).toMatch(/Spool Slot 1 · PLA Kuning Slot 3 · PETG Putih Kualitas Standar 0,20 mm/);
    expect(idText).toMatch(/Satu warna: STL tidak membawa warna\. Slice PC studio siap/);
    expect(idText).toMatch(/Sudah di-slice 29 mnt 3,69 g Rp6\.000 Cetak/);
    expect(idText).toMatch(/Sedang slicing… Batal/);
  });

  it("a STEP file only: one line saying how to slice it", () => {
    const step = { ...stl, id: "F-step", filename: "Bracket.step" };
    const en = text(renderToStaticMarkup(
      <LocaleProvider locale="en">
        <SlicePanel order={order} attachments={[step]} printers={printers} data={data([])} onPrint={() => {}} t={makeT("en", ID)} locale="en" />
      </LocaleProvider>,
    ));
    expect(en.trim()).toBe("STEP files cannot be sliced here: export an STL from the CAD program");
  });
});

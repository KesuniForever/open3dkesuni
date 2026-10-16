import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, hmsUrl, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/core";
import type { Attachment, Order, Printer, ThreeMfInfo } from "@/lib/types";
import PrintPanel from "./PrintPanel";
import PrinterPanel from "./PrinterPanel";

// The order page as the server renders it first. Printers are the studio's three A1s on 15 Oct 2026 (read-only probe);
// the sliced file is Kesuni's own Benchy (one yellow PLA, 27 min, 9.82 g), read with parse3mf.
const AT = new Date().toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/\s+/g, " ");
const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
});
const snap = (trays: AmsTray[], over: Partial<PrinterSnapshot> = {}): PrinterSnapshot => ({
  ...emptySnapshot(AT), state: "IDLE", sdcard: true, nozzle: { diameter: "0.4", type: "stainless_steel" },
  ams: { trays, activeSlot: null, externalActive: false, humidity: null, lite: true }, ...over,
});
const printers: Printer[] = [
  { id: "a1", name: "A1 Combo #1", lastSeen: AT, snapshot: snap([tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PLA", "#C12E1F", true)]) },
  { id: "a1-2", name: "A1 Combo #2", lastSeen: AT, snapshot: snap([tray(0, "PLA", "#000000"), tray(1, "PETG", "#000000"), tray(2, "PLA", "#3F8E43", true), tray(3, "PLA", "#000000")]) },
  { id: "a1-3", name: "A1 Combo #3", lastSeen: AT, snapshot: snap([tray(0, "PLA", "#000000"), tray(1, "PETG", "#0085D5"), tray(2, "PLA", "#FF6910"), tray(3, "PETG", "#FFFFFF")],
    { hms: [{ code: "HMS_0510_0400_0001_0044", severity: 1, url: hmsUrl("0510040000010044"), since: AT }] }) },
];
const benchy: ThreeMfInfo = {
  sliced: true, printerModel: "Bambu Lab A1", printerModelId: "N2S", nozzle: "0.4", projectFilaments: [{ type: "PLA", color: "#FCE300" }],
  plates: [{ index: 1, predictionSec: 1644, weightG: 9.82, bedType: "textured_plate", nozzle: "0.4", objects: 1,
    filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82, usedM: 3.24, infoIdx: "GFA00" }] }],
};
const file = (filename: string, parsed3mf?: ThreeMfInfo): Attachment => ({
  id: `A-${filename}`, orderId: "ORD-9", kind: "design", filename, size: 655_609, mime: "model/3mf", uploadedBy: "Khelda", at: AT, storageKey: "k", parsed3mf,
});
const order = (over: Partial<Order> = {}): Order => ({
  id: "ORD-9", jobId: "J", product: "Benchy", quantity: 1, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 10_000_000,
  status: "CREATED", label: "simulated", ...over,
});
const panel = (o: Order, attachments: Attachment[], locale: Locale = "en") => text(renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <PrintPanel order={o} attachments={attachments} printers={printers} paid={false} issueTexts={{}} busy={false} act={async () => {}} onChange={() => {}} />
  </LocaleProvider>,
));

describe("order page: Colours & print", () => {
  it("a sliced file: the slicer's time and grams, which printer can print it, and the person's checks", () => {
    const en = panel(order(), [file("kesuni-benchy.gcode.3mf", benchy)]);
    expect(en).toMatch(/Print time \(slicer\) 27 min Weight 9\.82 g Plate type Textured PEI plate Nozzle 0\.4 mm/);
    expect(en).toMatch(/PLA Yellow 9\.82 g/);
    expect(en).toMatch(/9\.82 g per unit · Single colour Use as Kesuni quote Only give the grams to the Chief/);
    // #1 has yellow PLA: ready. #2 has no yellow: no slot. #3 has a fatal fault.
    expect(en).toMatch(/A1 Combo #1 ready Colours match/);
    expect(en).toMatch(/A1 Combo #2 blocked Filament 1 \(PLA\) has no AMS slot/);
    expect(en).toMatch(/A1 Combo #3 blocked Printer error HMS_0510_0400_0001_0044: fix it before printing/);
    expect(en).toMatch(/PLA Yellow Filament 1 · 9\.82 g → No slot Slot 1 · PLA Yellow Slot 3 · PLA Red · other colour/);
    expect(en).toMatch(/The bed is empty and clean, with the Textured PEI plate I am at the printer Start print/);
    const html = renderToStaticMarkup(
      <PrintPanel order={order()} attachments={[file("kesuni-benchy.gcode.3mf", benchy)]} printers={printers} paid={false} issueTexts={{}} busy={false} act={async () => {}} onChange={() => {}} />,
    );
    expect(html).toMatch(/<option value="0" selected="">Slot 1 · PLA Yellow<\/option>/); // the suggested AMS slot
    expect(html).toMatch(/<button class="primary" disabled="">Start print<\/button>/); // nothing ticked yet
  });

  it("no price buttons once a plan is chosen; an unsliced 3MF says how to export the sliced file", () => {
    expect(panel(order({ status: "IN_PRODUCTION" }), [file("kesuni-benchy.gcode.3mf", benchy)])).not.toMatch(/Use as Kesuni quote/);
    expect(panel(order(), [file("project.3mf", { sliced: false, plates: [] })])).toMatch(/Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file/);
    expect(panel(order(), [file("old.3mf")])).toMatch(/uploaded before 3MF files were read/);
  });

  it("an STL order: the customer's colours and the printers that have them loaded", () => {
    const en = panel(order({ preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "PETG", color: "#C2185B" }] }),
      [{ ...file("part.stl"), mime: "model/stl" }]);
    expect(en).toMatch(/Customer's colours PLA Yellow #1 slot 1 PETG Magenta not loaded now/);
    expect(en).toMatch(/No sliced file yet\./);
  });

  it("in Indonesian", () => {
    const idText = panel(order(), [file("kesuni-benchy.gcode.3mf", benchy)], "id");
    expect(idText).toMatch(/Warna & cetak/);
    expect(idText).toMatch(/Waktu cetak \(slicer\) 27 mnt Berat 9,82 g Jenis plate plate Textured PEI/);
    expect(idText).toMatch(/A1 Combo #2 tertahan Filamen 1 \(PLA\) belum punya slot AMS/);
    expect(idText).toMatch(/Bed cetak kosong dan bersih, dengan plate Textured PEI Saya ada di dekat printer Mulai cetak/);
  });
});

describe("order page: printers panel", () => {
  it("links a printer with “Assign printer”: it never says it prints", () => {
    const html = text(renderToStaticMarkup(
      <LocaleProvider locale="en">
        <PrinterPanel order={order({ status: "PLAN_CHOSEN" })} printers={printers} tasks={[]} busy={false} act={async () => {}} onChange={() => {}} />
      </LocaleProvider>,
    ));
    expect(html).toMatch(/Assign printer/);
    expect(html).not.toMatch(/Print here/);
    expect(html).toMatch(/HMS_0510_0400_0001_0044/);
  });
});

describe("order page: the Agent line", () => {
  const withAgent = (autoPrint: Parameters<typeof PrintPanel>[0]["autoPrint"], locale: Locale = "en") => text(renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <PrintPanel order={order({ status: "PLAN_CHOSEN", label: "real" })} attachments={[file("kesuni-benchy.gcode.3mf", benchy)]} printers={printers}
        paid issueTexts={{}} autoPrint={autoPrint} busy={false} act={async () => {}} onChange={() => {}} />
    </LocaleProvider>,
  ));
  const line = {
    orderId: "ORD-9", why: { key: "Waiting for a person to confirm the bed on {printer}", vars: { printer: "A1 Combo #1" } }, action: "wait" as const,
    printerId: "a1", runsDone: 0, runsNeeded: 1, runsActive: 0,
  };

  it("on or off, the runs and why the agent waits, in one short line", () => {
    expect(withAgent({ on: true, line, runsSet: false })).toMatch(/Agent On Runs 0 of 1 Edit .* Waiting for a person to confirm the bed on A1 Combo #1/);
    expect(withAgent({ on: false, line: { ...line, why: { key: "Agent prints are off: a person starts it" } }, runsSet: false })).toMatch(/Agent Off Runs 0 of 1/);
    expect(withAgent({ on: true, line, runsSet: false }, "id")).toMatch(/Agen Menyala Cetakan 0 dari 1 Ubah .* Menunggu orang memastikan bed A1 Combo #1 kosong/);
    // The (i) no longer says the Chief can never start a print: it says who can.
    expect(withAgent(null)).toMatch(/The Chief \(Claude\) never starts a print; with agent prints on, code does/);
  });
});

describe("order page: Done (debug) under Print jobs", () => {
  const html = (o: Order, locale: Locale = "en") => renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <PrintPanel order={o} attachments={[file("kesuni-benchy.gcode.3mf", benchy)]} printers={printers} paid={false} issueTexts={{}} busy={false} act={async () => {}} onChange={() => {}} />
    </LocaleProvider>,
  );
  const mark = { by: "Khelda", at: "2026-10-16T07:05:00.000Z" };

  it("a small secondary button on a test order in production; never on a real order or outside production", () => {
    for (const status of ["PLAN_CHOSEN", "IN_PRODUCTION"] as const) {
      const h = html(order({ status }));
      expect(text(h)).toMatch(/Print jobs Done \(debug\)/);
      expect(h).toMatch(/<button class="pp-debug-btn">Done \(debug\)<\/button>/);
    }
    expect(text(html(order({ status: "PLAN_CHOSEN", label: "real" })))).not.toMatch(/Done \(debug\)|Print jobs/);
    for (const status of ["CREATED", "EVIDENCE_SUBMITTED", "ACCEPTED"] as const) expect(text(html(order({ status }))), status).not.toMatch(/Done \(debug\)/);
  });

  it("once marked: one line with a test badge instead of the button", () => {
    const h = html(order({ status: "IN_PRODUCTION", printDoneDebug: mark }));
    expect(h).toMatch(/<span class="badge simulated">test<\/span>/);
    expect(text(h)).toMatch(/Print jobs test Marked done for testing by Khelda · 16 Oct(,| at) 14:05/);
    expect(text(h)).not.toMatch(/Done \(debug\)/);
    // Still shown after QC moved the order on.
    expect(text(html(order({ status: "EVIDENCE_SUBMITTED", printDoneDebug: mark })))).toMatch(/Marked done for testing by Khelda/);
  });

  it("in Indonesian", () => {
    expect(text(html(order({ status: "PLAN_CHOSEN" }), "id"))).toMatch(/Job cetak Selesai \(debug\)/);
    expect(text(html(order({ status: "IN_PRODUCTION", printDoneDebug: mark }), "id"))).toMatch(/Job cetak uji Ditandai selesai untuk uji oleh Khelda · 16 Okt/);
  });
});

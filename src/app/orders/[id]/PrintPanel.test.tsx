import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, hmsUrl, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { SLICER_NAME } from "@/lib/slice-rules";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/core";
import type { Attachment, Order, OrderStatus, Printer, SliceJob, ThreeMfInfo } from "@/lib/types";
import PrintPanel from "./PrintPanel";
import PrinterPanel from "./PrinterPanel";
import type { SliceData } from "./SlicePanel";

// Step 4 · Print as the server renders it first. Printers are the studio's three A1s on 15 Oct 2026 (read-only probe);
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
const file = (filename: string, parsed3mf?: ThreeMfInfo, over: Partial<Attachment> = {}): Attachment => ({
  id: `A-${filename}`, orderId: "ORD-9", kind: "design", filename, size: 655_609, mime: "model/3mf", uploadedBy: "Khelda", at: AT, storageKey: "k", parsed3mf, ...over,
});
const order = (over: Partial<Order> = {}): Order => ({
  id: "ORD-9", jobId: "J", product: "Benchy", quantity: 1, deadline: "2099-12-31", designVersion: "v1", mandateMicro: 10_000_000,
  status: "CREATED", label: "simulated", ...over,
});
const noSlices: SliceData = { jobs: [], slicer: null, reload() {} };
const render = (o: Order, attachments: Attachment[], locale: Locale = "en", slices: SliceData = noSlices) => renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <PrintPanel order={o} attachments={attachments} printers={printers} paid={false} issueTexts={{}} slices={slices} busy={false} act={async () => {}} onChange={() => {}} />
  </LocaleProvider>,
);
const panel = (o: Order, attachments: Attachment[], locale: Locale = "en", slices: SliceData = noSlices) => text(render(o, attachments, locale, slices));
const STATUSES: OrderStatus[] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION", "EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"];

describe("order page: step 4 · Print", () => {
  it("a sliced file: the slicer's time and grams, which printer can print it, and the person's checks", () => {
    const en = panel(order(), [file("kesuni-benchy.gcode.3mf", benchy)]);
    expect(en).toMatch(/Ready-to-print file: kesuni-benchy\.gcode\.3mf · /);
    expect(en).toMatch(/Print time \(slicer\) 27 min Weight 9\.82 g Plate type Textured PEI plate Nozzle 0\.4 mm/);
    expect(en).toMatch(/PLA Yellow 9\.82 g/);
    // #1 has yellow PLA: ready. #2 has no yellow: no slot. #3 has a fatal fault.
    expect(en).toMatch(/A1 Combo #1 ready Colours match/);
    expect(en).toMatch(/A1 Combo #2 can't print Filament 1 \(PLA\) has no AMS slot/);
    expect(en).toMatch(/A1 Combo #3 can't print Printer error HMS_0510_0400_0001_0044: fix it before printing/);
    expect(en).toMatch(/PLA Yellow Filament 1 · 9\.82 g → No slot Slot 1 · PLA Yellow Slot 3 · PLA Red · other colour/);
    // The price is not agreed yet: a warning that only asks for one more tick, in "Before you start".
    expect(en).toMatch(/The customer has not agreed to the price yet\. Print now only if the owner says so\. Before you start The bed is empty and clean, with the Textured PEI plate I am at the printer I checked the warnings above Start print Tick the boxes above first\./);
    const html = render(order(), [file("kesuni-benchy.gcode.3mf", benchy)]);
    expect(html).toMatch(/<option value="0" selected="">Slot 1 · PLA Yellow<\/option>/); // the suggested AMS slot
    expect(html).toMatch(/<button class="primary" disabled="">Start print<\/button>/); // nothing ticked yet
  });

  it("no ticks for warnings when there are none; a blocked printer says why under the button", () => {
    const en = panel(order({ status: "PLAN_CHOSEN" }), [file("kesuni-benchy.gcode.3mf", benchy)]);
    expect(en).toMatch(/Before you start The bed is empty and clean, with the Textured PEI plate I am at the printer Start print Tick the boxes above first\./);
    expect(en).not.toMatch(/I checked the warnings above/);
  });

  it("no price row in any status; an unsliced 3MF says how to export the sliced file", () => {
    for (const status of STATUSES) {
      expect(panel(order({ status }), [file("kesuni-benchy.gcode.3mf", benchy)]), status).not.toMatch(/Units on this plate|Use as Kesuni quote|Only give the grams/);
    }
    expect(panel(order(), [file("project.3mf", { sliced: false, plates: [] })])).toMatch(/Not a sliced file: in Bambu Studio use File > Export > Export plate sliced file/);
    expect(panel(order(), [file("old.3mf")])).toMatch(/uploaded before 3MF files were read/);
  });

  it("an STL order: no ready-to-print file yet, and the way to step 2; the customer's colours are in step 2 now", () => {
    const en = panel(order({ preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] }), [{ ...file("part.stl"), mime: "model/stl" }]);
    expect(en).toMatch(/No ready-to-print file yet\. Slice the model in step 2, or upload a \.gcode\.3mf from Bambu Studio in step 1\. Go to step 2/);
    expect(en).not.toMatch(/Customer's colours/);
    expect(panel(order(), [file("x.step")])).toMatch(/No sliced file yet\. In Bambu Studio: .* Upload the \.gcode\.3mf in step 1\. Go to step 1/);
  });

  it("after QC: no who-prints line; a reprint and the printers stay reachable, folded and closed", () => {
    for (const status of ["EVIDENCE_SUBMITTED", "ACCEPTED", "PAID", "REJECTED"] as const) {
      const html = render(order({ status }), [file("kesuni-benchy.gcode.3mf", benchy)]);
      expect(text(html), status).not.toMatch(/You start this print here|The agent prints/);
      // The start area (with every tick) sits in a closed "Start another print" fold, then More options with all printers.
      expect(html, status).toMatch(/<details class="fold pp-another"><summary>Start another print<\/summary>.*Before you start.*Start print.*<\/details><details class="fold pp-more"><summary>More options<\/summary>.*All printers/);
      expect(html, status).not.toMatch(/<details[^>]* open/);
      // The test mark is for orders in production only.
      expect(text(html), status).not.toMatch(/Test: mark as printed/);
    }
  });

  it("in Indonesian", () => {
    const idText = panel(order(), [file("kesuni-benchy.gcode.3mf", benchy)], "id");
    expect(idText).toMatch(/File siap cetak: kesuni-benchy\.gcode\.3mf/);
    expect(idText).toMatch(/Waktu cetak \(slicer\) 27 mnt Berat 9,82 g Jenis plate plate Textured PEI/);
    expect(idText).toMatch(/A1 Combo #2 tidak bisa Filamen 1 \(PLA\) belum punya slot AMS/);
    expect(idText).toMatch(/Pelanggan belum setuju harganya\. Cetak sekarang hanya kalau pemilik bilang boleh\. Sebelum mulai Bed cetak kosong dan bersih, dengan plate Textured PEI Saya ada di dekat printer Saya sudah cek peringatan di atas Mulai cetak Centang kotak di atas dulu\./);
    expect(idText).toMatch(/Opsi lainnya Semua printer/);
  });
});

describe("order page: the ready-to-print file", () => {
  // The studio PC weighed the customer's STL (any colour), then sliced it in the customer's colour.
  const weighing = file("Clip.gcode.3mf", benchy, { id: "F-w", uploadedBy: SLICER_NAME, at: "2026-10-17T02:00:00.000Z" });
  const printing = file("Clip.gcode.3mf", benchy, { id: "F-p", uploadedBy: SLICER_NAME, at: "2026-10-17T01:00:00.000Z" });
  const job = (resultAttachmentId: string, actor: SliceJob["actor"]): SliceJob => ({
    id: `SJ-${resultAttachmentId}`, orderId: "ORD-9", attachmentId: "F-stl", sourceName: "Clip.stl", mode: "mesh", printerId: "a1", tray: 0, material: "PLA",
    color: "#FEC600", quality: "standard", infillPct: 15, supports: "auto", key: resultAttachmentId, state: "done", actor, by: "x", createdAt: AT, updatedAt: AT, resultAttachmentId,
  });
  const slices: SliceData = { jobs: [job("F-w", "system"), job("F-p", "person")], slicer: { seenAt: AT, ready: true }, reload() {} };
  const paidOrder = order({ status: "PLAN_CHOSEN" });

  it("a weighing result is never preselected, even when it is newer", () => {
    // attachments are oldest first: the weighing came last.
    const html = render(paidOrder, [printing, weighing], "en", slices);
    expect(html).toMatch(/<option value="F-p" selected="">Clip\.gcode\.3mf · 17 Oct, 08:00<\/option>/);
    expect(html).toMatch(/<option value="F-w">Clip\.gcode\.3mf · 17 Oct, 09:00 · for the price only<\/option>/);
    expect(text(html)).not.toMatch(/sliced only to weigh/);
  });

  it("a weighing result alone: shown, with a warning that adds a tick", () => {
    const en = panel(paidOrder, [weighing], "en", { ...slices, jobs: [job("F-w", "system")] });
    expect(en).toMatch(/Ready-to-print file: Clip\.gcode\.3mf · 17 Oct, 09:00 · for the price only/);
    expect(en).toMatch(/This file was sliced only to weigh the model, in any colour\. Slice it in the customer's colour first \(step 2\)\. Before you start .* I checked the warnings above Start print/);
  });

  it("not the customer's colour: a warning that adds a tick", () => {
    const en = panel(order({ status: "PLAN_CHOSEN", preferredColors: [{ type: "PETG", color: "#FFFFFF", name: "White" }] }), [file("kesuni-benchy.gcode.3mf", benchy)]);
    expect(en).toMatch(/Not the customer's colour: they chose PETG White, this file prints PLA Yellow\. Before you start .* I checked the warnings above/);
    // Their colour: no warning.
    expect(panel(order({ status: "PLAN_CHOSEN", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] }), [file("kesuni-benchy.gcode.3mf", benchy)]))
      .not.toMatch(/Not the customer's colour|I checked the warnings above/);
    expect(panel(order({ status: "PLAN_CHOSEN", preferredColors: [{ type: "PETG", color: "#FFFFFF", name: "White" }] }), [file("kesuni-benchy.gcode.3mf", benchy)], "id"))
      .toMatch(/Bukan warna pilihan pelanggan: pelanggan memilih PETG Putih, file ini mencetak PLA Kuning\./);
  });
});

describe("order page: all printers (More options)", () => {
  const table = (ps: Printer[], locale: Locale = "en") => text(renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <PrinterPanel order={order({ status: "PLAN_CHOSEN" })} printers={ps} busy={false} act={async () => {}} now={Date.now()} />
    </LocaleProvider>,
  ));

  it("reserves a printer with “Reserve for this order”: it never says it prints; a held bed has “Part collected”", () => {
    const en = table(printers);
    expect(en).toMatch(/Reserve for this order/);
    expect(en).not.toMatch(/Print here|Assign printer|Your name|Operator tasks/);
    expect(en).toMatch(/HMS_0510_0400_0001_0044/);
    const held = table([{ ...printers[0], bedOccupiedBy: "ORD-7" }]);
    expect(held).toMatch(/holds ORD-7 Part collected/);
    expect(held).not.toMatch(/Bed is empty/);
    expect(table([{ ...printers[0], bedOccupiedBy: "ORD-7" }], "id")).toMatch(/berisi ORD-7 Hasil sudah diambil .*Tahan untuk pesanan ini/);
  });
});

describe("order page: who prints (the agent line)", () => {
  const withAgent = (autoPrint: Parameters<typeof PrintPanel>[0]["autoPrint"], locale: Locale = "en") => text(renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <PrintPanel order={order({ status: "PLAN_CHOSEN", label: "real" })} attachments={[file("kesuni-benchy.gcode.3mf", benchy)]} printers={printers}
        paid issueTexts={{}} autoPrint={autoPrint} slices={noSlices} busy={false} act={async () => {}} onChange={() => {}} />
    </LocaleProvider>,
  ));
  const line = {
    orderId: "ORD-9", why: { key: "Waiting for a person to confirm the bed on {printer}", vars: { printer: "A1 Combo #1" } }, action: "wait" as const,
    printerId: "a1", runsDone: 0, runsNeeded: 1, runsActive: 0,
  };

  it("one sentence: a person, or the agent with its prints and why it waits; never “of 0”", () => {
    expect(withAgent({ on: true, line, runsSet: false }))
      .toMatch(/^ The agent prints this order: 0 of 1 prints done\. It starts only after someone confirms the bed on My machines\. .* Waiting for a person to confirm the bed on A1 Combo #1/);
    const off = withAgent({ on: false, line: { ...line, why: { key: "Agent prints are off: a person starts it" } }, runsSet: false });
    expect(off).toMatch(/^ You start this print here\. Agent prints are off\./);
    expect(off).not.toMatch(/a person starts it|of 1/);
    const zero = withAgent({ on: true, line: { ...line, runsNeeded: 0, why: { key: "A person set 0 runs: the agent does not print it" } }, runsSet: true });
    expect(zero).toMatch(/^ You start this print here\. The agent does not print this order \(0 prints set\)\./);
    for (const en of [off, zero]) expect(en).not.toMatch(/of 0/);
    // A person printed it: one run covers the whole quantity (src/lib/printer/autoprint.ts).
    expect(withAgent({ on: true, line: { ...line, runsDone: 1, why: { key: "All runs printed ({done} of {needed})", vars: { done: 1, needed: 1 } } }, runsSet: false }))
      .toMatch(/^ 1 of 1 prints done\. The agent prints no more of this order\./);
    // Changing the runs is in More options.
    expect(withAgent({ on: true, line, runsSet: false })).toMatch(/More options Change agent prints All printers/);
  });

  it("the same rule as the Now banner: the agent cannot print it, a run is on the printer, or no plan yet", () => {
    // A file the agent may not print: a person starts it, and the line says why.
    const personFile = { ...line, runsNeeded: 5, why: { key: "The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one" } };
    const person = withAgent({ on: true, line: personFile, runsSet: false });
    expect(person).toMatch(/^ You start this print here\. The agent cannot print it now: .* The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one/);
    expect(person).not.toMatch(/The agent prints this order/);
    // A person's start on its way (the dispatcher counts it as the one run): no "the agent prints".
    const onPrinter = withAgent({ on: true, line: { ...line, runsActive: 1, why: { key: "Run {n} of {needed} is on the printer", vars: { n: 1, needed: 1 } } }, runsSet: false });
    expect(onPrinter).toMatch(/^ Run 1 of 1 is on the printer/);
    expect(onPrinter).not.toMatch(/The agent prints this order|You start/);
    // No dispatcher line (no plan, or it could not be made): never "the agent prints this order: 0 of …".
    const noLine = withAgent({ on: true, line: null, runsSet: false });
    expect(noLine).toMatch(/^ You start this print here\. /);
    expect(noLine).not.toMatch(/The agent prints this order|cannot print it now/);
    expect(withAgent({ on: true, line: personFile, runsSet: false }, "id")).toMatch(/^ Anda yang memulai cetakan ini di sini\. Agen belum bisa mencetaknya sekarang: /);
  });

  it("in Indonesian", () => {
    expect(withAgent({ on: true, line, runsSet: false }, "id"))
      .toMatch(/^ Agen mencetak pesanan ini: 0 dari 1 cetakan selesai\. Agen baru mulai setelah ada yang memastikan bed kosong di Mesin saya\. .* Menunggu orang memastikan bed A1 Combo #1 kosong/);
    expect(withAgent({ on: false, line, runsSet: false }, "id")).toMatch(/^ Anda yang memulai cetakan ini di sini\. Cetak oleh agen sedang mati\./);
    expect(withAgent({ on: true, line: { ...line, runsNeeded: 0 }, runsSet: true }, "id")).toMatch(/^ Anda yang memulai cetakan ini di sini\. Agen tidak mencetak pesanan ini \(0 cetakan\)\./);
    expect(withAgent({ on: true, line, runsSet: false }, "id")).toMatch(/Opsi lainnya Ubah cetakan agen/);
  });
});

describe("order page: “Test: mark as printed” in More options", () => {
  const html = (o: Order, locale: Locale = "en") => render(o, [file("kesuni-benchy.gcode.3mf", benchy)], locale);
  const mark = { by: "Khelda", at: "2026-10-16T07:05:00.000Z" };

  it("a small secondary button on a test order in production; never on a real order or outside production", () => {
    for (const status of ["PLAN_CHOSEN", "IN_PRODUCTION"] as const) {
      const h = html(order({ status }));
      expect(text(h)).toMatch(/More options .* Test: mark as printed/);
      expect(h).toMatch(/<button class="pp-debug-btn">Test: mark as printed<\/button>/);
    }
    expect(text(html(order({ status: "PLAN_CHOSEN", label: "real" })))).not.toMatch(/Test: mark as printed/);
    for (const status of ["CREATED", "EVIDENCE_SUBMITTED", "ACCEPTED"] as const) expect(text(html(order({ status }))), status).not.toMatch(/Test: mark as printed/);
  });

  it("once marked: one line with a test badge instead of the button, above the jobs", () => {
    const h = html(order({ status: "IN_PRODUCTION", printDoneDebug: mark }));
    expect(h).toMatch(/<span class="badge simulated">test<\/span>/);
    expect(text(h)).toMatch(/test Marked done for testing by Khelda · 16 Oct(,| at) 14:05/);
    expect(text(h)).not.toMatch(/Test: mark as printed/);
    // Still shown after QC moved the order on.
    expect(text(html(order({ status: "EVIDENCE_SUBMITTED", printDoneDebug: mark })))).toMatch(/Marked done for testing by Khelda/);
  });

  it("in Indonesian", () => {
    expect(text(html(order({ status: "PLAN_CHOSEN" }), "id"))).toMatch(/Opsi lainnya .* Uji: tandai sudah dicetak/);
    expect(text(html(order({ status: "IN_PRODUCTION", printDoneDebug: mark }), "id"))).toMatch(/uji Ditandai selesai untuk uji oleh Khelda · 16 Okt/);
  });
});

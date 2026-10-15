import { describe, expect, it } from "vitest";
import { emptySnapshot, hmsUrl, stageOf, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { makeT } from "@/i18n/core";
import { ID } from "@/i18n/id";
import {
  amsSlots, bedTypeLabel, issueCodes, issueViews, nozzleText, pauseNeedsFix, slotText, speedText, stageText, taskText, wifiQuality,
} from "./printer-details";
import { issueTexts } from "./issue-texts";

const en = makeT("en", ID);
const id = makeT("id", ID);
const AT = "2026-10-15T12:00:00.000Z";
const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
});
const snap = (over: Partial<PrinterSnapshot> = {}): PrinterSnapshot => ({ ...emptySnapshot(AT), state: "IDLE", ...over });
// Printer #3 on 15 Oct 2026 (read-only probe): fatal HMS, its AMS lite firmware does not match the printer.
const FATAL = { code: "HMS_0510_0400_0001_0044", severity: 1, url: hmsUrl("0510040000010044"), since: AT };

describe("what the printer is doing now", () => {
  it("shows the stage only while a job is on the printer, in the visitor's language", () => {
    expect(stageText(snap({ stage: stageOf("IDLE", [], 255) }), en)).toBeNull();
    expect(stageText(snap({ state: "PREPARE", stage: stageOf("PREPARE", [2, 7], 7) }), en)).toBe("Heating nozzle");
    expect(stageText(snap({ state: "PREPARE", stage: stageOf("PREPARE", [], null), prepPercent: 35 }), en)).toBe("Preparing 35%");
    expect(stageText(snap({ state: "PREPARE", stage: stageOf("PREPARE", [2, 7], 7) }), id)).toBe("Memanaskan nozzle");
    expect(stageText(snap({ state: "RUNNING", stage: stageOf("RUNNING", [99], 99) }), en)).toBe("Working (stage 99)");
  });

  it("a pause for a fault needs 'I fixed the cause'; a person's own pause does not", () => {
    const runout = snap({ state: "PAUSE", errorCode: 0x07008011, stage: stageOf("PAUSE", [0, 6], 6, 0x07008011) });
    expect(pauseNeedsFix(runout)).toBe(true);
    expect(pauseNeedsFix(snap({ state: "PAUSE", errorCode: 0x03008001, stage: stageOf("PAUSE", [0, 16], 16, 0x03008001) }))).toBe(false);
    expect(pauseNeedsFix(snap({ state: "RUNNING", errorCode: 0x07008011 }))).toBe(false);
  });
});

describe("faults", () => {
  it("are loud, worst first, with Bambu's own words in English and Indonesian", () => {
    const s = snap({ hms: [{ ...FATAL, code: "HMS_0300_0100_0003_0007", severity: 3 }, FATAL, { ...FATAL, code: "HMS_0700_0000_0004_0001", severity: 4 }] });
    const printers = [{ snapshot: s }];
    expect(issueCodes(printers)).toEqual(["HMS_0300_0100_0003_0007", "HMS_0510_0400_0001_0044", "HMS_0700_0000_0004_0001"]);
    const views = issueViews(s, issueTexts(printers, "en"));
    expect(views.map((v) => [v.code, v.tone, v.level])).toEqual([
      ["HMS_0510_0400_0001_0044", "bad", "fatal"], ["HMS_0300_0100_0003_0007", "warn", "common"],
    ]);
    expect(views[0].text).toMatch(/firmware of AMS lite does not match the printer/i);
    expect(issueViews(s, issueTexts(printers, "id"))[0].text).toMatch(/Firmware AMS lite tidak sesuai dengan printer/);
    // A print_error that is a person's own stop is not a fault; a filament runout is.
    expect(issueViews(snap({ errorCode: 0x0300400c }), {})).toEqual([]);
    expect(issueViews(snap({ errorCode: 0x07008011 }), {}).map((v) => [v.code, v.tone, v.text])).toEqual([["0700-8011", "bad", null]]);
    expect(issueTexts([{ snapshot: snap({ errorCode: 0x07008011 }) }], "en")["0700-8011"]).toMatch(/AMS filament ran out/);
  });
});

describe("AMS slots and details", () => {
  it("lists the four slots with colour names, the active one, and empty slots", () => {
    const s = snap({ ams: { trays: [tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PETG", "#0085D5")], activeSlot: 2, externalActive: false, humidity: null, lite: true } });
    expect(amsSlots(s).map((x) => [x.slot, x.empty, x.type, x.name, x.active, x.bambu])).toEqual([
      [1, false, "PLA", "Yellow", false, true], [2, true, null, null, false, false], [3, false, "PLA", "Red", true, false], [4, false, "PETG", "Blue", false, false],
    ]);
    expect(amsSlots(snap())).toEqual([]); // an older bridge does not report the AMS
    expect(slotText(2, en)).toBe("Slot 3");
    expect(slotText(5, en)).toBe("AMS 2 slot 2");
  });

  it("reads speed, nozzle, Wi-Fi and the plate type", () => {
    expect(speedText(snap({ speedLevel: 3, speedPct: 124 }), en)).toBe("Sport · 124%");
    expect(speedText(snap({ speedLevel: 2, speedPct: 100 }), id)).toBe("Standar · 100%");
    expect(nozzleText(snap({ nozzle: { diameter: "0.4", type: "stainless_steel" } }), en)).toBe("0.4 mm · stainless steel");
    expect(nozzleText(snap({ nozzle: { diameter: "0.4", type: "hardened_steel" } }), id)).toBe("0.4 mm · baja keras");
    expect([-55, -65, -76, null].map(wifiQuality)).toEqual(["good", "fair", "weak", null]);
    expect(bedTypeLabel("textured_plate")).toBe("Textured PEI plate");
    expect(bedTypeLabel("odd_plate")).toBe("odd plate");
    expect(id(bedTypeLabel("textured_plate")!)).toBe("plate Textured PEI");
  });
});

describe("operator task texts", () => {
  const enWords = issueTexts([{ snapshot: snap({ hms: [FATAL] }) }], "en")[FATAL.code]!;
  const idWords = issueTexts([{ snapshot: snap({ hms: [FATAL] }) }], "id")[FATAL.code]!;
  // The stored text, as issueTaskText (src/lib/printer/actions.ts) writes it.
  const fault = {
    text: `A1 Combo #3 reports ${FATAL.code} (fatal): ${enWords} Check the printer before the next print. ${FATAL.url}`,
    errorCode: FATAL.code,
  };

  it("keeps the stored English text byte for byte", () => {
    expect(taskText(fault, en, issueTexts([{ snapshot: snap({ hms: [FATAL] }) }], "en"))).toBe(fault.text);
    expect(taskText(fault, en)).toBe(fault.text);
  });

  it("shows a fault task in Indonesian with Bambu's Indonesian words", () => {
    expect(idWords).not.toBe(enWords);
    expect(taskText(fault, id, { [FATAL.code]: idWords })).toBe(
      `A1 Combo #3 melaporkan ${FATAL.code} (fatal): ${idWords} Periksa printer sebelum cetakan berikutnya. ${FATAL.url}`);
    // The fault is no longer reported: the frame is translated, Bambu's words stay as stored.
    expect(taskText(fault, id)).toBe(
      `A1 Combo #3 melaporkan ${FATAL.code} (fatal): ${enWords} Periksa printer sebelum cetakan berikutnya. ${FATAL.url}`);
  });

  it("translates a print_error task and leaves other tasks to the library texts", () => {
    const pe = { text: "A1 Combo #1 reports error 0500-4004: Bambu has no description for this code. Check the printer before the next print. https://wiki.bambulab.com/en/hms/home", errorCode: "0500-4004" };
    expect(taskText(pe, id)).toBe("A1 Combo #1 melaporkan error 0500-4004: Bambu tidak punya keterangan untuk kode ini. Periksa printer sebelum cetakan berikutnya. https://wiki.bambulab.com/en/hms/home");
    expect(taskText({ text: "Make it" }, en)).toBe("Make it");
  });
});

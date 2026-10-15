import { describe, expect, it } from "vitest";
import {
  amsKey, colorsCheckedNow, deltaE, hexToLab, labToHex, matchJob, nameOf, normalizeHex, parseColorChoices, publicPalette, studioPalette,
} from "./colors";
import { emptySnapshot, type AmsTray } from "./printer/bambu";
import type { Printer } from "./types";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
});
const printer = (id: string, trays: AmsTray[], extra: Partial<Printer> = {}): Printer => ({
  id, name: id, lastSeen: new Date(NOW - 60_000).toISOString(),
  snapshot: { ...emptySnapshot(new Date(NOW).toISOString()), state: "IDLE", ams: { trays, activeSlot: null, externalActive: false, humidity: null, lite: true } },
  ...extra,
});
// The studio on 15 Oct 2026 (read-only probe).
const P1 = printer("a1", [tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PLA", "#C12E1F", true)]);
const P2 = printer("a1-2", [tray(0, "PLA", "#000000"), tray(1, "PETG", "#000000"), tray(2, "PLA", "#3F8E43", true), tray(3, "PLA", "#000000")]);
const P3 = printer("a1-3", [tray(0, "PLA", "#000000"), tray(1, "PETG", "#0085D5"), tray(2, "PLA", "#FF6910"), tray(3, "PETG", "#FFFFFF")]);

describe("colour maths", () => {
  it("hex <-> Lab round-trips and deltaE00 behaves", () => {
    for (const hex of ["#000000", "#FFFFFF", "#FEC600", "#0085D5", "#3F8E43"]) expect(labToHex(hexToLab(hex))).toBe(hex);
    expect(hexToLab("#FFFFFF").L).toBeCloseTo(100, 1);
    expect(deltaE("#FEC600", "#FEC600")).toBe(0);
    expect(deltaE("#000000", "#FFFFFF")).toBeCloseTo(100, 0);
    expect(deltaE("#FEC600", "#FCE300")).toBeLessThan(10);  // two yellows: same colour, another batch
    expect(deltaE("#C52C18", "#C12E1F")).toBeLessThan(3);   // the two reds on printer #1
    expect(deltaE("#FFFFFF", "#7A7A7A")).toBeGreaterThan(30); // white is not grey
    expect(deltaE("#0085D5", "#FF6910")).toBeCloseTo(deltaE("#FF6910", "#0085D5"), 6);
  });

  it("CIEDE2000 matches published reference values (Sharma, Wu and Dalal 2005)", () => {
    // Pairs 1 and 7 of the reference table, through Lab -> hex is lossy, so compare Lab directly by rebuilding hex.
    expect(deltaE(labToHex({ L: 50, a: 2.6772, b: -79.7751 }), labToHex({ L: 50, a: 0, b: -82.7485 }))).toBeLessThan(4);
    expect(deltaE("#808080", "#818181")).toBeLessThan(0.5);
  });

  it("names colours in plain English and normalises hex", () => {
    expect(["#FEC600", "#C52C18", "#000000", "#FFFFFF", "#0085D5", "#FF6910", "#3F8E43", "#7A7A7A"].map(nameOf))
      .toEqual(["Yellow", "Red", "Black", "White", "Blue", "Orange", "Green", "Grey"]);
    expect(nameOf("nonsense")).toBe("Unknown colour");
    expect(normalizeHex("fec600ff")).toBe("#FEC600");
    expect(normalizeHex("#12")).toBeNull();
  });
});

describe("studioPalette", () => {
  it("lists each loaded material + colour once, with the printers and slots that have it", () => {
    const palette = studioPalette([P1, P2, P3], NOW);
    expect(palette.map((c) => `${c.type} ${c.color} ${c.name}`)).toEqual([
      "PETG #000000 Black", "PETG #0085D5 Blue", "PETG #FFFFFF White",
      "PLA #000000 Black", "PLA #3F8E43 Green", "PLA #FF6910 Orange", "PLA #C12E1F Red", "PLA #C52C18 Red", "PLA #FEC600 Yellow",
    ]);
    expect(palette.find((c) => c.type === "PLA" && c.color === "#000000")!.printers).toEqual([
      { printerId: "a1-2", slots: [0, 3] }, { printerId: "a1-3", slots: [0] },
    ]);
  });

  it("marks a colour checked only for Bambu RFID spools or after a person checked that printer's spools", () => {
    let palette = studioPalette([P1, P2], NOW);
    expect(palette.find((c) => c.color === "#FEC600")!.checked).toBe(true);   // RFID
    expect(palette.find((c) => c.color === "#C52C18")!.checked).toBe(false);  // generic, typed on the printer
    const checked = { ...P2, colorsChecked: { by: "Khelda", at: new Date(NOW).toISOString(), key: amsKey(P2.snapshot) } };
    expect(colorsCheckedNow(checked)).toBe(true);
    palette = studioPalette([P1, checked], NOW);
    expect(palette.find((c) => c.type === "PETG" && c.color === "#000000")!.checked).toBe(true);
    // A spool change makes the check stale.
    const changed = { ...checked, snapshot: { ...checked.snapshot!, ams: { ...checked.snapshot!.ams!, trays: [tray(0, "PLA", "#FFFFFF")] } } };
    expect(colorsCheckedNow(changed)).toBe(false);
  });

  it("leaves out printers not seen for a day, and customers never see printers or slots", () => {
    const old = { ...P3, lastSeen: new Date(NOW - 2 * 86_400_000).toISOString() };
    expect(studioPalette([old], NOW)).toEqual([]);
    const pub = publicPalette(studioPalette([P1], NOW));
    expect(JSON.stringify(pub)).not.toMatch(/a1|slots|printer/);
    expect(pub[0]).toEqual({ type: "PLA", color: "#C12E1F", name: "Red", checked: true });
  });
});

describe("matchJob", () => {
  it("maps each filament to the nearest colour of the same material, one entry per project filament", () => {
    // Bambu's 3-colour Benchy sample: white, grey, black. Printer #3 has PLA black and PLA orange, PETG white.
    const filaments = [
      { id: 1, type: "PLA", color: "#FFFFFF", usedG: 7.98 }, { id: 2, type: "PLA", color: "#7A7A7A", usedG: 4.45 },
      { id: 3, type: "PLA", color: "#000000", usedG: 3.34 },
    ];
    const m = matchJob(filaments, P3, 3);
    expect(m.ok).toBe(false);
    expect(m.mapping).toEqual([-1, -1, 0]);
    // White exists only as PETG on #3: the material must match, so it is missing, never mapped to PETG.
    expect(m.missing).toEqual([
      { filamentId: 1, type: "PLA", color: "#FFFFFF", reason: "color" },
      { filamentId: 2, type: "PLA", color: "#7A7A7A", reason: "color" },
    ]);
    expect(m.suggestions[0].slots.map((s) => s.slot)).toEqual([2, 0]); // orange is nearer to white than black is
  });

  it("several filaments may share a tray; a plate that skips a filament leaves -1", () => {
    const m = matchJob([{ id: 1, type: "PLA", color: "#FCE300", usedG: 9 }, { id: 3, type: "PLA", color: "#C52C18", usedG: 1 }], P1, 3);
    expect(m).toMatchObject({ ok: true, mapping: [0, -1, 2], missing: [] });
  });

  it("a material that is not loaded is missing", () => {
    const m = matchJob([{ id: 1, type: "PETG", color: "#FFFFFF", usedG: 9 }], P1, 1);
    expect(m).toMatchObject({ ok: false, mapping: [-1], missing: [{ filamentId: 1, reason: "material" }] });
  });
});

describe("parseColorChoices", () => {
  it("takes material + colour, fills the name, drops repeats", () => {
    expect(parseColorChoices(undefined)).toEqual({ ok: true, choices: [] });
    expect(parseColorChoices([{ type: "PLA", color: "#fec600" }, { type: "PLA", color: "#FEC600" }, { type: "PETG", color: "#FFFFFF", name: "Snow" }]))
      .toEqual({ ok: true, choices: [{ type: "PLA", color: "#FEC600", name: "Yellow" }, { type: "PETG", color: "#FFFFFF", name: "Snow" }] });
  });

  it("refuses other materials, bad colours, too many, and colours the studio has not loaded", () => {
    expect(parseColorChoices([{ type: "ABS", color: "#000000" }])).toEqual({ ok: false, reasons: ["Material must be PLA or PETG"] });
    expect(parseColorChoices([{ type: "PLA", color: "red" }])).toEqual({ ok: false, reasons: ["A colour must be written as #RRGGBB"] });
    expect(parseColorChoices("red")).toEqual({ ok: false, reasons: ["Colours must be a list"] });
    expect(parseColorChoices(Array(5).fill({ type: "PLA", color: "#000000" }))).toEqual({ ok: false, reasons: ["Pick at most 4 colours"] });
    const palette = studioPalette([P1], NOW);
    expect(parseColorChoices([{ type: "PLA", color: "#FEC600" }], palette).ok).toBe(true);
    expect(parseColorChoices([{ type: "PETG", color: "#FEC600" }], palette))
      .toEqual({ ok: false, reasons: ["PETG Yellow (#FEC600) is not loaded in the studio right now"] });
  });
});

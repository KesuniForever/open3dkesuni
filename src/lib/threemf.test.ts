import { describe, expect, it } from "vitest";
import { parse3mf, plateMd5, readEntry, zipEntries } from "./threemf";
import { fake3mf, makeZip } from "./threemf.test-helper";

const benchy = () => fake3mf({ plates: [{ index: 1, prediction: 1644, weight: 9.82, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82 }] }], projectColours: ["#FCE300"] });

describe("parse3mf", () => {
  it("reads a sliced Bambu Studio file: plate, time, weight, filaments, model, nozzle", () => {
    expect(parse3mf(benchy())).toEqual({
      sliced: true,
      plates: [{
        index: 1, predictionSec: 1644, weightG: 9.82, bedType: "textured_plate", nozzle: "0.4", objects: 1,
        filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82, usedM: 1, infoIdx: "GFA00" }],
      }],
      printerModel: "Bambu Lab A1", printerModelId: "N2S", nozzle: "0.4",
      projectFilaments: [{ type: "PLA", color: "#FCE300" }], slicerVersion: "02.08.02.61",
    });
  });

  it("a project saved after slicing has time and weight but no G-code: not sliced", () => {
    const info = parse3mf(fake3mf({ plates: [{ index: 1, gcode: false, filaments: [{ id: 1, type: "PLA", color: "#FFFFFF", usedG: 5 }] }] }));
    expect(info.sliced).toBe(false);
    expect(info.plates).toEqual([]);
  });

  it("keeps only plates with G-code, and every project filament for the AMS mapping", () => {
    const info = parse3mf(fake3mf({
      projectColours: ["#FFFFFF", "#7A7A7A", "#000000"],
      plates: [
        { index: 1, filaments: [{ id: 1, type: "PLA", color: "#FFFFFF", usedG: 7.98 }, { id: 3, type: "PLA", color: "#000000", usedG: 3.34 }] },
        { index: 2, gcode: false, filaments: [{ id: 2, type: "PLA", color: "#7A7A7A", usedG: 4 }] },
      ],
    }));
    expect(info.plates.map((p) => [p.index, p.filaments.map((f) => f.id)])).toEqual([[1, [1, 3]]]);
    expect(info.projectFilaments).toHaveLength(3);
  });

  it("an older file without printer_model_id still names the printer in its project settings", () => {
    const info = parse3mf(fake3mf({ modelId: null, plates: [{ index: 1, filaments: [{ id: 1, type: "PETG", color: "#0085d5", usedG: 3 }] }] }));
    expect(info).toMatchObject({ sliced: true, printerModel: "Bambu Lab A1", printerModelId: undefined });
    expect(info.plates[0].filaments[0]).toMatchObject({ type: "PETG", color: "#0085D5" });
  });

  it("reads the plate MD5 Bambu Studio stores", () => {
    expect(plateMd5(benchy(), 1)).toBe("620EC56B9F0055C8F150E761B9B84051");
    expect(plateMd5(benchy(), 2)).toBeNull();
  });

  it("never throws: a file that is not a ZIP comes back unsliced with the reason", () => {
    expect(parse3mf(new TextEncoder().encode("solid cube\nendsolid"))).toEqual({ sliced: false, plates: [], error: "Not a ZIP archive" });
    expect(parse3mf(new Uint8Array(0))).toMatchObject({ sliced: false, error: "Not a ZIP archive" });
  });
});

describe("zip reader safety", () => {
  it("refuses names that climb out of the archive or are absolute", () => {
    for (const name of ["../evil.txt", "Metadata/../../evil", "/etc/passwd", "C:/Windows/x", "a\\..\\b"]) {
      expect(() => zipEntries(makeZip([{ name, data: "x" }])), name).toThrow("Unsafe file name");
    }
  });

  it("refuses a zip bomb before unpacking anything", () => {
    const bomb = makeZip([{ name: "Metadata/slice_info.config", data: "<config/>", declaredSize: 900 * 1024 * 1024 }]);
    expect(() => zipEntries(bomb)).toThrow(/zip bomb/);
    expect(parse3mf(bomb)).toMatchObject({ sliced: false, error: "Suspicious compression ratio (zip bomb)" });
  });

  it("unpacks no more than the size it declares, and only small metadata", () => {
    const big = "x".repeat(10_000);
    const lying = makeZip([{ name: "a.txt", data: big, declaredSize: 100 }]);
    const [e] = zipEntries(lying);
    expect(() => readEntry(lying, e)).toThrow();
    const [ok] = zipEntries(makeZip([{ name: "a.txt", data: big }]));
    expect(() => readEntry(makeZip([{ name: "a.txt", data: big }]), ok, 1000)).toThrow("too large");
  });

  it("refuses encrypted entries and reads stored ones", () => {
    const enc = makeZip([{ name: "a.txt", data: "secret", flags: 1 }]);
    expect(() => readEntry(enc, zipEntries(enc)[0])).toThrow("Encrypted");
    const plain = makeZip([{ name: "a.txt", data: "hello", stored: true }]);
    expect(readEntry(plain, zipEntries(plain)[0]).toString()).toBe("hello");
  });
});

describe("hostile slice_info.config (files come from customers)", () => {
  const time = (bytes: Uint8Array) => { const t0 = performance.now(); const info = parse3mf(bytes); return { info, ms: performance.now() - t0 }; };
  const withSliceInfo = (xml: string) => makeZip([
    { name: "Metadata/slice_info.config", data: xml, stored: true },
    { name: "Metadata/plate_1.gcode", data: "G28\n" },
  ]);

  it("an unclosed <plate>, <metadata>, <filament> or attribute never makes it slow (linear scans)", () => {
    const n = 512 * 1024;
    for (const xml of [
      "<plate>".repeat(Math.floor(n / 7)),
      `<plate>${"<metadata ".repeat(Math.floor(n / 10))}`,
      `<plate>${"<filament ".repeat(Math.floor(n / 10))}></plate>`,
      `<plate><metadata ${"k".repeat(n)}/></plate>`,
      `<plate><metadata key="${"a".repeat(n)}</plate>`,
      `<header_item key="X-BBL-Client-Version" value="${"9".repeat(n)}`,
    ]) {
      const { info, ms } = time(withSliceInfo(xml));
      expect(ms).toBeLessThan(250);
      expect(info.plates.every((p) => p.index === 1)).toBe(true);
    }
  });

  it("refuses two entries with the same name", () => {
    const bytes = makeZip([{ name: "Metadata/plate_1.gcode", data: "G28\n" }, { name: "Metadata/plate_1.gcode", data: "M104 S300\n" }]);
    expect(() => zipEntries(bytes)).toThrow("The archive holds two files with the same name");
    expect(parse3mf(bytes)).toMatchObject({ sliced: false, error: "The archive holds two files with the same name" });
  });

  it("plates are 1..64 only, and slice_info.config is capped", () => {
    const far = makeZip([{ name: "Metadata/plate_900.gcode", data: "G28\n" }, { name: "Metadata/plate_0.gcode", data: "G28\n" }]);
    expect(parse3mf(far).sliced).toBe(false);
    const big = withSliceInfo(`<config>${" ".repeat(3 * 1024 * 1024)}</config>`);
    expect(parse3mf(big)).toMatchObject({ sliced: false, error: "Metadata/slice_info.config is too large to read" });
  });
});

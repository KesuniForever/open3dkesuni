import { describe, expect, it } from "vitest";
import { parse3mf, plateMd5, readEntry, zipEntries } from "../../src/lib/threemf.ts";
import { fake3mf, makeZip } from "../../src/lib/threemf.test-helper.ts";
import { fillPrinterModelId, replaceZipEntry } from "./zip-patch.mjs";

// Bambu Studio's command line leaves printer_model_id empty; the bridge fills "N2S" (the A1) and keeps every other
// entry byte for byte, so the G-code and its MD5 are exactly what the slicer wrote.
const entries = (buf) => Object.fromEntries(zipEntries(buf).map((e) => [e.name, readEntry(buf, e, 1e9).toString("latin1")]));

describe("zip-patch", () => {
  it("fills printer_model_id and changes nothing else", () => {
    const before = Buffer.from(fake3mf({ modelId: "", projectColours: ["#FFFFFF"], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color: "#FFFFFF", usedG: 4 }] }] }));
    expect(parse3mf(before).printerModelId).toBeUndefined();
    const after = fillPrinterModelId(before);
    expect(parse3mf(after)).toMatchObject({ sliced: true, printerModelId: "N2S" });
    const a = entries(before), b = entries(after);
    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const name of Object.keys(a).filter((n) => n !== "Metadata/slice_info.config")) expect(b[name], name).toBe(a[name]);
    expect(b["Metadata/slice_info.config"]).toBe(a["Metadata/slice_info.config"].replace('key="printer_model_id" value=""', 'key="printer_model_id" value="N2S"'));
    expect(plateMd5(after, 1)).toBe(plateMd5(before, 1));
  });

  it("rewrites a stored entry too, and refuses what is not a plain ZIP with exactly one such entry", () => {
    const zip = Buffer.from(makeZip([{ name: "a.txt", data: "hello", stored: true }, { name: "b.txt", data: "world" }]));
    expect(entries(replaceZipEntry(zip, "a.txt", (old) => `${old} there`))).toEqual({ "a.txt": "hello there", "b.txt": "world" });
    expect(() => replaceZipEntry(zip, "c.txt", (x) => x)).toThrow("c.txt: found 0 times");
    expect(() => replaceZipEntry(Buffer.from("not a zip at all, just text....."), "a.txt", (x) => x)).toThrow("not a ZIP file");
  });
});

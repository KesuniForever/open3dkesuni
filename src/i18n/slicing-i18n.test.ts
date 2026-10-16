import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeT } from "./core";
import { ID } from "./id";
import { tLib } from "@/lib/lib-text";
import { QUALITY } from "@/lib/slice-rules";
import { CLI_ERRORS } from "../../scripts/bridge/slicer.mjs";

// Slicing on the website: every English text on "Slice here" and every reason the app or the studio PC can return has
// an Indonesian entry (English stays the source; the site opens in English). "Printer" and "Slot {n}" read the same.
const id = makeT("id", ID);
const literals = (file: string) => [...readFileSync(path.join(process.cwd(), file), "utf8").matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

describe("slicing texts in Indonesian", () => {
  it("every t(\"…\") on the slice panel, its states and the quality names", () => {
    const keys = [
      ...literals("src/app/orders/[id]/SlicePanel.tsx"),
      "Waiting for the studio PC", "Slicing…", "Sliced", "Failed", "Cancelled",
      ...Object.values(QUALITY).map((q) => q.label),
      "Slice it above, or upload a .gcode.3mf from Bambu Studio under Files.",
    ];
    const missing = keys.filter((k) => !(k in ID) && !["Slot {n}", "Printer"].includes(k));
    expect(missing).toEqual([]);
  });

  it("every reason the app and the studio PC return, with the values filled in", () => {
    const texts = [
      ...Object.values(CLI_ERRORS) as string[],
      "Agent prints are off: only a person can ask for a slice", "Order is CREATED; nothing to slice now", "Order is PAID; nothing to slice now",
      "This file cannot be sliced here", "Pick an AMS spool (tray 0 to 15)", "The spool cannot be used", "A1 Combo #2 slot 3 is empty",
      "A1 Combo #1 slot 4 holds ABS: only PLA and PETG are sliced here", "A1 Combo #1 slot 1 reports no colour",
      "Quality must be standard, fine or draft", "Infill must be a whole number from 0 to 100", "Supports must be auto or off",
      "The agent cannot ask for this slice", "Nobody confirmed the colours on A1 Combo #3", "A1 Combo #3 has not reported in the last 2 min",
      "Nobody confirmed the colours on A1 Combo #1: check the spool is really White",
      "A1 Combo #1 has not reported in the last 2 min: its spools may have changed",
      "At most 3 slices can wait per order", "At most 10 slices can wait on the studio PC", "The same slice is already waiting", "Slice not found",
      "The slice is queued", "The slice is done", "The slice is cancelled; the sliced file was kept on the order",
      "The studio PC did not take the slice within 15 min: is the bridge running with Bambu Studio?", "The studio PC stopped answering while slicing",
      "The studio PC could not slice it", "Slice SJ-3-mv9 is still using this file: cancel the slice first",
      "Only design files can be sliced", "STEP files cannot be sliced here: export an STL from the CAD program",
      "Only STL, OBJ or an unsliced Bambu Studio 3MF can be sliced here", "This 3MF is already sliced",
      "This 3MF is not set up for the Bambu Lab A1 0.4 mm: slice it in Bambu Studio", "This 3MF uses several filaments: slice it in Bambu Studio",
      "The slicer output has no printable plate", "The slicer output has more than one plate", "The slicer output is not for the Bambu Lab A1",
      "The slicer output uses more than one filament", "The slicer output is not for the 0.4 mm nozzle", "The slicer output is not for the textured PEI plate",
      "The slicer output has no weight or time", "The slicer output has the wrong filament or colour", "The slicer output has no readable settings",
      "The slicer output used another filament profile", "The slicer output used other profiles", "The slicer output has other settings than asked",
      "The sliced file is larger than 50 MB", "The sliced file is empty", "The sliced file changed on the way (checksum mismatch)",
      "Slicing failed (code -77)", "Slicing took longer than 10 min and was stopped", "Bambu Studio was not found on the studio PC",
      "Bambu Studio could not be started", "The Bambu Studio profiles were not found on the studio PC", "The slicer wrote no file",
      "The sliced file could not be read", "The model file is empty or larger than 50 MB", "The model file is larger than 50 MB",
      "Only STL and OBJ files can be sliced here", "Only PLA and PETG can be sliced here", "The colour must be #RRGGBB", "Infill must be 0-100 %",
      "The slice has no download link from this app", "Could not download the model", "Could not download the model (the app answered 404)",
      "The model changed on the way (checksum mismatch)", "The model is not the file the slice was asked for", "The slicer hit an error on the studio PC",
      "Could not upload the sliced file to the app", "The app did not take the sliced file (it answered 500)",
      "A person's name is required", "Order not found", "File not found", "Printer not found", "Cancelled by Khelda",
      "The 3MF could not be read (broken, or a suspicious archive)", "The 3MF unpacks to more than 500 MB", "The 3MF has no readable Bambu Studio settings",
      "The 3MF runs a post-processing script: slice it in Bambu Studio", "The 3MF uses its own printer settings: slice it in Bambu Studio",
    ];
    const untranslated = texts.filter((x) => tLib(id, x) === x);
    expect(untranslated).toEqual([]);
    expect(tLib(id, "A1 Combo #2 slot 3 is empty")).toBe("A1 Combo #2 slot 3 kosong");
    expect(tLib(id, "Nobody confirmed the colours on A1 Combo #1: check the spool is really White")).toBe("Belum ada yang mengonfirmasi warna di A1 Combo #1: cek apakah spool benar-benar Putih");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeT } from "./core";
import { ID } from "./id";
import { NOW_TEXTS, STATUS_WORDS, STEP_TITLE } from "@/app/orders/[id]/operator-step";

// The order page as six steps: every English text on the Now banner, the step cards and the step panels has an
// Indonesian entry (English stays the source; the site opens in English).
const id = makeT("id", ID);
const src = (file: string) => readFileSync(path.join(process.cwd(), "src/app/orders/[id]", file), "utf8");
/** t("…") literals, and both texts of t(cond ? "…" : "…"). */
const literals = (file: string) => [
  ...[...src(file).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]),
  ...[...src(file).matchAll(/\bt\(\s*[\w.!=<>&|() ]+\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].flatMap((m) => [m[1], m[2]]),
].map((k) => k.replace(/\\"/g, "\""));
// Words that read the same in Indonesian.
const SAME = ["Status", "offline", "timelapse", "Plate", "Plate {n}", "Nozzle", "Printer", "Slot {n}", "{printer} slot {slots}", "Total ({units})"];

describe("the order page's steps in Indonesian", () => {
  it("every t(\"…\") on the banner, the step cards and the panels, every Now line and every status word", () => {
    const files = ["Steps.tsx", "OrderView.tsx", "PrintPanel.tsx", "WeightPricePanel.tsx", "PrinterPanel.tsx", "AgentPrintRow.tsx", "SlicePanel.tsx", "FilesPanel.tsx", "CustomerLinkPanel.tsx"];
    const keys = [...files.flatMap(literals), ...NOW_TEXTS, ...Object.values(STATUS_WORDS), ...Object.values(STEP_TITLE)];
    expect(keys.length).toBeGreaterThan(250);
    expect([...new Set(keys)].filter((k) => !(k in ID) && !SAME.includes(k))).toEqual([]);
  });

  it("the Now lines, with their values", () => {
    expect(id("Printing on {printer} · {pct}% · about {left} left. Nothing to do until it ends.", { printer: "A1 Combo #2", pct: 42, left: "35 mnt" }))
      .toBe("Sedang dicetak di A1 Combo #2 · 42% · sekitar 35 mnt lagi. Tunggu sampai selesai.");
    expect(id("Step {n} of 6", { n: 4 })).toBe("Langkah 4 dari 6");
    expect(id(STATUS_WORDS.CREATED)).toBe("Sedang dihitung harganya");
    expect(id(STATUS_WORDS.IN_PRODUCTION)).toBe("Dalam produksi");
    expect(id(STEP_TITLE.handover)).toBe("Serah terima & pembayaran");
    expect(id("Test: mark as printed")).toBe("Uji: tandai sudah dicetak");
  });
});

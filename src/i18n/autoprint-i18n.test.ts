import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { makeT } from "./core";
import { ID } from "./id";
import { tLib } from "@/lib/lib-text";
import { whyLine } from "@/lib/printer/why-text";
import * as store from "@/lib/store";
import { chiefAuthority } from "@/lib/agent/authority";
import { AGENT_PRINTS_OFF_TEXT } from "../../scripts/bridge/runner.mjs";
import { AGENT_SPOOL_CHANGED_TEXT } from "../../scripts/bridge/logic.mjs";
import { SPOOL_CHANGED_TEXT } from "@/lib/printer/autoprint";

// Agent prints: every English text on the new cards and lines, every reason the dispatcher and its gates give, and
// every refusal, has an Indonesian entry (English stays the source; the site opens in English).
const id = makeT("id", ID);
const src = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const literals = (file: string) => [...src(file).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, "\""));
/** Every { key: "..." } a reason is built with in these files. */
const whyKeys = (file: string) => [...src(file).matchAll(/\bkey: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);

beforeEach(() => store.resetDb());

describe("agent prints in Indonesian", () => {
  it("every t(\"…\") on the switch card, the order's Agent line and My machines", () => {
    const keys = [
      ...literals("src/app/components/AutoPrintCard.tsx"), ...literals("src/app/orders/[id]/AgentPrintRow.tsx"),
      ...literals("src/app/machines/MachinesBoard.tsx"), ...literals("src/app/machines/page.tsx"), ...literals("src/app/chief/page.tsx"),
      // the Chief page's short labels and the PrintPanel's new lines
      "Ask the dispatcher to look", "Prints after a person empties the bed", "Does not turn agent prints on", "by the agent (bed: {name})",
      "Print the order's sliced Bambu Studio file on a studio printer. A person confirms the bed is empty and stands at the printer; the LAN bridge uploads the file and starts the print. The Chief (Claude) never starts a print; with agent prints on, code does, only after a person confirmed the bed empty.",
    ];
    // Words that read the same in Indonesian (on My machines before agent prints).
    const same = ["Printer", "Online", "online", "offline", "{printer} slot {slots}", "target {n} °C", "Nozzle", "Slot {n}", "Firmware", "Status"];
    const missing = [...new Set(keys)].filter((k) => !(k in ID) && !same.includes(k));
    expect(missing).toEqual([]);
  });

  it("every reason the gates and the dispatcher give", () => {
    const keys = [
      ...whyKeys("src/lib/printer/autoprint.ts"), ...whyKeys("src/lib/printer/autoprint-rules.ts"), ...whyKeys("src/lib/printer/dispatch.ts"),
    ].filter((k) => k !== "{printer}: {reason}");
    expect(keys.length).toBeGreaterThan(40);
    expect([...new Set(keys)].filter((k) => !(k in ID))).toEqual([]);
  });

  it("reasons with their values, nested reasons and colour names", () => {
    expect(whyLine(id, { key: "No spool of {material} {name} loaded", vars: { material: "PETG", name: "White" } })).toBe("Tidak ada spool PETG Putih yang terpasang");
    expect(whyLine(id, { key: "{printer}: {reason}", vars: { printer: "A1 Combo #2", reason: "Nobody confirmed the colours on this printer" } }))
      .toBe("A1 Combo #2: Belum ada yang mengonfirmasi warna di printer ini");
    expect(whyLine(id, { key: "{printer}: {reason}", vars: { printer: "A1 Combo #1", reason: "Printer error HMS_0510_0400_0001_0044" } }))
      .toBe("A1 Combo #1: Error printer HMS_0510_0400_0001_0044");
    expect(whyLine(id, { key: "Waiting for a person to confirm the bed on {printer}", vars: { printer: "A1 Combo #3" } })).toBe("Menunggu orang memastikan bed A1 Combo #3 kosong");
    expect(whyLine(id, { key: "All runs printed ({done} of {needed})", vars: { done: 2, needed: 2 } })).toBe("Semua cetakan selesai (2 dari 2)");
    expect(whyLine(id, null)).toBe("");
  });

  it("every refusal and task text the app and the bridge return, with the values filled in", () => {
    const texts = [
      "Agent prints are off", "The agent cannot start this print", "Another print already used this bed confirmation or printer",
      "Agent prints were turned off: nothing was sent.",
      "The bed confirmation this agent print used is no longer valid: nothing was sent. A person confirms the bed again.",
      "Say on: true or false", "Agent prints are switched off on this server (KESUNI_AUTO_PRINT=off)", "Runs must be a whole number from 0 to 50",
      "The agent prints only after a person confirmed the bed is empty", "The last print failed: a person starts the next one",
      "No spool of PLA Red on A1 Combo #2", "Linked to ORD-004", "Printer warning HMS_0300_0100_0003_0001: a person checks it",
      "The sliced file has 2 plates: a person prints it", "The sliced file is PETG; the order is PLA", "Agent prints turned off by Khelda",
      "Load PETG Sky blue (#7EC8E3) in an AMS: ORD-004 waits for it.", AGENT_PRINTS_OFF_TEXT, SPOOL_CHANGED_TEXT,
      "The spool for filament 1 on A1 Combo #2 is not the order's colour", "The printer did not report for a while",
      "Agent print PJ-3-mvx did not start on A1 Combo #1: The bridge did not pick it up within 5 min. Check the bed again and start again. Check the printer, then mark this task done and press Bed is empty.",
    ];
    expect(texts.filter((x) => tLib(id, x) === x)).toEqual([]);
    expect(AGENT_SPOOL_CHANGED_TEXT).toBe(SPOOL_CHANGED_TEXT); // the bridge and the app say the same
    expect(tLib(id, "Load PETG Sky blue (#7EC8E3) in an AMS: ORD-004 waits for it.")).toBe("Pasang PETG Biru langit (#7EC8E3) di AMS: ORD-004 menunggunya.");
  });

  it("the authority card with agent prints on and off", () => {
    for (const on of [false, true]) {
      store.setMeta("autoPrint", { on, by: "Khelda", at: new Date().toISOString() });
      const a = chiefAuthority();
      const texts = [...a.decidesAlone.map((d) => d.text), ...a.limitedByCode.map((l) => l.text), ...a.handedToPerson.flatMap((h) => [h.text, h.how])];
      expect(texts.filter((x) => tLib(id, x) === x), `on: ${on}`).toEqual([]);
    }
  });
});

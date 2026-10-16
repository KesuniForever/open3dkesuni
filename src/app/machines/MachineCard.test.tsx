import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySnapshot, hmsUrl, stageOf, type AmsTray, type PrinterSnapshot } from "@/lib/printer/bambu";
import { machineView } from "@/lib/machines";
import { makeT, type Locale } from "@/i18n/core";
import { ID } from "@/i18n/id";
import { LocaleProvider } from "@/i18n/client";
import type { OperatorTask, Printer } from "@/lib/types";
import type { PrinterLine } from "@/lib/printer/dispatch";
import { MachineCard } from "./MachinesBoard";
import { issueTexts } from "./issue-texts";

// The card as the server renders it first: what a person sees before any click.
const NOW = Date.parse("2026-10-15T12:00:00Z");
const AT = new Date(NOW - 4000).toISOString();
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const tray = (slot: number, type: string | null, color: string | null, bambu = false): AmsTray => ({
  ams: 0, slot, empty: !type, type, subBrand: bambu ? `${type} Basic` : null, infoIdx: null, color, colors: color ? [color] : [], remainPct: null, bambu,
});
const snap = (over: Partial<PrinterSnapshot>): PrinterSnapshot => ({ ...emptySnapshot(AT), state: "IDLE", ...over });
const ams = (trays: AmsTray[], activeSlot: number | null = null) => ({ trays, activeSlot, externalActive: false, humidity: null, lite: true });

const printing: Printer = {
  id: "a1", name: "A1 Combo #1", lastSeen: AT, currentOrderId: "ORD-001",
  snapshot: snap({
    state: "RUNNING", percent: 45, layer: 120, totalLayers: 260, remainingMin: 65, jobName: "ORD-001 Lamp shade", stage: stageOf("RUNNING", [2, 0], 0),
    nozzleTemp: 219.6, nozzleTarget: 220, bedTemp: 65, bedTarget: 65, speedLevel: 2, speedPct: 100, light: "on", sdcard: true, wifiDbm: -65,
    nozzle: { diameter: "0.4", type: "stainless_steel" }, firmware: { product: "Bambu Lab A1", ota: "01.08.01.00", ams: "00.00.08.15" },
    ams: ams([tray(0, "PLA", "#FEC600", true), tray(1, null, null), tray(2, "PLA", "#C52C18"), tray(3, "PLA", "#C12E1F", true)], 0),
    externalSpool: { type: "PETG", color: "#FFFFFF" },
  }),
};
const faulty: Printer = {
  id: "a1-3", name: "A1 Combo #3", lastSeen: AT,
  snapshot: snap({
    // The new bridge reports stage null while idle (an older one leaves it out).
    stage: null, hms: [{ code: "HMS_0510_0400_0001_0044", severity: 1, url: hmsUrl("0510040000010044"), since: AT }], sdcard: true,
    ams: ams([tray(0, "PLA", "#000000"), tray(1, "PETG", "#0085D5"), tray(2, "PLA", "#FF6910"), tray(3, "PETG", "#FFFFFF")]),
  }),
};
const oldBridge: Printer = { id: "a1-2", name: "A1 Combo #2", lastSeen: AT, snapshot: snap({}) };
const task: OperatorTask = {
  id: "T-1", orderId: "printer:a1-3", kind: "check_printer", printerId: "a1-3", text: "A1 Combo #3 reports HMS_0510_0400_0001_0044 (fatal)", status: "open",
  createdBy: "agent", at: AT, errorCode: "HMS_0510_0400_0001_0044",
};

const card = (p: Printer, locale: Locale = "en") => text(renderToStaticMarkup(
  <LocaleProvider locale={locale}>
    <MachineCard p={p} v={machineView(p, NOW, makeT(locale, ID))} now={NOW} orders={{ "ORD-001": { label: "simulated", status: "IN_PRODUCTION" } }}
      tasks={[task]} texts={issueTexts([p], locale)} busy={false} note={null} onUnlink={() => {}} onClearBed={() => {}} onConfirmColors={() => {}} />
  </LocaleProvider>,
));

describe("My machines: one printer card", () => {
  it("a printing printer: what it does now, heater targets, the AMS spools and the people's controls", () => {
    const en = card(printing);
    expect(en).toMatch(/Doing now Printing/);
    expect(en).toMatch(/220 °C Nozzle target 220 °C/);
    expect(en).toMatch(/AMS lite Confirm colours 1 PLA Yellow 2 Empty 3 PLA Red 4 PLA Red Ext PETG White/);
    expect(en).toMatch(/Pause Stop .*Light off/);
    expect(en).toMatch(/Show camera/);
    expect(en).toMatch(/Speed Standard · 100%/);
    expect(en).toMatch(/Firmware 01\.08\.01\.00 · AMS 00\.00\.08\.15/);
    expect(en).not.toMatch(/Resume|Printer error/);
  });

  it("a fatal fault is a loud banner with Bambu's words, the guide link and its task", () => {
    const en = card(faulty);
    expect(en).toMatch(/Printer error fatal The firmware of AMS lite does not match the printer/i);
    expect(en).toMatch(/HMS_0510_0400_0001_0044 Open guide/);
    expect(en).toMatch(/Task open/);
    expect(renderToStaticMarkup(<LocaleProvider locale="en"><MachineCard p={faulty} v={machineView(faulty, NOW)} now={NOW} orders={{}} tasks={[]}
      texts={{}} busy={false} note={null} onUnlink={() => {}} onClearBed={() => {}} onConfirmColors={() => {}} /></LocaleProvider>))
      .toContain('href="https://e.bambulab.com/index.php?e=0510040000010044&amp;d=039&amp;s=device_hms&amp;lang=en"');
    // Idle: no pause or stop, only the light.
    expect(en).toMatch(/Light on/);
    expect(en).not.toMatch(/\bPause\b|\bStop\b/);
  });

  it("an older bridge (no AMS in its reports) says so instead of showing empty slots, and offers no controls", () => {
    expect(card(oldBridge)).toMatch(/AMS not reported yet\./);
    expect(card(oldBridge)).toMatch(/Controls need the new LAN bridge: restart it on the new code\./);
    expect(card(oldBridge)).not.toMatch(/Light on|Show camera/);
  });

  it("in Indonesian", () => {
    const idText = card(faulty, "id");
    expect(idText).toMatch(/Error printer fatal Firmware AMS lite tidak sesuai dengan printer/);
    expect(idText).toMatch(/Buka panduan/);
    expect(card(printing, "id")).toMatch(/Sedang dikerjakan Mencetak/);
    expect(card(printing, "id")).toMatch(/Jeda Hentikan .*Matikan lampu/);
  });
});

describe("My machines: agent prints on a card", () => {
  const idle: Printer = { id: "a1-2", name: "A1 Combo #2", lastSeen: AT, snapshot: snap({ sdcard: true, ams: ams([tray(0, "PLA", "#FEC600")]) }) };
  const agentCard = (p: Printer, agent: PrinterLine | null, agentOn: boolean, locale: Locale = "en") => text(renderToStaticMarkup(
    <LocaleProvider locale={locale}>
      <MachineCard p={p} v={machineView(p, NOW, makeT(locale, ID))} now={NOW} orders={{ "ORD-004": { label: "real", status: "PLAN_CHOSEN" } }}
        tasks={[]} texts={{}} agent={agent} agentOn={agentOn} busy={false} note={null} onUnlink={() => {}} onClearBed={() => {}} onConfirmColors={() => {}} />
    </LocaleProvider>,
  ));
  const waiting: PrinterLine = {
    printerId: "a1-2", why: { key: "Waiting for a person to confirm the bed is empty" }, next: { orderId: "ORD-004", what: "PLA Yellow", colours: [{ material: "PLA", name: "Yellow" }] },
    bed: null, jobOnItsWay: null,
  };

  it("names the next agent print, says why it waits, and offers 'Bed is empty' on an empty bed", () => {
    const en = agentCard(idle, waiting, true);
    expect(en).toMatch(/Next agent print ORD-004 · PLA Yellow Waiting for a person to confirm the bed is empty/);
    expect(en).toMatch(/Bed is empty/);
    expect(agentCard(idle, waiting, true, "id")).toMatch(/Cetak agen berikutnya ORD-004 · PLA Kuning Menunggu orang memastikan bed kosong/);
  });

  it("after a person's confirmation: 'the agent may print once', and no second button", () => {
    const en = agentCard(idle, { ...waiting, why: null, bed: { by: "Khelda", at: AT } }, true);
    expect(en).toMatch(/Bed Empty · agent may print once/);
    expect(en).not.toMatch(/Bed is empty/);
  });

  it("with agent prints off the card is as before: no agent line, no extra button", () => {
    const en = agentCard(idle, { ...waiting, why: { key: "Agent prints are off" } }, false);
    expect(en).not.toMatch(/Next agent print|Bed is empty/);
  });

  it("no new confirmation is asked for while an agent print is on its way", () => {
    expect(agentCard(idle, { ...waiting, jobOnItsWay: "PJ-1-x", why: { key: "A print job is on its way to the printer" } }, true)).not.toMatch(/Bed is empty/);
  });
});

import { describe, expect, it } from "vitest";
import { notReadyReason } from "./printer/actions";
import { emptySnapshot, type PrinterSnapshot } from "./printer/bambu";
import { ago, duration, isPrinterTask, lastBridgeReport, machineStats, machineView, NO_ORDER_PRINT, notReadyText, ONLINE_MS, temp } from "./machines";
import type { OperatorTask, Printer } from "./types";
import { makeT } from "@/i18n/core";
import idWords from "@/i18n/id/machines-capacity";

const NOW = Date.parse("2026-10-15T09:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const snap = (s: Partial<PrinterSnapshot>): PrinterSnapshot => ({ ...emptySnapshot(iso(5_000)), ...s });
const printer = (p: Partial<Printer> = {}): Printer => ({ id: "a1", name: "A1 Combo #1", lastSeen: iso(5_000), snapshot: snap({ state: "IDLE" }), ...p });

describe("machineView", () => {
  it("an idle printer that reported 5 s ago is online and ready", () => {
    const v = machineView(printer({ snapshot: snap({ state: "IDLE", nozzleTemp: 27.44, bedTemp: 28.9 }) }), NOW);
    expect(v).toMatchObject({ online: true, pill: { tone: "ok", text: "Online · Idle" }, nozzle: "27 °C", bed: "29 °C", progress: null, notReady: null });
    expect(v.lastReport).toBe("5 s ago");
  });

  it("idle zeros from the printer are not shown as a layer or time left", () => {
    const v = machineView(printer({ snapshot: snap({ state: "IDLE", layer: 0, totalLayers: 0, remainingMin: 0 }) }), NOW);
    expect(v.layer).toBe("—");
    expect(v.remaining).toBe("—");
  });

  it("a running print shows percent, layer and time left", () => {
    const v = machineView(printer({ currentOrderId: "ORD-7", snapshot: snap({ state: "RUNNING", percent: 45.8, layer: 12, totalLayers: 240, remainingMin: 65, jobName: "vase.3mf" }) }), NOW);
    expect(v.pill).toEqual({ tone: "busy", text: "Printing 45%" });
    expect(v.progress).toEqual({ percent: 45, paused: false });
    expect(v.layer).toBe("12 / 240");
    expect(v.remaining).toBe("1h 05m");
    expect(v.job).toEqual({ name: "vase.3mf", current: true });
    expect(v.orderId).toBe("ORD-7");
    expect(v.notReady).toBe("busy with ORD-7");
  });

  it("a pause with an error code shows the code the Bambu app uses", () => {
    const v = machineView(printer({ snapshot: snap({ state: "PAUSE", percent: 30, errorCode: 0x07008011 }) }), NOW);
    expect(v.pill).toEqual({ tone: "bad", text: "Error 0700-8011" });
    expect(v.progress?.paused).toBe(true);
    expect(v.errorCode).toBe("0700-8011");
  });

  it("a pause without an error is a warning, not an error", () => {
    expect(machineView(printer({ snapshot: snap({ state: "PAUSE", percent: 30 }) }), NOW).pill).toEqual({ tone: "warn", text: "Paused 30%" });
    // A person's pause (0300-8001) and a person's stop (0300-400C) are not errors either.
    expect(machineView(printer({ snapshot: snap({ state: "PAUSE", percent: 30, errorCode: 0x03008001 }) }), NOW).pill).toEqual({ tone: "warn", text: "Paused 30%" });
    expect(machineView(printer({ snapshot: snap({ state: "FAILED", percent: 30, errorCode: 0x0300400c }) }), NOW).pill).toEqual({ tone: "warn", text: "Print stopped" });
  });

  it("a fatal HMS is red and keeps the printer out of the ready count, even while idle", () => {
    const fatal = printer({ snapshot: snap({ state: "IDLE", hms: [{ code: "HMS_0510_0400_0001_0044", severity: 1, url: "", since: null }] }) });
    const v = machineView(fatal, NOW);
    expect(v.pill).toEqual({ tone: "bad", text: "Printer error" });
    expect(v.notReady).toBe("printer error HMS_0510_0400_0001_0044");
    expect(machineStats([fatal], NOW).ready).toBe(0);
    // A common (severity 3) one does not block.
    expect(machineView(printer({ snapshot: snap({ state: "IDLE", hms: [{ code: "HMS_0300_0100_0003_0001", severity: 3, url: "", since: null }] }) }), NOW).notReady).toBeNull();
  });

  it("no report for more than 2 minutes is offline, with when it was last seen", () => {
    const v = machineView(printer({ lastSeen: iso(5 * 60_000) }), NOW);
    expect(v.online).toBe(false);
    expect(v.pill).toEqual({ tone: "bad", text: "Offline · 5 min ago" });
  });

  it("a printer that never reported says so", () => {
    const v = machineView({ id: "a1-3", name: "A1 Combo #3" }, NOW);
    expect(v.pill).toEqual({ tone: "idle", text: "No report yet" });
    expect(v.lastReport).toBe("never");
    expect(v.nozzle).toBe("—");
  });

  it("a finished file while idle is the last job, not the current one", () => {
    expect(machineView(printer({ snapshot: snap({ state: "FINISH", jobName: "cup.3mf" }) }), NOW).job).toEqual({ name: "cup.3mf", current: false });
  });

  it("a bed holding a print without an order has no order link", () => {
    expect(machineView(printer({ bedOccupiedBy: NO_ORDER_PRINT }), NOW).bedHolds).toEqual({ orderId: null });
    expect(machineView(printer({ bedOccupiedBy: "ORD-2" }), NOW).bedHolds).toEqual({ orderId: "ORD-2" });
  });
});

describe("notReadyText agrees with the agent's notReadyReason", () => {
  const cases: Printer[] = [
    printer(),
    printer({ lastSeen: undefined }),
    printer({ lastSeen: iso(ONLINE_MS + 1_000) }),
    printer({ lastSeen: iso(ONLINE_MS - 1_000) }),
    printer({ currentOrderId: "ORD-1" }),
    printer({ bedOccupiedBy: "ORD-1" }),
    printer({ snapshot: snap({ state: "RUNNING" }) }),
    printer({ snapshot: snap({ state: "FINISH" }) }),
    printer({ snapshot: undefined }),
  ];
  it.each(cases.map((p, i) => [i, p] as const))("case %i", (_i, p) => {
    expect(notReadyText(p, NOW)).toBe(notReadyReason(p, NOW));
  });
});

describe("machineStats", () => {
  it("counts online, printing, paused, ready and beds to collect", () => {
    const s = machineStats([
      printer(),
      printer({ id: "a1-2", snapshot: snap({ state: "RUNNING", percent: 10 }) }),
      printer({ id: "a1-3", snapshot: snap({ state: "PAUSE" }), bedOccupiedBy: "ORD-1" }),
      printer({ id: "a1-4", lastSeen: iso(10 * 60_000), snapshot: snap({ state: "RUNNING" }) }),
    ], NOW);
    expect(s).toEqual({ total: 4, online: 3, printing: 1, paused: 1, ready: 1, bedsToCollect: 1 });
  });
});

describe("helpers", () => {
  it("formats durations, temperatures and ages", () => {
    expect(duration(42)).toBe("42 min");
    expect(duration(125, true)).toBe("2h 05m");
    expect(temp(null)).toBe("—");
    expect(ago(iso(3 * 3600_000), NOW)).toBe("3 h ago");
  });

  it("printer tasks are open filament and printer checks only", () => {
    const t = (kind: OperatorTask["kind"], status: OperatorTask["status"] = "open"): OperatorTask =>
      ({ id: "T", orderId: "ORD-1", kind, text: "", status, createdBy: "agent", at: iso(0) });
    expect([t("check_printer"), t("change_filament"), t("collect_and_qc"), t("check_printer", "done")].map(isPrinterTask))
      .toEqual([true, true, false, false]);
  });

  it("the bridge's last report is the newest printer report", () => {
    expect(lastBridgeReport([printer({ lastSeen: iso(60_000) }), printer({ lastSeen: iso(1_000) }), { id: "x", name: "x" }])).toBe(iso(1_000));
    expect(lastBridgeReport([])).toBeNull();
  });
});

describe("in Indonesian", () => {
  const t = makeT("id", idWords);

  it("a machine card gets its words from the page's t; numbers, ids and file names stay", () => {
    const v = machineView(printer({ currentOrderId: "ORD-7", snapshot: snap({ state: "RUNNING", percent: 45.8, remainingMin: 65, jobName: "vase.3mf" }) }), NOW, t);
    expect(v.pill).toEqual({ tone: "busy", text: "Mencetak 45%" });
    expect(v.lastReport).toBe("5 dtk lalu");
    expect(v.remaining).toBe("1j 05m");
    expect(v.notReady).toBe("sedang mengerjakan ORD-7");
    expect(v.job).toEqual({ name: "vase.3mf", current: true });
  });

  it("offline, a bed without an order, and a printer that never reported", () => {
    expect(machineView(printer({ lastSeen: iso(5 * 60_000) }), NOW, t).pill.text).toBe("Offline · 5 mnt lalu");
    expect(notReadyText(printer({ bedOccupiedBy: NO_ORDER_PRINT }), NOW, t)).toBe("bed masih berisi cetakan tanpa pesanan");
    expect(notReadyText(printer({ bedOccupiedBy: NO_ORDER_PRINT }), NOW)).toBe(`bed still holds the part of ${NO_ORDER_PRINT}`);
    expect(machineView({ id: "a1-3", name: "A1 Combo #3" }, NOW, t)).toMatchObject({ lastReport: "belum pernah", pill: { text: "Belum ada laporan" } });
  });
});

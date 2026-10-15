import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { buildCapacity, capacity, dueIn, fmtSpan, fmtWhen, formatters, nextCollect, HOUR, type CapacityInput } from "./capacity";
import type { Order, Printer, Quote } from "./types";
import type { PrinterSnapshot } from "./printer/bambu";
import { makeT } from "@/i18n/core";
import idWords from "@/i18n/id/machines-capacity";

// Thursday 15 Oct 2026, 15:00 WIB.
const NOW = Date.parse("2026-10-15T15:00:00+07:00");
const iso = (ms: number) => new Date(ms).toISOString();

const snap = (state: PrinterSnapshot["state"], extra: Partial<PrinterSnapshot> = {}, at = NOW): PrinterSnapshot => ({
  state, percent: 0, remainingMin: null, layer: null, totalLayers: null, jobName: null, errorCode: 0, nozzleTemp: null, bedTemp: null,
  at: iso(at), ...extra,
});
const printer = (id: string, extra: Partial<Printer> = {}, now = NOW): Printer => ({
  id, name: `Printer ${id}`, snapshot: snap("IDLE", {}, now), lastSeen: iso(now - 10_000), ...extra,
});
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, jobId: `J-${id}`, product: `Product ${id}`, quantity: 1, deadline: "2026-10-20", designVersion: "v1", mandateMicro: 1,
  status: "PLAN_CHOSEN", label: "real", chosenQuoteId: `Q-${id}`, ...extra,
});
const quote = (orderId: string, etaHours: number): Quote =>
  ({ id: `Q-${orderId}`, orderId, vendorId: "own", priceMicro: 1, etaHours, source: "own" });

function input(over: Partial<CapacityInput> = {}): CapacityInput {
  return { now: NOW, printers: [], orders: [], chosenQuotes: {}, printedOrderIds: new Set(), ...over };
}

describe("Jakarta time helpers", () => {
  it("knows when a person can collect a print (08:00-21:00 WIB)", () => {
    expect(nextCollect(Date.parse("2026-10-15T12:00:00+07:00"))).toBe(Date.parse("2026-10-15T12:00:00+07:00"));
    expect(nextCollect(Date.parse("2026-10-15T07:00:00+07:00"))).toBe(Date.parse("2026-10-15T08:00:00+07:00"));
    expect(nextCollect(Date.parse("2026-10-15T21:00:00+07:00"))).toBe(Date.parse("2026-10-16T08:00:00+07:00"));
    expect(nextCollect(Date.parse("2026-10-15T23:30:00+07:00"))).toBe(Date.parse("2026-10-16T08:00:00+07:00"));
  });

  it("formats times in WIB, in English", () => {
    expect(fmtWhen(NOW + HOUR, NOW)).toBe("Today 16:00");
    expect(fmtWhen(Date.parse("2026-10-16T08:00:00+07:00"), NOW)).toBe("Tomorrow 08:00");
    expect(fmtWhen(Date.parse("2026-10-18T09:30:00+07:00"), NOW)).toBe("Sun 18 Oct 09:30");
    expect(fmtSpan(45 * 60_000)).toBe("45 min");
    expect(fmtSpan(5 * HOUR)).toBe("5 h");
    expect(fmtSpan(76 * HOUR)).toBe("3 d 4 h");
  });

  it("says how far a deadline is in Jakarta days", () => {
    const end = (d: string) => Date.parse(`${d}T23:59:59+07:00`);
    expect(dueIn(end("2026-10-15"), NOW)).toBe("today");
    expect(dueIn(end("2026-10-16"), NOW)).toBe("tomorrow");
    expect(dueIn(end("2026-10-19"), NOW)).toBe("in 4 d");
    expect(dueIn(end("2026-10-08"), NOW)).toBe("7 d late");
    expect(dueIn(end("2026-10-14"), NOW)).toBe("1 d late");
    expect(dueIn(null, NOW)).toBe("no valid deadline");
  });
});

describe("capacity board", () => {
  it("covers 7 days from today (Jakarta) and marks now on today", () => {
    const c = buildCapacity(input());
    expect(c.days.map((d) => d.key)).toEqual(["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]);
    expect(c.days[0]).toMatchObject({ weekday: "Thu", date: "15", month: "Oct", isToday: true, nowPct: 62.5 });
    expect(c.days[1].nowPct).toBeNull();
    expect(c.windowEnd - c.windowStart).toBe(7 * 24 * HOUR);
  });

  it("a ready printer is free from now to the end of the window", () => {
    const c = buildCapacity(input({ printers: [printer("a1")] }));
    expect(c.lanes[0]).toMatchObject({ status: "ready", reason: null, freeFrom: NOW, freeHours: 7 * 24 - 15 });
    expect(c.days[0].freeHours).toBe(9);
    expect(c.days[1].freeHours).toBe(24);
    expect(c.days[0].cells.a1[0]).toMatchObject({ kind: "free", left: 62.5, width: 37.5 });
  });

  it("a printing printer is busy until its own estimate, from the time of its last report", () => {
    const p = printer("a1", { currentOrderId: "ORD-9", snapshot: snap("RUNNING", { percent: 40.4, remainingMin: 70 }, NOW - 10 * 60_000) });
    const l = buildCapacity(input({ printers: [p] })).lanes[0];
    expect(l).toMatchObject({ status: "printing", percent: 40, finishAt: NOW + HOUR, finishKnown: true, orderId: "ORD-9", freeFrom: NOW + HOUR });
    expect(l.segments[0]).toMatchObject({ kind: "busy", from: NOW, to: NOW + HOUR, text: "ORD-9 · 40%", orderId: "ORD-9" });
    expect(l.freeHours).toBe(7 * 24 - 16);
  });

  it("a print that ends at night blocks the printer until someone collects it at 08:00", () => {
    const p = printer("a1", { snapshot: snap("RUNNING", { percent: 10, remainingMin: 8 * 60 }) });
    const c = buildCapacity(input({ printers: [p] }));
    const l = c.lanes[0];
    const eight = Date.parse("2026-10-16T08:00:00+07:00");
    expect(l.segments.map((s) => s.kind)).toEqual(["busy", "wait", "free"]);
    expect(l.segments[1]).toMatchObject({ from: NOW + 8 * HOUR, to: eight });
    expect(l.freeFrom).toBe(eight);
    expect(c.days[0].freeHours).toBe(0);
    expect(c.days[1].freeHours).toBe(16);
    // Today: 15 h already past, 8 h printing + 1 h waiting = 9 h booked. Tomorrow: 8 h waiting, 16 h free.
    expect(c.days[0].load).toEqual({ free: 0, booked: 9, unavailable: 15 });
    expect(c.days[1].load).toEqual({ free: 16, booked: 8, unavailable: 0 });
    // Each block is cut per day and labelled once: a short label on its widest piece when no piece is wide enough.
    expect(c.days[0].cells.a1.map((x) => [x.kind, x.text])).toEqual([["busy", "10%"], ["wait", ""]]);
    expect(c.days[1].cells.a1[0]).toMatchObject({ kind: "wait", left: 0, text: "Bed" });
  });

  it("an offline printer has no free time and is not counted online", () => {
    const c = buildCapacity(input({ printers: [printer("a1", { lastSeen: iso(NOW - 10 * 60_000) }), printer("a1-2")] }));
    expect(c.lanes[0]).toMatchObject({ status: "offline", freeHours: 0, freeFrom: null });
    expect(c.days[1].load).toEqual({ free: 24, booked: 0, unavailable: 24 });
    // Today only 37.5% of the day is left, so the full label goes on tomorrow, the first piece wide enough.
    expect(c.days[0].cells.a1[0].text).toBe("");
    expect(c.days[1].cells.a1[0].text).toBe("Offline");
    expect(c.days[2].cells.a1[0].text).toBe("");
    expect(c.stats).toMatchObject({ printers: 2, online: 1, printingNow: 0 });
    expect(c.rules).toMatchObject({ total: 2, online: 1, emptyBed: 1, idle: 1, ready: 1 });
  });

  it("a full bed at night waits for the morning; a linked printer is held", () => {
    const night = Date.parse("2026-10-15T22:00:00+07:00");
    const c = buildCapacity(input({
      now: night,
      printers: [printer("a1", { bedOccupiedBy: "ORD-1" }, night), printer("a1-2", { currentOrderId: "ORD-2" }, night)],
    }));
    expect(c.lanes[0]).toMatchObject({ status: "bed_full", freeFrom: Date.parse("2026-10-16T08:00:00+07:00") });
    expect(c.lanes[0].reason).toContain("bed still holds");
    expect(c.lanes[1]).toMatchObject({ status: "held", freeHours: 0, freeFrom: null });
    expect(c.rules).toMatchObject({ emptyBed: 1, idle: 1, ready: 0 });
  });
});

describe("deadlines", () => {
  const orders: Order[] = [
    order("LATE", { deadline: "2026-10-14", status: "IN_PRODUCTION" }),
    order("RISK", { deadline: "2026-10-16" }),            // 48 h ETA, due tomorrow 23:59: start-by has passed
    order("TIGHT", { deadline: "2026-10-17" }),           // 48 h ETA: start by Thu 23:59, under a day away
    order("OK", { deadline: "2026-10-25" }),              // after the window
    order("NEW", { deadline: "2026-10-18", status: "CREATED", chosenQuoteId: undefined }),
    order("DONE", { deadline: "2026-10-19", status: "IN_PRODUCTION" }),
    order("SIM", { deadline: "2026-10-19", label: "simulated" }),
    order("PAID", { deadline: "2026-10-16", status: "PAID" }),
  ];
  const quotes = Object.fromEntries(["LATE", "RISK", "TIGHT", "OK", "DONE", "SIM"].map((id) => [id, quote(id, id === "OK" ? 24 : 48)]));
  const c = buildCapacity(input({ orders, chosenQuotes: quotes, printedOrderIds: new Set(["DONE"]) }));
  const state = (id: string) => c.deadlines.find((d) => d.orderId === id)?.state;

  it("lists open orders by deadline, without finished ones", () => {
    expect(c.deadlines.map((d) => d.orderId)).toEqual(["LATE", "RISK", "TIGHT", "NEW", "DONE", "SIM", "OK"]);
  });

  it("flags overdue, at risk, tight, on track, no plan and printed", () => {
    expect(state("LATE")).toBe("overdue");
    expect(state("RISK")).toBe("at_risk");
    expect(state("TIGHT")).toBe("tight");
    expect(state("OK")).toBe("on_track");
    expect(state("NEW")).toBe("no_plan");
    expect(state("DONE")).toBe("printed");
    expect(c.deadlines.find((d) => d.orderId === "TIGHT")?.startBy).toBe(Date.parse("2026-10-17T23:59:59+07:00") - 48 * HOUR);
  });

  it("puts overdue orders on today and the rest on their day", () => {
    expect(c.days[0].due.map((d) => d.orderId)).toEqual(["LATE"]);
    expect(c.days[1].due.map((d) => d.orderId)).toEqual(["RISK"]);
    expect(c.days[4].due.map((d) => d.orderId)).toEqual(["DONE", "SIM"]);
    expect(c.dueLater).toBe(1);
  });

  it("never adds simulated hours to real booked hours", () => {
    // Real: LATE (in production) 48 + RISK 48 + TIGHT 48 = 144. OK starts after the window, NEW has no plan, DONE is printed.
    expect(c.stats.bookedHoursReal).toBe(144);
    expect(c.stats.bookedHoursSimulated).toBe(48);
    expect(c.stats.nextReal?.orderId).toBe("LATE");
    expect(c.stats).toMatchObject({ openReal: 6, openSimulated: 1 });
  });

  it("tracks a partner order's deadline but books none of Kesuni's printer hours", () => {
    const partnerQuote = (id: string, etaHours: number): Quote => ({ ...quote(id, etaHours), vendorId: "partner-a", source: "partner" });
    const x = buildCapacity(input({
      orders: [
        order("P1", { deadline: "2026-10-19" }),                               // 72 h partner ETA: start by Fri 23:59
        order("P2", { deadline: "2026-10-16", status: "IN_PRODUCTION" }),
        order("P3", { deadline: "2026-10-16" }),                               // 72 h ETA, due tomorrow: start-by has passed
        order("OWN", { deadline: "2026-10-20" }),
      ],
      chosenQuotes: { P1: partnerQuote("P1", 72), P2: partnerQuote("P2", 48), P3: partnerQuote("P3", 72), OWN: quote("OWN", 24) },
    }));
    const d = (id: string) => x.deadlines.find((i) => i.orderId === id);
    expect(d("P1")).toMatchObject({ partner: true, needsPrinter: false, state: "on_track", etaHours: 72 });
    expect(d("P1")?.startBy).toBe(Date.parse("2026-10-19T23:59:59+07:00") - 72 * HOUR);
    expect(d("P2")).toMatchObject({ partner: true, needsPrinter: false, state: "on_track" });
    expect(d("P3")).toMatchObject({ partner: true, state: "at_risk" });
    expect(d("OWN")).toMatchObject({ partner: false, needsPrinter: true });
    // Only the own plan counts as booked printer time.
    expect(x.stats.bookedHoursReal).toBe(24);
  });

  it("uses the printer's own estimate for an order already printing", () => {
    const p = printer("a1", { currentOrderId: "X", snapshot: snap("RUNNING", { percent: 5, remainingMin: 20 * 60 }) });
    const x = buildCapacity(input({
      printers: [p], orders: [order("X", { deadline: "2026-10-15", status: "IN_PRODUCTION" })], chosenQuotes: { X: quote("X", 4) },
    }));
    expect(x.deadlines[0]).toMatchObject({ state: "at_risk", printerId: "a1" });
  });
});

describe("capacity() from the store", () => {
  beforeEach(() => store.resetDb());

  it("reads printers, orders and chosen quotes; the seeded demo order stays simulated", () => {
    store.savePrinter(printer("a1", {}, Date.now()));
    const o = store.getOrder("ORD-001")!;
    store.saveOrder({ ...o, status: "PLAN_CHOSEN", chosenQuoteId: "Q-own" });
    const c = capacity();
    expect(c.lanes).toHaveLength(1);
    expect(c.deadlines[0]).toMatchObject({ orderId: "ORD-001", real: false, etaHours: 48, needsPrinter: true });
    expect(c.stats.bookedHoursReal).toBe(0);
    expect(c.stats.nextReal).toBeNull();
  });
});

describe("in Indonesian", () => {
  const f = formatters("id", makeT("id", idWords));

  it("dates, deadline words and Today/Tomorrow; the time keeps 24 h with a colon", () => {
    expect(f.day(Date.parse("2026-10-18T09:30:00+07:00"))).toBe("Min 18 Okt");
    expect(f.when(NOW + HOUR, NOW)).toBe("Hari ini 16:00");
    expect(f.when(Date.parse("2026-10-16T08:00:00+07:00"), NOW)).toBe("Besok 08:00");
    const end = (d: string) => Date.parse(`${d}T23:59:59+07:00`);
    expect(f.dueIn(end("2026-10-08"), NOW)).toBe("telat 7 hari");
    expect(f.dueIn(end("2026-10-19"), NOW)).toBe("4 hari lagi");
    expect([f.weekday(NOW), f.month(NOW)]).toEqual(["Kam", "Okt"]);
  });

  it("the English formatters are the default", () => {
    const en = formatters();
    expect(en.day(NOW)).toBe("Thu 15 Oct");
    expect(en.when(NOW + HOUR, NOW)).toBe(fmtWhen(NOW + HOUR, NOW));
    expect(en.dueIn(null, NOW)).toBe("no valid deadline");
  });

  it("board blocks and the not-ready reason carry keys the page can translate", () => {
    // Paused for 20 h from 15:00: today's piece is too narrow, so tomorrow's piece gets the full label.
    const paused = printer("a1", { currentOrderId: "ORD-1", snapshot: snap("PAUSE", { percent: 30, remainingMin: 20 * 60 }) });
    const cell = buildCapacity(input({ printers: [paused] })).days[1].cells.a1[0];
    expect(cell).toMatchObject({ kind: "paused", text: "Paused · ORD-1" });
    expect(f.t(cell.label!.key, cell.label!.vars)).toBe("Dijeda · ORD-1");

    const p = printer("a1", { bedOccupiedBy: "ORD-1" }, Date.parse("2026-10-15T22:00:00+07:00"));
    const c = buildCapacity(input({ now: Date.parse("2026-10-15T22:00:00+07:00"), printers: [p] }));
    const why = c.lanes[0].why!;
    expect(f.t(why.key, why.vars)).toBe("bed masih berisi hasil cetak ORD-1");
    expect(c.lanes[0].reason).toBe("bed still holds the part of ORD-1");
  });
});

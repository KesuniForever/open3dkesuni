import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { chooseQuote } from "../actions";
import { choosePrinter, clearBed, completeTask, ingestReport, linkPrinter } from "./actions";
import { detectEvents, mergeReport, type PrinterSnapshot } from "./bambu";
import { POST as report } from "@/app/api/printers/report/route";

const ORDER = "ORD-001";
let snap: PrinterSnapshot | undefined;
let t = 0;
/** Simulate the bridge: merge a raw Bambu message, detect events, send to the app. */
function push(print: Record<string, unknown>) {
  const next = mergeReport(snap, { print }, new Date(Date.UTC(2026, 9, 5, 10, 0, t++)).toISOString())!;
  const events = detectEvents(snap, next);
  snap = next;
  return ingestReport("a1", next, events);
}

beforeEach(() => {
  store.resetDb();
  snap = undefined;
  chooseQuote(ORDER, "Q-own", "agent", "within budget");
});

describe("printer -> evidence and operator tasks", () => {
  it("records device evidence for the linked order and moves it into production", () => {
    expect(linkPrinter("a1", ORDER).ok).toBe(true);
    push({ gcode_state: "IDLE", mc_percent: 0 });
    push({ gcode_state: "RUNNING", mc_percent: 1, subtask_name: "clicker_aini" });
    push({ mc_percent: 55 });

    expect(store.getOrder(ORDER)!.status).toBe("IN_PRODUCTION");
    const ev = store.listEvidence(ORDER);
    expect(ev.every((e) => e.label === "device")).toBe(true);
    expect(ev.map((e) => e.note)).toEqual([
      "A1 Combo #1: mulai mencetak (clicker_aini)",
      "A1 Combo #1: progres 25%",
      "A1 Combo #1: progres 50%",
    ]);
  });

  it("filament runout creates a task; resuming closes it; finishing asks for collection and QC", () => {
    linkPrinter("a1", ORDER);
    push({ gcode_state: "RUNNING", mc_percent: 60 });
    push({ gcode_state: "PAUSE", print_error: 0x07008011 });
    let tasks = store.listTasks(ORDER);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "change_filament", status: "open", createdBy: "agent" });
    expect(tasks[0].text).toContain("0700-8011");

    push({ gcode_state: "RUNNING", print_error: 0 });
    expect(store.listTasks(ORDER)[0].status).toBe("done");

    push({ gcode_state: "FINISH", mc_percent: 100 });
    tasks = store.listTasks(ORDER);
    expect(tasks[1]).toMatchObject({ kind: "collect_and_qc", status: "open" });
    // finished print never counts as QC, and the printer is freed
    expect(store.listEvidence(ORDER).some((e) => e.kind === "qc")).toBe(false);
    expect(store.getOrder(ORDER)!.status).toBe("IN_PRODUCTION");
    expect(store.getPrinter("a1")!.currentOrderId).toBeUndefined();

    // the bed holds the part until the collect task is done
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);
    expect(linkPrinter("a1", ORDER).ok).toBe(false);
    expect(completeTask(tasks[1].id, "Khelda").ok).toBe(true);
    expect(store.getTask(tasks[1].id)!.status).toBe("done");
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBeUndefined();
  });

  it("an unlinked printer only updates its status, never an order", () => {
    push({ gcode_state: "IDLE" });
    push({ gcode_state: "RUNNING", mc_percent: 30 });
    expect(store.getPrinter("a1")!.snapshot!.state).toBe("RUNNING");
    expect(store.listEvidence(ORDER)).toHaveLength(0);
  });

  it("cannot link a printer before a plan is chosen", () => {
    store.saveOrder({ ...store.getOrder(ORDER)!, status: "CREATED" });
    expect(linkPrinter("a1", ORDER).ok).toBe(false);
  });
});

describe("several printers", () => {
  const report = (id: string, print: Record<string, unknown>, prev?: PrinterSnapshot) => {
    const next = mergeReport(prev, { print }, new Date().toISOString())!;
    return { next, r: ingestReport(id, next, detectEvents(prev, next)) };
  };

  it("the agent picks a ready printer and explains the others", () => {
    report("a1", { gcode_state: "RUNNING", mc_percent: 50 });          // busy printing
    report("a1-2", { gcode_state: "IDLE", mc_percent: 0 });            // ready
    store.savePrinter({ ...store.getPrinter("a1-3") ?? { id: "a1-3", name: "A1 Combo #3" }, lastSeen: "2026-01-01T00:00:00Z" }); // offline
    const r = choosePrinter(ORDER);
    expect(r.ok && r.printer.id).toBe("a1-2");
    expect(r.ok && r.reasons.join(" | ")).toMatch(/A1 Combo #1: printer state is RUNNING.*A1 Combo #2: ready.*A1 Combo #3: offline/);
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ tool: "choose_printer", ok: true });
  });

  it("escalates to a person when no printer is ready", () => {
    report("a1", { gcode_state: "RUNNING", mc_percent: 10 });
    const r = choosePrinter(ORDER);
    expect(r.ok).toBe(false);
    expect(store.listTasks(ORDER)[0]).toMatchObject({ kind: "check_printer", status: "open" });
  });

  it("a failed print suggests rerouting to a ready printer", () => {
    report("a1-2", { gcode_state: "IDLE" });
    linkPrinter("a1", ORDER);
    const { next } = report("a1", { gcode_state: "RUNNING", mc_percent: 30 });
    report("a1", { gcode_state: "FAILED", print_error: 0x0300400c }, next);
    const task = store.listTasks(ORDER).find((t) => t.kind === "reprint")!;
    expect(task.text).toContain("A1 Combo #2 (siap, bed kosong)");
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);
  });

  it("warns when a print starts on a bed that still holds a part", () => {
    store.savePrinter({ id: "a1", name: "A1 Combo #1", bedOccupiedBy: ORDER });
    const { next } = report("a1", { gcode_state: "IDLE" });
    report("a1", { gcode_state: "RUNNING", mc_percent: 1 }, next);
    expect(store.listTasks(ORDER).some((t) => t.kind === "check_printer" && t.text.startsWith("PERIKSA SEKARANG"))).toBe(true);
  });
});

describe("bed state without an order", () => {
  it("a print sent straight from the slicer still marks the bed as holding a part", () => {
    const first = mergeReport(undefined, { print: { gcode_state: "RUNNING", mc_percent: 90 } }, new Date().toISOString())!;
    ingestReport("a1-2", first, []);
    const next = mergeReport(first, { print: { gcode_state: "FINISH", mc_percent: 100 } }, new Date().toISOString())!;
    ingestReport("a1-2", next, detectEvents(first, next));
    expect(store.getPrinter("a1-2")!.bedOccupiedBy).toBe("a print without an order");
  });

  it("a printer first seen in FINISH is assumed to still hold its part", () => {
    const s = mergeReport(undefined, { print: { gcode_state: "FINISH", mc_percent: 100 } }, new Date().toISOString())!;
    ingestReport("a1", s, []);
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBeTruthy();
    // after a person clears it, later FINISH reports do not mark it again
    expect(clearBed("a1", "Khelda").ok).toBe(true);
    ingestReport("a1", { ...s, at: new Date().toISOString() }, []);
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBeUndefined();
  });
});

describe("bridge endpoint", () => {
  const body = { printerId: "a1", snapshot: { state: "RUNNING", percent: 10, at: "2026-10-05T10:00:00Z" }, events: [] };
  const req = (auth?: string) => new Request("http://x/api/printers/report", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
  });
  afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });

  it("rejects calls without the bridge token", async () => {
    process.env.PRINTER_BRIDGE_TOKEN = "s3cret-token";
    expect((await report(req())).status).toBe(401);
    expect((await report(req("Bearer wrong-token!"))).status).toBe(401);
    expect((await report(req("Bearer s3cret-token"))).status).toBe(200);
  });

  it("is off when no token is configured", async () => {
    expect((await report(req("Bearer anything"))).status).toBe(503);
  });
});

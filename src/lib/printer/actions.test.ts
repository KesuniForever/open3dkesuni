import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { chooseQuote } from "../actions";
import { choosePrinter, clearBed, completeTask, confirmColors, ingestReport, linkPrinter } from "./actions";
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
      "A1 Combo #1: started printing (clicker_aini)",
      "A1 Combo #1: progress 25%",
      "A1 Combo #1: progress 50%",
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
    report("a1", { gcode_state: "FAILED", print_error: 0x03004000 }, next);
    const task = store.listTasks(ORDER).find((t) => t.kind === "reprint")!;
    expect(task.text).toContain("A1 Combo #2 (ready, bed empty)");
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);
  });

  it("a person's Stop is no failure: only the bed to clear, no reroute", () => {
    report("a1-2", { gcode_state: "IDLE" });
    linkPrinter("a1", ORDER);
    const { next } = report("a1", { gcode_state: "RUNNING", mc_percent: 30 });
    report("a1", { gcode_state: "FAILED", print_error: 0x0300400c }, next);
    const task = store.listTasks(ORDER).find((t) => t.kind === "reprint")!;
    expect(task.text).toBe("A1 Combo #1: a person stopped the print at 30%. Clear the bed, then decide what happens with the order.");
    expect(store.listLog(ORDER).some((l) => l.tool === "suggest_reroute")).toBe(false);
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);
  });

  it("a person's pause opens no task; a fault pause asks a person to look; out of filament asks for a spool", () => {
    linkPrinter("a1", ORDER);
    let { next } = report("a1", { gcode_state: "RUNNING", mc_percent: 20, stg: [2, 0], stg_cur: 0 });
    ({ next } = report("a1", { gcode_state: "PAUSE", stg_cur: 16, print_error: 0x03008001 }, next));
    expect(store.listTasks(ORDER)).toEqual([]);
    ({ next } = report("a1", { gcode_state: "RUNNING", stg_cur: 0, print_error: 0 }, next));
    ({ next } = report("a1", { gcode_state: "PAUSE", stg_cur: 17 }, next));
    expect(store.listTasks(ORDER)).toMatchObject([{ kind: "check_printer", status: "open",
      text: "A1 Combo #1 paused at 20% (Pause (front cover fall off)). Check the printer screen and fix the cause, then resume the print." }]);
    ({ next } = report("a1", { gcode_state: "RUNNING", stg_cur: 0 }, next));
    expect(store.listTasks(ORDER)[0]).toMatchObject({ status: "done", doneBy: "A1 Combo #1 (resumed printing)" });
    report("a1", { gcode_state: "PAUSE", stg_cur: 6, print_error: 0x07008011 }, next);
    expect(store.listTasks(ORDER).at(-1)!.kind).toBe("change_filament");
  });

  it("warns when a print starts on a bed that still holds a part", () => {
    store.savePrinter({ id: "a1", name: "A1 Combo #1", bedOccupiedBy: ORDER });
    const { next } = report("a1", { gcode_state: "IDLE" });
    report("a1", { gcode_state: "RUNNING", mc_percent: 1 }, next);
    expect(store.listTasks(ORDER).some((t) => t.kind === "check_printer" && t.text.startsWith("CHECK NOW"))).toBe(true);
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

describe("printer faults become one operator task each", () => {
  // Printer #3 on 15 Oct 2026: a fatal HMS, the AMS lite firmware does not match the printer.
  const FATAL = { attr: 84935680, code: 65604, timestamp: 1792049055 };
  let s3: PrinterSnapshot | undefined;
  const send = (print: Record<string, unknown>) => {
    const next = mergeReport(s3, { print }, new Date().toISOString())!;
    const r = ingestReport("a1-3", next, detectEvents(s3, next));
    s3 = next;
    return r;
  };
  const faultTasks = () => store.listAllTasks().filter((t) => t.errorCode);
  beforeEach(() => { s3 = undefined; });

  it("raises a fault the printer shows when it connects, with Bambu's words and the link, once", () => {
    send({ gcode_state: "IDLE", hms: [FATAL] });
    send({ gcode_state: "IDLE", hms: [FATAL], wifi_signal: "-70dBm" });
    send({ wifi_signal: "-72dBm" });
    const tasks = faultTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ orderId: "printer:a1-3", printerId: "a1-3", kind: "check_printer", status: "open", errorCode: "HMS_0510_0400_0001_0044" });
    expect(tasks[0].text).toBe("A1 Combo #3 reports HMS_0510_0400_0001_0044 (fatal): The firmware of AMS lite does not match the printer. " +
      "Please upgrade it on the \"Firmware\" page. Check the printer before the next print. " +
      "https://e.bambulab.com/index.php?e=0510040000010044&d=039&s=device_hms&lang=en");
  });

  it("closes the task by itself when the printer stops reporting the fault", () => {
    send({ gcode_state: "IDLE", hms: [FATAL] });
    send({ hms: [] });
    expect(faultTasks()[0]).toMatchObject({ status: "done", doneBy: "A1 Combo #3 (no longer reported)" });
  });

  it("a person may close it; it comes back only when the fault clears and returns", () => {
    send({ gcode_state: "IDLE", hms: [FATAL] });
    completeTask(faultTasks()[0].id, "Khelda");
    send({ hms: [FATAL] });
    expect(faultTasks().filter((t) => t.status === "open")).toHaveLength(0);
    send({ hms: [] });
    send({ hms: [FATAL] });
    expect(faultTasks().filter((t) => t.status === "open")).toHaveLength(1);
  });

  it("an older bridge without the HMS list neither raises nor clears HMS faults", () => {
    send({ gcode_state: "IDLE", hms: [FATAL] });
    const { hms: _gone, ...old } = store.getPrinter("a1-3")!.snapshot!;
    void _gone;
    ingestReport("a1-3", { ...old, at: new Date().toISOString() }, []);
    expect(faultTasks()[0].status).toBe("open");
  });

  it("a print error on an unlinked printer is raised; a person's cancel is not", () => {
    send({ gcode_state: "RUNNING", mc_percent: 10 });
    send({ gcode_state: "FAILED", print_error: 0x0300400c });
    expect(faultTasks()).toHaveLength(0);
    send({ gcode_state: "IDLE", print_error: 0x0500400a });
    expect(faultTasks()[0]).toMatchObject({ errorCode: "0500-400A" });
    expect(faultTasks()[0].text).toMatch(/^A1 Combo #3 reports error 0500-400A: .+ Check the printer before the next print\. https:\/\/wiki\.bambulab\.com\/en\/hms\/home$/);
  });

  it("a filament runout on a linked order keeps its one change-filament task, and the fault is logged as evidence", () => {
    linkPrinter("a1", ORDER);
    push({ gcode_state: "RUNNING", mc_percent: 60, hms: [] });
    push({ gcode_state: "PAUSE", print_error: 0x07008011, stg: [0, 6], stg_cur: 6 });
    expect(store.listTasks(ORDER)).toHaveLength(1);
    expect(store.getPrinter("a1")!.snapshot!.stage).toEqual({ code: 6, key: "Paused (filament ran out)", needsPerson: true });
    expect(store.listEvidence(ORDER).map((e) => e.note)).toContain("A1 Combo #1: reports 0700-8011");
  });
});

describe("the colours on a printer, checked by a person", () => {
  it("stores who checked and what was loaded then", () => {
    push({ gcode_state: "IDLE", ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "000000FF" }] }] } });
    expect(confirmColors("a1", "")).toMatchObject({ ok: false, status: 400 });
    const r = confirmColors("a1", "Khelda");
    expect(r.ok && r.printer.colorsChecked).toMatchObject({ by: "Khelda", key: "0:PLA:#000000" });
    store.savePrinter({ id: "a1-9", name: "x" });
    expect(confirmColors("a1-9", "Khelda")).toMatchObject({ ok: false, status: 409 });
  });

  it("a printer that first reports UNKNOWN (firmware only) and then FINISH still holds its part", () => {
    const fw = mergeReport(undefined, { info: { command: "get_version", module: [{ name: "ota", sw_ver: "01.08.01.00" }] } }, new Date().toISOString())!;
    ingestReport("a1-2", fw, []);
    const s = mergeReport(fw, { print: { gcode_state: "FINISH", mc_percent: 100 } }, new Date().toISOString())!;
    ingestReport("a1-2", s, detectEvents(fw, s));
    expect(store.getPrinter("a1-2")!.bedOccupiedBy).toBe("a print without an order");
  });
});

describe("bridge endpoint with the full snapshot", () => {
  afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
  it("stores stage, AMS and faults sent by the new bridge, and raises the fault", async () => {
    process.env.PRINTER_BRIDGE_TOKEN = "s3cret-token";
    const snapshot = mergeReport(undefined, { print: { gcode_state: "IDLE", hms: [{ attr: 84935680, code: 65604 }], sdcard: true,
      ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FF6910FF" }] }] } } }, new Date().toISOString())!;
    const res = await report(new Request("http://x/api/printers/report", {
      method: "POST", body: JSON.stringify({ printerId: "a1-3", snapshot, events: detectEvents(undefined, snapshot) }),
      headers: { "content-type": "application/json", authorization: "Bearer s3cret-token" },
    }));
    expect(res.status).toBe(200);
    expect(store.getPrinter("a1-3")!.snapshot).toMatchObject({ sdcard: true, ams: { trays: [{ type: "PLA", color: "#FF6910" }] } });
    expect(store.listAllTasks().filter((t) => t.errorCode === "HMS_0510_0400_0001_0044")).toHaveLength(1);
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { chooseQuote } from "../actions";
import { addAttachment, setFileStore, type FileStore } from "../files";
import { fake3mf } from "../threemf.test-helper";
import { cancelSliceJob, resetSlicerSeen, sliceJobSource, sliceQueue, storeSliceResult, updateSliceItem } from "../slicing";
import { clearBed, completeTask, confirmColors, ingestReport } from "./actions";
import { detectEvents, mergeReport, type PrinterSnapshot } from "./bambu";
import { canStartPrint } from "./control";
import { agentStartReasons, bridgeQueue, cancelPrintJob, createAgentPrintJob, createPrintJob, expireStale, updateQueueItem } from "./jobs";
import { autoPrintFeed, planDispatch, runDispatch, setAutoPrint, setOrderRuns } from "./dispatch";
import { bedState } from "./autoprint-rules";
import { SLICER_NAME } from "../slice-rules";
import { linkPrinter } from "./actions";
import { pairing, SPOOL_CHANGED_TEXT } from "./autoprint";
import type { Attachment, Escrow, Order, PrintJob } from "../types";

const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const ORDER = "ORD-001";
const STL = new TextEncoder().encode("solid cube\nfacet normal 0 0 1\nendsolid cube\n");

// The studio's A1s as they report: idle, SD card in, 0.4 mm, AMS lite with yellow PLA (slot 1), slot 2 empty, red PLA
// (slot 3), white PETG (slot 4). Generic spools: a person confirms the colours.
const IDLE = {
  gcode_state: "IDLE", mc_percent: 0, print_error: 0, stg: [], stg_cur: 0, sdcard: true, home_flag: 847201688, hms: [], nozzle_diameter: "0.4",
  ams: { ams: [{ id: "0", info: "1002", tray: [
    { id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "" }, { id: "1" },
    { id: "2", tray_type: "PLA", tray_color: "C52C18FF", tray_sub_brands: "" }, { id: "3", tray_type: "PETG", tray_color: "FFFFFFFF", tray_sub_brands: "" },
  ] }], tray_now: "255" },
};
const snaps: Record<string, PrinterSnapshot | undefined> = {};
let clock = 0;
const tick = (ms = 1000) => (clock += ms);
/** A printer report as the bridge sends it (with the events it detects), at the test clock. */
function report(id: string, print: Record<string, unknown>) {
  const next = mergeReport(snaps[id], { print }, new Date(clock).toISOString())!;
  const events = detectEvents(snaps[id], next);
  snaps[id] = next;
  const r = ingestReport(id, next, events, clock);
  if (!r.ok) throw new Error(r.error);
  return r;
}
const funded = (orderId = ORDER): Escrow => ({
  orderId, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
  state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date(clock).toISOString(),
});
const order = (id = ORDER) => store.getOrder(id)!;
const save = (o: Order) => store.saveOrder(o);
/** A real order, paid, in production. */
function realPaid(id = ORDER) {
  save({ ...order(id), label: "real" });
  store.saveEscrow(funded(id));
}
async function rawUpload(filename: string, bytes: Uint8Array, orderId = ORDER, uploadedBy = "Khelda"): Promise<Attachment> {
  const r = await addAttachment(orderId, { kind: "design", filename, bytes, uploadedBy });
  if (!r.ok) throw new Error(r.error);
  return r.attachment;
}
/**
 * A design file. A .gcode.3mf is made as the studio PC makes it: the order's STL is uploaded first and a done slice
 * links the two (the agent prints only those). rawUpload: a sliced file a person uploaded (the agent never prints it).
 */
async function upload(filename: string, bytes: Uint8Array, orderId = ORDER): Promise<Attachment> {
  if (!filename.toLowerCase().endsWith(".gcode.3mf")) return rawUpload(filename, bytes, orderId);
  const src = await rawUpload(filename.replace(/\.gcode\.3mf$/i, ".stl"), STL, orderId);
  const a = await rawUpload(filename, bytes, orderId, SLICER_NAME);
  const f = a.parsed3mf?.plates[0]?.filaments[0];
  const at = new Date(clock).toISOString();
  store.insertSliceJob({
    id: store.nextSliceJobId(), orderId, attachmentId: src.id, sourceName: src.filename, mode: "mesh", printerId: "a1", tray: 0,
    material: (f?.type.toUpperCase() === "PETG" ? "PETG" : "PLA"), color: f?.color ?? "#FCE300", quality: "standard", infillPct: 20, supports: "auto",
    key: `${src.id}|test`, state: "done", actor: "person", by: "Khelda", createdAt: at, updatedAt: at, resultAttachmentId: a.id,
  });
  return a;
}
/** A sliced A1 file in one colour (yellow PLA by default, near slot 1's spool). */
const sliced = (color = "#FCE300", type = "PLA", over: Partial<Parameters<typeof fake3mf>[0]> = {}) =>
  fake3mf({ projectColours: [color], projectTypes: [type], plates: [{ index: 1, filaments: [{ id: 1, type, color, usedG: 9.8 }] }], ...over });
const on = () => { const r = setAutoPrint({ on: true, by: "Khelda", confirm: true }, clock); if (!r.ok) throw new Error(r.error); return r; };
const bed = (printerId = "a1", by = "Khelda") => { tick(); const r = clearBed(printerId, by, { via: "button" }, tick()); if (!r.ok) throw new Error(r.error); return r; };
const run = (trigger: Parameters<typeof runDispatch>[0]["trigger"] = "heartbeat") => runDispatch({ trigger, now: tick() });
const agentJobs = () => store.listPrintJobs().filter((j) => j.actor === "agent");
let file: Attachment;

/** Everything in place for one agent print on printer #1: switch on, colours checked, a paid real order with a sliced
 *  yellow PLA file, and Khelda's "Bed is empty". The next dispatch starts it. */
async function ready() {
  realPaid();
  file = await upload("Benchy.gcode.3mf", sliced());
  on();
  bed("a1");
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  setFileStore(files);
  resetSlicerSeen();
  for (const k of Object.keys(snaps)) delete snaps[k];
  delete process.env.KESUNI_AUTO_PRINT;
  clock = Date.now();
  chooseQuote(ORDER, "Q-own", "agent", "within budget"); // PLAN_CHOSEN
  report("a1", IDLE);
  expect(confirmColors("a1", "Khelda").ok).toBe(true);
});
afterEach(() => { delete process.env.KESUNI_AUTO_PRINT; });
afterAll(() => setFileStore(undefined));

describe("agent prints: the happy path", () => {
  it("switch on + a person's 'Bed is empty' + a paid order with a sliced file: ONE print, by the agent, logged", async () => {
    await ready();
    const r = run("bed_cleared");
    expect(r.started).toHaveLength(1);
    const job = store.getPrintJob(r.started[0].jobId)!;
    expect(job).toMatchObject({
      orderId: ORDER, printerId: "a1", attachmentId: file.id, plate: 1, amsMapping: [0], state: "queued", actor: "agent", by: "agent",
      bedConfirmedBy: "Khelda", options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true },
    });
    expect(job.why?.join(" ")).toMatch(/Bed confirmed empty by Khelda/);
    const p = store.getPrinter("a1")!;
    expect(p.currentOrderId).toBe(ORDER);
    expect(p.bedCheck).toMatchObject({ id: job.bedCheckId, by: "Khelda", usedBy: job.id });
    expect(bedState(p, clock)).toEqual({ ok: false, reason: "used" });
    const log = store.listLog(ORDER).find((e) => e.tool === "auto_print")!;
    expect(log).toMatchObject({ actor: "agent", ok: true, input: { printerId: "a1", bedConfirmedBy: "Khelda", trigger: "bed_cleared" }, output: { jobId: job.id } });
    // The bridge sees who confirmed the bed.
    expect(bridgeQueue(null, clock).jobs[0]).toMatchObject({ id: job.id, actor: "agent", bedConfirmedBy: "Khelda", by: "agent" });
    // No second print from the same confirmation, however often the dispatcher runs.
    for (const trigger of ["printer_report", "heartbeat", "bed_cleared", "chief"] as const) expect(run(trigger).started).toEqual([]);
    expect(agentJobs()).toHaveLength(1);
  });

  it("planDispatch is a preview: it writes nothing and says what comes next", async () => {
    await ready();
    const count = () => ["print_jobs", "agent_log", "tasks", "slice_jobs", "printers", "meta"].map((t) => JSON.stringify(t === "meta" ? store.getMeta("autoPrintLast") ?? null : t)).join();
    const before = [store.listPrintJobs().length, store.listLogByTools(["auto_print_wait", "auto_print"], 100).length, store.listAllTasks().length, count()];
    const plan = planDispatch(tick());
    expect(plan.orders[ORDER]).toMatchObject({ action: "print", printerId: "a1", why: { key: "Next: print on {printer}", vars: { printer: "A1 Combo #1" } } });
    expect(plan.printers.a1).toMatchObject({ why: null, next: { orderId: ORDER, colours: [{ material: "PLA", name: "Yellow" }] }, bed: { by: "Khelda" } });
    expect([store.listPrintJobs().length, store.listLogByTools(["auto_print_wait", "auto_print"], 100).length, store.listAllTasks().length, count()]).toEqual(before);
  });
});

describe("agent prints: each gate alone blocks a start", () => {
  type Case = { name: string; breakIt: () => void | Promise<void>; reason: RegExp };
  const cases: Case[] = [
    { name: "the switch is off", breakIt: () => { setAutoPrint({ on: false, by: "Khelda", confirm: true }, clock); }, reason: /^Agent prints are off$/ },
    { name: "KESUNI_AUTO_PRINT=off on the server", breakIt: () => { process.env.KESUNI_AUTO_PRINT = "off"; }, reason: /^Agent prints are off$/ },
    { name: "no person confirmed the bed", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, bedCheck: undefined }); }, reason: /confirm the bed is empty/ },
    { name: "the bed holds a print", breakIt: () => { store.savePrinter({ ...store.getPrinter("a1")!, bedOccupiedBy: "a print without an order" }); }, reason: /holds a finished print/ },
    { name: "the confirmation was used", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, bedCheck: { ...p.bedCheck!, usedBy: "PJ-0", usedAt: p.bedCheck!.at } }); }, reason: /confirm the bed is empty/ },
    { name: "the confirmation was voided", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, bedCheck: { ...p.bedCheck!, voidedAt: p.bedCheck!.at } }); }, reason: /confirm the bed is empty/ },
    { name: "a print ended after the confirmation", breakIt: () => { store.savePrinter({ ...store.getPrinter("a1")!, lastPrintEndAt: new Date(tick()).toISOString() }); }, reason: /confirm the bed is empty/ },
    { name: "a print started after the confirmation", breakIt: () => { store.savePrinter({ ...store.getPrinter("a1")!, lastPrintStartAt: new Date(tick()).toISOString() }); }, reason: /confirm the bed is empty/ },
    { name: "the confirmation is older than 2 h", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, bedCheck: { ...p.bedCheck!, at: new Date(clock - 3 * 3600_000).toISOString() } }); }, reason: /more than 2 h ago/ },
    { name: "the 'person' who confirmed is the agent", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, bedCheck: { ...p.bedCheck!, by: "agent" } }); }, reason: /confirm the bed is empty/ },
    { name: "the printer is offline", breakIt: () => { tick(61_000); }, reason: /No report in the last minute/ },
    { name: "the printer is printing", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, snapshot: { ...p.snapshot!, state: "RUNNING" } }); }, reason: /The printer is printing/ },
    { name: "the last print failed", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, snapshot: { ...p.snapshot!, state: "FAILED" } }); }, reason: /The last print failed: a person starts the next one/ },
    { name: "a print job is on its way", breakIt: () => {
      const j: PrintJob = { id: "PJ-9-x", printerId: "a1", attachmentId: "x", plate: 1, fileName: "x.gcode.3mf", amsMapping: [0], options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state: "uploading", by: "Aini", createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString() };
      store.savePrintJob(j);
    }, reason: /A print job is on its way/ },
    { name: "a fatal printer fault", breakIt: () => { report("a1", { hms: [{ attr: 84935680, code: 65604 }] }); }, reason: /Printer error HMS_0510_0400_0001_0044/ },
    { name: "a printer warning (no person to tick it)", breakIt: () => { const p = store.getPrinter("a1")!; store.savePrinter({ ...p, snapshot: { ...p.snapshot!, hms: [{ code: "HMS_0300_0100_0003_0001", severity: 3, url: "", since: null }] } }); }, reason: /Printer warning HMS_0300_0100_0003_0001/ },
    { name: "no SD card", breakIt: () => { report("a1", { sdcard: false }); }, reason: /No microSD card/ },
    { name: "nobody confirmed the colours since the spools changed", breakIt: () => { report("a1", { ams: { ams: [{ id: "0", tray: [{ id: "1", tray_type: "PLA", tray_color: "000000FF" }] }] } }); }, reason: /Nobody confirmed the colours/ },
    { name: "the printer is linked to another order", breakIt: () => { store.savePrinter({ ...store.getPrinter("a1")!, currentOrderId: "ORD-777" }); }, reason: /Linked to ORD-777/ },
    { name: "the order is not in production yet", breakIt: () => { save({ ...order(), status: "CREATED" }); }, reason: /Order is CREATED/ },
    { name: "the order already has its QC evidence", breakIt: () => { save({ ...order(), status: "EVIDENCE_SUBMITTED" }); }, reason: /Order is EVIDENCE_SUBMITTED/ },
    { name: "a real order is not paid", breakIt: () => { store.saveEscrow({ ...funded(), state: "AWAITING_DEPOSIT" }); }, reason: /Waiting for the customer's payment/ },
    { name: "a simulated order nobody set runs for", breakIt: () => { save({ ...order(), label: "simulated" }); }, reason: /Not a real order/ },
    { name: "a person set 0 runs", breakIt: () => { save({ ...order(), autoPrint: { runsNeeded: 0, by: "Khelda", at: new Date(clock).toISOString() } }); }, reason: /set 0 runs/ },
    { name: "all runs are printed", breakIt: () => {
      store.savePrintJob({ id: "PJ-8-x", orderId: ORDER, printerId: "a1-2", attachmentId: file.id, plate: 1, fileName: "x.gcode.3mf", amsMapping: [0], options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state: "done", by: "Aini", createdAt: new Date(clock - 3600_000).toISOString(), updatedAt: new Date(clock - 60_000).toISOString() });
    }, reason: /All runs printed \(1 of 1\)/ },
    { name: "an open reprint task", breakIt: () => { store.saveTask({ id: "T-r", orderId: ORDER, kind: "reprint", text: "Print failed", status: "open", createdBy: "agent", at: new Date(clock).toISOString() }); }, reason: /a person decides on a reprint/ },
    { name: "an open 'agent print did not start' task", breakIt: () => { store.saveTask({ id: "T-f", orderId: ORDER, kind: "check_printer", text: "x", status: "open", createdBy: "agent", at: new Date(clock).toISOString(), key: "autoprint:failed:PJ-1" }); }, reason: /last print did not start/ },
    { name: "the file is sliced for another printer", breakIt: async () => { store.deleteAttachment(file.id, [], { orderId: ORDER, actor: "human", tool: "remove_file", input: {}, ok: true, output: {}, at: new Date(clock).toISOString() }); file = await upload("p1s.gcode.3mf", sliced("#FCE300", "PLA", { modelId: "C12" })); }, reason: /not for the Bambu Lab A1/ },
    { name: "the file is for a 0.6 mm nozzle", breakIt: async () => { store.deleteAttachment(file.id, [], { orderId: ORDER, actor: "human", tool: "remove_file", input: {}, ok: true, output: {}, at: new Date(clock).toISOString() }); file = await upload("06.gcode.3mf", sliced("#FCE300", "PLA", { nozzle: "0.6" })); }, reason: /not for the 0\.4 mm nozzle/ },
    { name: "the file has two plates", breakIt: async () => {
      store.deleteAttachment(file.id, [], { orderId: ORDER, actor: "human", tool: "remove_file", input: {}, ok: true, output: {}, at: new Date(clock).toISOString() });
      file = await upload("two.gcode.3mf", fake3mf({ projectColours: ["#FCE300"], plates: [1, 2].map((index) => ({ index, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 5 }] })) }));
    }, reason: /has 2 plates/ },
    { name: "the file is not in the customer's colour", breakIt: () => { save({ ...order(), preferredColors: [{ type: "PLA", color: "#C52C18", name: "Red" }] }); }, reason: /colours are not the order's/ },
    { name: "no spool of the file's colour is loaded", breakIt: async () => { store.deleteAttachment(file.id, [], { orderId: ORDER, actor: "human", tool: "remove_file", input: {}, ok: true, output: {}, at: new Date(clock).toISOString() }); file = await upload("black.gcode.3mf", sliced("#000000", "PETG")); }, reason: /No spool of PETG Black/ },
  ];

  it.each(cases)("$name", async ({ breakIt, reason }) => {
    await ready();
    expect(agentStartReasons({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, clock + 1)).toEqual([]);
    await breakIt();
    const now = tick();
    const reasons = agentStartReasons({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, now);
    expect(reasons.some((r) => reason.test(r)), reasons.join(" | ")).toBe(true);
    expect(createAgentPrintJob({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, now)).toMatchObject({ ok: false, status: 409 });
    expect(run().started).toEqual([]);
    expect(agentJobs()).toEqual([]);
  });

  it("the enforcer re-checks the gates itself: a caller cannot skip one", async () => {
    await ready();
    store.saveEscrow({ ...funded(), state: "AWAITING_DEPOSIT" });
    const r = createAgentPrintJob({ printerId: "a1", orderId: ORDER, attachmentId: file.id, why: ["I really want to"] }, tick());
    expect(r).toMatchObject({ ok: false, error: "The agent cannot start this print", reasons: ["Waiting for the customer's payment"] });
    expect(store.listPrintJobs()).toEqual([]);
    expect(store.getPrinter("a1")!.bedCheck!.usedBy).toBeUndefined();
  });
});

describe("agent prints: never two from one confirmation, never two on one printer", () => {
  it("the dispatcher run twice in a row (two triggers at once) queues one print", async () => {
    await ready();
    const now = tick();
    const a = runDispatch({ trigger: "bed_cleared", now });
    const b = runDispatch({ trigger: "printer_report", now });
    expect(a.started.length + b.started.length).toBe(1);
    expect(agentJobs()).toHaveLength(1);
  });

  it("the enforcer called twice for the same confirmation: the second is refused", async () => {
    await ready();
    const now = tick();
    expect(createAgentPrintJob({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, now).ok).toBe(true);
    expect(createAgentPrintJob({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, now)).toMatchObject({ ok: false, status: 409 });
    expect(agentJobs()).toHaveLength(1);
  });

  it("the database refuses a second row with the same confirmation, and a second agent job on one printer", async () => {
    await ready();
    const first = run().started[0];
    const job = store.getPrintJob(first.jobId)!;
    expect(() => store.savePrintJob({ ...job, id: "PJ-99-x", printerId: "a1-2" })).toThrow(/constraint/i);
    expect(() => store.savePrintJob({ ...job, id: "PJ-98-x", bedCheckId: "BC-other" })).toThrow(/constraint/i);
    // A person's own job on that printer is not an agent job: the index does not apply to it.
    expect(() => store.savePrintJob({ ...job, id: "PJ-97-x", actor: undefined, bedCheckId: undefined, by: "Aini" })).not.toThrow();
    expect(store.isUniqueViolation(new Error("UNIQUE constraint failed: index 'x'"))).toBe(true);
  });

  it("a dispatch already running in this process makes a second one return at once", async () => {
    await ready();
    const g = (globalThis as unknown as { __kesuniDispatch: { running: boolean } }).__kesuniDispatch;
    g.running = true;
    try {
      expect(run()).toMatchObject({ on: true, busy: true, started: [] });
    } finally {
      g.running = false;
    }
    expect(run().started).toHaveLength(1);
  });

  it("one order needing two runs prints one at a time, even with two beds confirmed", async () => {
    report("a1-2", IDLE);
    confirmColors("a1-2", "Khelda");
    await ready();
    save({ ...order(), autoPrint: { runsNeeded: 2, by: "Khelda", at: new Date(clock).toISOString() } });
    bed("a1-2");
    expect(run().started).toHaveLength(1);
    expect(run().started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why).toEqual({ key: "Run {n} of {needed} is on the printer", vars: { n: 1, needed: 2 } });
  });

  it("a person's own print uses the confirmation: the agent gets no print from it", async () => {
    await ready();
    const r = createPrintJob({ printerId: "a1", attachmentId: file.id, plate: 1, amsMapping: [0], by: "Aini", bedEmptyConfirmed: true, personPresent: true }, tick());
    expect(r.ok).toBe(true);
    const job = r.ok ? r.job : undefined!;
    expect(job).toMatchObject({ bedCheckId: store.getPrinter("a1")!.bedCheck!.id });
    expect(store.getPrinter("a1")!.bedCheck!.usedBy).toBe(job.id);
    tick(61_000);
    report("a1", {});
    expect(run().started).toEqual([]);
  });
});

describe("the bed: confirmations, starts and ends", () => {
  it("'Bed is empty' needs a person's name, is logged, and is voided by any print that starts before it is used", () => {
    expect(clearBed("a1", "agent")).toMatchObject({ ok: false, error: "A person's name is required" });
    expect(clearBed("a1", " ")).toMatchObject({ ok: false });
    const r = clearBed("a1", "Khelda", {}, tick());
    expect(r.ok && r.bedCheck).toMatchObject({ by: "Khelda", via: "button" });
    expect(store.listLog("printer:a1").at(-1)).toMatchObject({ actor: "human", tool: "clear_bed", input: { printerId: "a1", by: "Khelda" } });
    tick();
    report("a1", { gcode_state: "PREPARE" }); // started on the printer itself
    const p = store.getPrinter("a1")!;
    expect(p.bedCheck).toMatchObject({ voidReason: "A print started on the printer" });
    expect(p.lastPrintStartAt).toBe(new Date(clock).toISOString());
  });

  it("the app sees a print end even when the bridge missed it (restarted mid-print): bed full, task raised", () => {
    tick();
    report("a1", { gcode_state: "RUNNING", mc_percent: 40 });
    // The bridge restarts: its first report has no earlier snapshot, so it detects no event.
    tick();
    const next = mergeReport(undefined, { print: { ...IDLE, gcode_state: "FINISH", mc_percent: 100 } }, new Date(clock).toISOString())!;
    snaps.a1 = next;
    ingestReport("a1", next, [], clock);
    const p = store.getPrinter("a1")!;
    expect(p.bedOccupiedBy).toBe("a print without an order");
    expect(p.lastPrintEndAt).toBe(new Date(clock).toISOString());
    expect(bedState(p, clock)).toEqual({ ok: false, reason: "occupied" });
  });

  it("a collect task marked done frees the bed but never lets the agent print; an older task of that printer frees nothing", () => {
    store.savePrinter({ ...store.getPrinter("a1")!, bedOccupiedBy: ORDER });
    const task = (id: string) => store.saveTask({ id, orderId: ORDER, kind: "collect_and_qc", printerId: "a1", text: "Collect", status: "open", createdBy: "agent", at: new Date(clock).toISOString() });
    task("T-1"); // part 1, left open after a "Bed is empty"
    task("T-2"); // part 2, on the bed now
    // Closing the old task (QC of part 1) does not touch the bed that holds part 2.
    expect(completeTask("T-1", "Aini", tick())).toEqual({ ok: true, task: expect.objectContaining({ id: "T-1", status: "done" }) });
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);
    const r = completeTask("T-2", "Aini", tick());
    expect(r).toMatchObject({ ok: true, bedCleared: "a1" });
    const p = store.getPrinter("a1")!;
    expect(p.bedOccupiedBy).toBeUndefined();
    expect(bedState(p, clock)).toEqual({ ok: false, reason: "none" }); // no grant: only "Bed is empty" gives one
  });

  it("a new 'Bed is empty' never replaces the confirmation a print on its way uses", async () => {
    await ready();
    const id = run().started[0].jobId;
    const used = store.getPrinter("a1")!.bedCheck!.id;
    clearBed("a1", "Aini", {}, tick());
    expect(store.getPrinter("a1")!.bedCheck!.id).toBe(used);
    expect(updateQueueItem(id, { state: "uploading" }, tick()).ok).toBe(true);
    expect(updateQueueItem(id, { state: "sent" }, tick())).toMatchObject({ ok: true, job: { state: "sent" } });
  });
});

describe("the bridge's side of an agent print", () => {
  it("'sent' is refused once the switch is off or the confirmation is no longer the one the print used", async () => {
    await ready();
    const id = run().started[0].jobId;
    updateQueueItem(id, { state: "uploading" }, tick());
    store.setMeta("autoPrint", { on: false, by: "Khelda", at: new Date(clock).toISOString() }); // switched off without the cancel
    expect(updateQueueItem(id, { state: "sent" }, tick())).toMatchObject({ ok: false, error: "Agent prints were turned off: nothing was sent." });
    expect(store.getPrintJob(id)).toMatchObject({ state: "failed" });
    // One task for a person, and the order waits for it.
    const task = store.listOpenTasks().find((t) => t.key === `autoprint:failed:${id}`)!;
    expect(task.text).toMatch(new RegExp(`^Agent print ${id} did not start on A1 Combo #1: Agent prints were turned off: nothing was sent\\. Check the printer`));
    on();
    bed("a1");
    expect(run().started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("The agent's last print did not start: a person checks the printer (close its task)");
    completeTask(task.id, "Khelda", tick());
    expect(run().started).toHaveLength(1);
  });

  it("'sent' is refused when the confirmation was voided after the print was queued", async () => {
    await ready();
    const id = run().started[0].jobId;
    updateQueueItem(id, { state: "uploading" }, tick());
    const p = store.getPrinter("a1")!;
    store.savePrinter({ ...p, bedCheck: { ...p.bedCheck!, voidedAt: new Date(clock).toISOString() } });
    expect(updateQueueItem(id, { state: "sent" }, tick())).toMatchObject({ ok: false, error: expect.stringMatching(/no longer valid/) });
  });

  it("an agent print the bridge never picks up fails after 5 min with one task, never retried by itself", async () => {
    await ready();
    const id = run().started[0].jobId;
    tick(5 * 60_000 + 1000);
    expireStale(clock);
    expect(store.getPrintJob(id)!.state).toBe("failed");
    expect(store.listLog(ORDER).filter((e) => e.tool === "print_job").at(-1)).toMatchObject({ actor: "agent", ok: false });
    expireStale(tick());
    expect(store.listOpenTasks().filter((t) => t.key === `autoprint:failed:${id}`)).toHaveLength(1);
    report("a1", {});
    expect(run().started).toEqual([]);
  });

  it("canStartPrint as the agent: the person who confirmed the bed instead of a person at the printer; never after a failure", () => {
    const p = store.getPrinter("a1")!;
    const info = { sliced: true, printerModelId: "N2S", nozzle: "0.4", plates: [{ index: 1, predictionSec: 60, weightG: 1, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 1 }] }] };
    const job = { info, plate: 1, amsMapping: [0], options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, bedEmptyConfirmed: false, personPresent: false, by: "agent" };
    expect(canStartPrint(p, { ...job, actor: "agent", bedConfirmedBy: "Khelda" }, clock).reasons).toEqual([]);
    expect(canStartPrint(p, { ...job, actor: "agent", bedConfirmedBy: "Chief" }, clock).reasons).toEqual(["The agent prints only after a person confirmed the bed is empty"]);
    expect(canStartPrint(p, job, clock).reasons).toEqual(["A person's name is required", "A person must be at the printer when it starts", "A person must confirm the bed is empty and clean"]);
    const failed = { ...p, snapshot: { ...p.snapshot!, state: "FAILED" as const } };
    expect(canStartPrint(failed, { ...job, actor: "agent", bedConfirmedBy: "Khelda" }, clock).reasons).toEqual(["The last print failed: a person starts the next one"]);
  });
});

describe("the dispatcher's choices and reasons", () => {
  it("earliest deadline first; the other order waits for that printer", async () => {
    await ready();
    const other = { ...order(), id: "ORD-002", jobId: "JOB-002", deadline: "2026-01-01", label: "real" as const };
    save(other);
    store.saveEscrow(funded("ORD-002"));
    await upload("Other.gcode.3mf", sliced(), "ORD-002");
    const r = run();
    expect(r.started).toEqual([{ jobId: expect.any(String), orderId: "ORD-002", printerId: "a1" }]);
    expect(r.plan!.orders[ORDER].why).toEqual({ key: "Waiting for {printer}: {order} goes first", vars: { printer: "A1 Combo #1", order: "ORD-002" } });
  });

  it("a printer a person linked to an order is kept for that order", async () => {
    await ready();
    store.savePrinter({ ...store.getPrinter("a1")!, currentOrderId: "ORD-002" });
    const r = run();
    expect(r.started).toEqual([]);
    expect(r.plan!.orders[ORDER].why).toEqual({ key: "Waiting for {printer}: {order} goes first", vars: { printer: "A1 Combo #1", order: "ORD-002" } });
    expect(r.plan!.printers.a1.why).toEqual({ key: "Linked to {order}", vars: { order: "ORD-002" } });
  });

  it("waiting for a person's bed confirmation is said per printer, and the printer card names the next order", async () => {
    realPaid();
    file = await upload("Benchy.gcode.3mf", sliced());
    on();
    const plan = planDispatch(tick());
    expect(plan.orders[ORDER].why).toEqual({ key: "Waiting for a person to confirm the bed on {printer}", vars: { printer: "A1 Combo #1" } });
    expect(plan.printers.a1).toMatchObject({ why: { key: "Waiting for a person to confirm the bed is empty" }, next: { orderId: ORDER } });
  });

  it("a missing spool raises ONE 'Load ...' task, closed by code once the spool is loaded", async () => {
    realPaid();
    file = await upload("black.gcode.3mf", sliced("#000000", "PETG"));
    on();
    bed("a1");
    run();
    run();
    run();
    const tasks = store.listAllTasks().filter((t) => t.key === "autoprint:load:PETG:#000000");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: "change_filament", status: "open", orderId: ORDER, text: "Load PETG Black (#000000) in an AMS: ORD-001 waits for it." });
    // Someone loads a black PETG spool in slot 2 and confirms the colours: the task closes and the print can go.
    report("a1", { ams: { ams: [{ id: "0", tray: [{ id: "1", tray_type: "PETG", tray_color: "000000FF", tray_sub_brands: "" }] }] } });
    confirmColors("a1", "Khelda");
    const r = run();
    expect(store.getTask(tasks[0].id)).toMatchObject({ status: "done", doneBy: "A1 Combo #1 (spool loaded)" });
    expect(r.started).toHaveLength(1);
    expect(store.getPrintJob(r.started[0].jobId)!.amsMapping).toEqual([1]);
  });

  it("each order's reason is logged once when it changes, not on every report", async () => {
    realPaid();
    file = await upload("Benchy.gcode.3mf", sliced());
    on();
    run();
    run("printer_report");
    run("printer_report");
    const waits = store.listLog(ORDER).filter((e) => e.tool === "auto_print_wait");
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ actor: "agent", input: { key: "Waiting for a person to confirm the bed on {printer}" }, output: { text: "Waiting for a person to confirm the bed on A1 Combo #1" } });
    expect(autoPrintFeed(10).map((e) => e.tool)).toEqual(["auto_print_wait", "auto_print_switch"]);
  });

  it("with the switch off the dispatcher writes nothing", async () => {
    realPaid();
    file = await upload("Benchy.gcode.3mf", sliced());
    bed("a1");
    const before = store.listLogByTools(["auto_print", "auto_print_wait"], 50).length;
    expect(run()).toEqual({ on: false, trigger: "heartbeat", started: [], sliced: [] });
    expect(store.listLogByTools(["auto_print", "auto_print_wait"], 50).length).toBe(before);
    expect(store.getMeta("autoPrintLast")).toBeUndefined();
    expect(planDispatch(tick()).printers.a1.why).toEqual({ key: "Agent prints are off" });
  });
});

describe("what people set", () => {
  it("the switch needs a person's name and confirm: true; every change is logged; off cancels the agent's prints not yet sent", async () => {
    expect(setAutoPrint({ on: true, by: "Chief", confirm: true })).toMatchObject({ ok: false, error: "A person's name is required" });
    expect(setAutoPrint({ on: true, by: "Khelda" })).toMatchObject({ ok: false, error: "Confirm first" });
    expect(setAutoPrint({ on: "yes", by: "Khelda", confirm: true })).toMatchObject({ ok: false, error: "Say on: true or false" });
    await ready();
    const id = run().started[0].jobId;
    const off = setAutoPrint({ on: false, by: "Aini", confirm: true }, tick());
    expect(off).toMatchObject({ ok: true, cancelled: [id], setting: { on: false, by: "Aini" } });
    expect(store.getPrintJob(id)).toMatchObject({ state: "cancelled", error: "Agent prints turned off by Aini" });
    expect(store.listLog("studio").map((e) => [e.tool, e.actor, (e.input as { on: boolean }).on])).toEqual([
      ["auto_print_switch", "human", true], ["auto_print_switch", "human", false],
    ]);
    process.env.KESUNI_AUTO_PRINT = "off";
    expect(setAutoPrint({ on: true, by: "Khelda", confirm: true })).toMatchObject({ ok: false, status: 409 });
  });

  it("turning the switch on runs the dispatcher at once", async () => {
    realPaid();
    file = await upload("Benchy.gcode.3mf", sliced());
    bed("a1");
    const r = setAutoPrint({ on: true, by: "Khelda", confirm: true }, tick());
    expect(r.ok && r.dispatch?.started).toHaveLength(1);
  });

  it("runs: a person's name, 0 to 50; a simulated order prints only after a person set them", async () => {
    file = await upload("Benchy.gcode.3mf", sliced());
    on();
    bed("a1");
    expect(run().started).toEqual([]);
    expect(setOrderRuns(ORDER, { runsNeeded: 51, by: "Khelda" })).toMatchObject({ ok: false, error: "Runs must be a whole number from 0 to 50" });
    expect(setOrderRuns(ORDER, { runsNeeded: 1, by: "agent" })).toMatchObject({ ok: false, error: "A person's name is required" });
    const r = setOrderRuns(ORDER, { runsNeeded: "1", by: "Khelda" }, tick());
    expect(r.ok && r.order.autoPrint).toMatchObject({ runsNeeded: 1, by: "Khelda" });
    expect(r.ok && r.dispatch.started).toHaveLength(1);
    expect(store.listLog(ORDER).some((e) => e.tool === "auto_print_runs" && e.actor === "human")).toBe(true);
  });
});

describe("end to end, with a fake studio PC and a fake printer", () => {
  it("switch on -> bed confirmed -> the agent slices the STL -> prints -> finishes -> no second print until a person empties the bed", async () => {
    // A simulated order a person opted in for two prints, in the customer's colour: yellow PLA. Only an STL so far.
    save({ ...order(), preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }], autoPrint: { runsNeeded: 2, by: "Khelda", at: new Date(clock).toISOString() } });
    const stl = await upload("Kubus.stl", STL);
    sliceQueue(clock); // the studio PC's slicer polls: it is there

    // 1. Switch on: the dispatcher asks the studio PC for one slice at once (slicing needs no bed; printing does).
    const sw = on();
    expect(sw.dispatch?.started).toEqual([]);
    expect(sw.dispatch?.sliced).toHaveLength(1);
    const sj = store.getSliceJob(sw.dispatch!.sliced[0].sliceId)!;
    bed("a1");
    let r = run("bed_cleared");
    expect(r.started).toEqual([]);
    expect(r.sliced).toEqual([]);
    expect(sj).toMatchObject({ actor: "agent", by: "agent", attachmentId: stl.id, printerId: "a1", tray: 0, material: "PLA", color: "#FEC600", quality: "standard" });
    expect(run().sliced).toEqual([]); // asked once

    // 2. The fake studio PC takes it, downloads the STL and sends back an A1 file in the spool's colour.
    expect(sliceQueue(tick()).map((q) => q.id)).toEqual([sj.id]);
    expect(updateSliceItem(sj.id, { state: "slicing" }, tick()).ok).toBe(true);
    expect(sliceJobSource(sj.id).ok).toBe(true);
    const done = await storeSliceResult(sj.id, sliced("#FEC600"), { sliceMs: 900 }, tick());
    expect(done.ok).toBe(true);

    // 3. The slice arrived: the dispatcher starts the print with the confirmation Khelda gave.
    r = run("slice_done");
    expect(r.started).toHaveLength(1);
    const job = store.getPrintJob(r.started[0].jobId)!;
    expect(job).toMatchObject({ actor: "agent", attachmentId: done.ok ? done.attachment.id : "", amsMapping: [0], bedConfirmedBy: "Khelda" });

    // 4. The fake bridge carries it out and the printer prints it.
    expect(updateQueueItem(job.id, { state: "uploading" }, tick()).ok).toBe(true);
    expect(updateQueueItem(job.id, { state: "sent" }, tick()).ok).toBe(true);
    tick();
    report("a1", { gcode_state: "PREPARE" });
    tick();
    report("a1", { gcode_state: "RUNNING", mc_percent: 50 });
    expect(store.getPrintJob(job.id)!.state).toBe("printing");
    expect(run().started).toEqual([]); // busy printing
    tick(60_000);
    report("a1", { gcode_state: "FINISH", mc_percent: 100 });
    expect(store.getPrintJob(job.id)!.state).toBe("done");
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBe(ORDER);

    // 5. One run left, but the bed holds the first part: nothing starts, whatever triggers the dispatcher.
    for (const trigger of ["printer_report", "heartbeat", "chief", "slice_done"] as const) expect(run(trigger).started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why).toEqual({ key: "The bed of {printer} holds a finished print: a person empties it", vars: { printer: "A1 Combo #1" } });

    // 6. A person collects the part (the collect task): the bed is free but the agent still waits for "Bed is empty".
    const collect = store.listTasks(ORDER).find((t) => t.kind === "collect_and_qc" && t.status === "open")!;
    expect(completeTask(collect.id, "Aini", tick())).toMatchObject({ ok: true, bedCleared: "a1" });
    tick(61_000);
    report("a1", {});
    expect(run("task_done").started).toEqual([]);
    // Only now, with Aini's "Bed is empty", the agent prints run 2, and only once.
    bed("a1", "Aini");
    report("a1", {});
    r = run("bed_cleared");
    expect(r.started).toHaveLength(1);
    expect(store.getPrintJob(r.started[0].jobId)).toMatchObject({ bedConfirmedBy: "Aini" });
    expect(run().started).toEqual([]);
    expect(agentJobs()).toHaveLength(2);
    // Every step is in the decision log.
    expect(store.listLog(ORDER).filter((e) => e.actor === "agent").map((e) => e.tool)).toEqual(expect.arrayContaining(["slice_request", "slice_result", "auto_print"]));
  });

  it("an agent slice that failed is not asked again: a person slices it", async () => {
    save({ ...order(), label: "real", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    store.saveEscrow(funded());
    await upload("Kubus.stl", STL);
    sliceQueue(clock);
    const sj = on().dispatch!.sliced[0];
    updateSliceItem(sj.sliceId, { state: "slicing" }, tick());
    updateSliceItem(sj.sliceId, { state: "failed", error: "The model does not fit on the A1 bed" }, tick());
    sliceQueue(clock);
    expect(run().sliced).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("The agent's slice failed: a person slices it on the order page");
  });

  it("no slice while the studio PC's slicer is not seen, and none without exactly one colour", async () => {
    save({ ...order(), label: "real", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    store.saveEscrow(funded());
    await upload("Kubus.stl", STL);
    on();
    expect(run().plan!.orders[ORDER].why.key).toBe("Waiting for the studio PC's slicer (is the bridge running?)");
    save({ ...order(), preferredColors: [] });
    sliceQueue(clock);
    expect(run().plan!.orders[ORDER].why.key).toBe("Pick one colour on the order: the agent slices in one colour");
    expect(store.listSliceJobs()).toEqual([]);
  });
});

describe("cancelling", () => {
  it("a person can cancel an agent print before it reaches the printer; the confirmation stays used", async () => {
    await ready();
    const id = run().started[0].jobId;
    expect(cancelPrintJob(id, "Aini")).toMatchObject({ ok: true, job: { state: "cancelled" } });
    expect(store.getPrinter("a1")!.bedCheck!.usedBy).toBe(id);
    tick(61_000);
    report("a1", {});
    expect(run().started).toEqual([]);
  });
});

describe("review fixes: what the agent must never do", () => {
  /** A report from a bridge that sent no events (an old bridge, or one that missed them): the app must see it itself. */
  function quietReport(id: string, print: Record<string, unknown>) {
    const next = mergeReport(snaps[id], { print }, new Date(clock).toISOString())!;
    snaps[id] = next;
    const r = ingestReport(id, next, [], clock);
    if (!r.ok) throw new Error(r.error);
  }

  it("a print nobody saw running (IDLE -> FINISH) fills the bed and voids the unused confirmation", async () => {
    await ready();
    tick();
    quietReport("a1", { gcode_state: "FINISH", mc_percent: 100, subtask_name: "Printed from the printer screen" });
    const p = store.getPrinter("a1")!;
    expect(p.bedOccupiedBy).toBe("a print without an order");
    expect(p.bedCheck).toMatchObject({ voidReason: "A print ended on the printer" });
    expect(run().started).toEqual([]);
    // The bridge's own events say the same (detectEvents).
    expect(detectEvents(snaps.a1, { ...snaps.a1!, state: "FINISH" }).map((e) => e.kind)).toEqual([]);
    expect(detectEvents({ ...snaps.a1!, state: "IDLE" }, snaps.a1!).map((e) => e.kind)).toEqual(["finished"]);
  });

  it("a finished printer that names another job had a whole print unseen: bed full again, confirmation voided", async () => {
    await ready();
    quietReport("a1", { gcode_state: "FINISH", mc_percent: 100, subtask_name: "Job A" });
    bed("a1");
    expect(bedState(store.getPrinter("a1")!, clock).ok).toBe(true);
    tick();
    quietReport("a1", { gcode_state: "FINISH", mc_percent: 100, subtask_name: "Job B" });
    const p = store.getPrinter("a1")!;
    expect(p.bedOccupiedBy).toBeTruthy();
    expect(p.bedCheck?.voidedAt).toBeTruthy();
    expect(run().started).toEqual([]);
  });

  it("no report for more than 2 min after the bed was confirmed voids it; a confirmation given while the printer was quiet stays", async () => {
    await ready();
    tick(3 * 60_000);
    report("a1", {});
    expect(store.getPrinter("a1")!.bedCheck).toMatchObject({ voidReason: "The printer did not report for a while" });
    expect(run().started).toEqual([]);
    tick(3 * 60_000); // quiet again; a person confirms the bed now, then the reports come back
    bed("a1");
    report("a1", {});
    expect(store.getPrinter("a1")!.bedCheck?.voidedAt).toBeUndefined();
    expect(run().started).toHaveLength(1);
  });

  it("a print a person runs outside the website counts: never a second start while it prints or after it finished", async () => {
    await ready();
    // Printer #2, also ready, with its own "Bed is empty".
    report("a1-2", IDLE);
    expect(confirmColors("a1-2", "Khelda").ok).toBe(true);
    bed("a1-2");
    // A person prints the order from Bambu Studio on #1 and links #1 to it: no print job on the website.
    expect(linkPrinter("a1", ORDER).ok).toBe(true);
    report("a1", { gcode_state: "RUNNING", mc_percent: 10, subtask_name: "Benchy" });
    expect(run().started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("Run {n} of {needed} is on the printer");
    expect(store.getPrinter("a1")!.currentOrderId).toBe(ORDER); // never unlinked mid-print
    tick(60_000);
    report("a1", { gcode_state: "FINISH", mc_percent: 100 });
    const collect = store.listTasks(ORDER).find((t) => t.kind === "collect_and_qc")!;
    expect(collect).toBeTruthy();
    completeTask(collect.id, "Aini", tick());
    expect(run().started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why).toEqual({ key: "All runs printed ({done} of {needed})", vars: { done: 1, needed: 1 } });
  });

  it("a spool swapped while the agent's print uploads: 'sent' is refused, nothing reaches the printer", async () => {
    await ready();
    const id = run().started[0].jobId;
    expect(store.getPrintJob(id)!.expectedTrays).toEqual([{ tray: 0, type: "PLA", color: "#FEC600" }]);
    expect(bridgeQueue(null, clock).jobs[0]).toMatchObject({ id, expectedTrays: [{ tray: 0, type: "PLA", color: "#FEC600" }] });
    expect(updateQueueItem(id, { state: "uploading" }, tick()).ok).toBe(true);
    // Someone loads black PLA in slot 1 (the agent's own "Load ..." task, say).
    report("a1", { ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "000000FF", tray_sub_brands: "" }] }] } });
    expect(updateQueueItem(id, { state: "sent" }, tick())).toMatchObject({ ok: false, error: SPOOL_CHANGED_TEXT });
    expect(store.getPrintJob(id)!.state).toBe("failed");
    expect(store.listOpenTasks().filter((t) => t.key === `autoprint:failed:${id}`)).toHaveLength(1);
  });

  it("the spool must be near the customer's colour too, not only near the file's", async () => {
    await ready();
    save({ ...order(), preferredColors: [{ type: "PLA", color: "#FFFFFF", name: "White" }] });
    const r = pairing(store.getPrinter("a1")!, { attachment: file, info: file.parsed3mf!, plate: file.parsed3mf!.plates[0] }, ORDER, clock, "Khelda");
    expect(r.reasons).toContain("The spool for filament 1 on A1 Combo #1 is not the order's colour");
  });

  it("a sliced file someone uploaded is never printed by the agent (its G-code was never reviewed)", async () => {
    realPaid();
    file = await rawUpload("Customer.gcode.3mf", sliced());
    on();
    bed("a1");
    expect(run().started).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one");
    expect(agentStartReasons({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, clock))
      .toContain("The agent prints only files the studio PC sliced from an STL or OBJ: a person prints this one");
  });

  it("a newer design file makes the old sliced file out of date: the agent slices the new one", async () => {
    await ready();
    save({ ...order(), preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    const v2 = await rawUpload("Benchy v2.stl", STL);
    sliceQueue(clock);
    const r = run();
    expect(r.started).toEqual([]);
    expect(r.sliced).toHaveLength(1);
    expect(store.getSliceJob(r.sliced[0].sliceId)).toMatchObject({ attachmentId: v2.id, actor: "agent" });
    expect(agentStartReasons({ printerId: "a1", orderId: ORDER, attachmentId: file.id }, clock))
      .toContain("A newer design file is on the order: this sliced file is out of date");
  });

  it("an agent slice cancelled by the switch or lost by the studio PC is asked again, at most 3 times; a person's cancel is final", async () => {
    save({ ...order(), label: "real", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    store.saveEscrow(funded());
    await upload("Kubus.stl", STL);
    sliceQueue(clock);
    const first = on().dispatch!.sliced[0].sliceId;
    setAutoPrint({ on: false, by: "Khelda", confirm: true }, tick());
    expect(store.getSliceJob(first)).toMatchObject({ state: "cancelled", failKind: "switch" });
    sliceQueue(clock);
    const second = on().dispatch!.sliced[0].sliceId; // asked again
    updateSliceItem(second, { state: "slicing" }, tick());
    updateSliceItem(second, { state: "failed", error: "Could not download the model", kind: "studio" }, tick());
    sliceQueue(clock);
    const third = run().sliced[0].sliceId; // the studio PC was the problem: asked again
    updateSliceItem(third, { state: "slicing" }, tick());
    updateSliceItem(third, { state: "failed", error: "Could not upload the sliced file to the app", kind: "studio" }, tick());
    sliceQueue(clock);
    expect(run().sliced).toEqual([]); // three tries: a person slices it now
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("The agent's slice failed: a person slices it on the order page");
  });

  it("a person who cancels the agent's slice decides: the agent does not ask again", async () => {
    save({ ...order(), label: "real", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
    store.saveEscrow(funded());
    await upload("Kubus.stl", STL);
    sliceQueue(clock);
    const id = on().dispatch!.sliced[0].sliceId;
    expect(cancelSliceJob(id, "Aini", tick()).ok).toBe(true);
    sliceQueue(clock);
    expect(run().sliced).toEqual([]);
    expect(planDispatch(tick()).orders[ORDER].why.key).toBe("A person cancelled the agent's slice: a person slices it on the order page");
  });
});

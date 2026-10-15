import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "../store";
import { chooseQuote } from "../actions";
import { addAttachment, setFileStore, type FileStore } from "../files";
import { fake3mf } from "../threemf.test-helper";
import { ingestReport } from "./actions";
import { mergeReport, type PrinterSnapshot } from "./bambu";
import {
  bridgeQueue, cameraFrame, cancelPrintJob, clearCameraFrames, createPrintJob, createPrinterCommand, expireStale, saveCameraFrame,
  updateQueueItem, type PrintJobInput,
} from "./jobs";

const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; } };
const ORDER = "ORD-001";

// Printer #1 as it reported on 15 Oct 2026: idle, SD card in, 0.4 mm nozzle, yellow + red PLA, slot 2 empty.
const IDLE = {
  gcode_state: "IDLE", mc_percent: 0, print_error: 0, stg: [], stg_cur: 0, sdcard: true, home_flag: 847201688, hms: [],
  nozzle_diameter: "0.4", nozzle_type: "stainless_steel", spd_lvl: 2, lights_report: [{ node: "chamber_light", mode: "off" }],
  ams: { ams: [{ id: "0", info: "1002", tray: [
    { id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1" },
    { id: "2", tray_type: "PLA", tray_color: "C52C18FF", tray_sub_brands: "" }, { id: "3", tray_type: "PETG", tray_color: "FFFFFFFF", tray_sub_brands: "" },
  ] }], tray_now: "255" },
  vt_tray: { id: "254", tray_type: "PETG", tray_color: "FFFFFFFF" },
};
const snaps: Record<string, PrinterSnapshot | undefined> = {};
function report(id: string, print: Record<string, unknown>) {
  const next = mergeReport(snaps[id], { print }, new Date().toISOString())!;
  snaps[id] = next;
  return ingestReport(id, next, []);
}
let fileId = "";
const start = (over: Partial<PrintJobInput> = {}, now?: number) => createPrintJob({
  printerId: "a1", attachmentId: fileId, plate: 1, amsMapping: [0, -1], by: "Khelda", bedEmptyConfirmed: true, personPresent: true, ...over,
}, now);

beforeEach(async () => {
  store.resetDb();
  mem.clear();
  clearCameraFrames();
  setFileStore(files);
  for (const k of Object.keys(snaps)) delete snaps[k];
  chooseQuote(ORDER, "Q-own", "agent", "within budget");
  report("a1", IDLE);
  const bytes = fake3mf({ projectColours: ["#FCE300", "#C52C18"], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82 }] }] });
  const up = await addAttachment(ORDER, { kind: "design", filename: "Benchy.gcode.3mf", bytes, uploadedBy: "Khelda" });
  if (!up.ok) throw new Error(up.error);
  fileId = up.attachment.id;
});
afterAll(() => setFileStore(undefined));

describe("starting a print (people only)", () => {
  it("queues the job, links the printer to the order and logs who started it", () => {
    const r = start();
    expect(r.ok).toBe(true);
    const job = r.ok ? r.job : undefined!;
    expect(job).toMatchObject({ orderId: ORDER, printerId: "a1", plate: 1, amsMapping: [0, -1], state: "queued", by: "Khelda",
      options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, subtaskName: "ORD-001 Custom lamp side table 3D-printed components" });
    expect(job.fileName).toMatch(/^ORD-001_p1_\d+\.gcode\.3mf$/);
    expect(r.ok && r.match).toMatchObject({ ok: true, mapping: [0, -1] });
    expect(store.getPrinter("a1")!.currentOrderId).toBe(ORDER);
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ actor: "human", tool: "start_print", ok: true });
  });

  it("the person's 'bed is empty' clears the bed the last print left", () => {
    store.savePrinter({ ...store.getPrinter("a1")!, bedOccupiedBy: "a print without an order" });
    expect(start().ok).toBe(true);
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBeUndefined();
  });

  it("refuses without a person at the printer, a confirmed empty bed and a name", () => {
    const r = start({ bedEmptyConfirmed: false, personPresent: "yes", by: "Chief" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(409);
    expect(!r.ok && r.reasons).toEqual(["A person's name is required", "A person must be at the printer when it starts", "A person must confirm the bed is empty and clean"]);
    expect(store.listPrintJobs()).toEqual([]);
  });

  it("a colour far from the file's is a warning the person must tick", () => {
    const r = start({ amsMapping: [2, -1] }); // red spool for a yellow file
    expect(!r.ok && r.reasons).toEqual(["Check the warnings and tick \"I checked this\""]);
    expect(!r.ok && r.warnings).toEqual(["Filament 1: the file asks for #FCE300, the spool is #C52C18"]);
    expect(start({ amsMapping: [2, -1], warningsChecked: true }).ok).toBe(true);
  });

  it("warns when a real order is not paid yet", () => {
    store.saveOrder({ ...store.getOrder(ORDER)!, label: "real" });
    expect(start().ok).toBe(false);
    const r = start({ warningsChecked: true });
    expect(r.ok && r.warnings).toEqual(["The customer has not paid into escrow yet"]);
  });

  it("refuses a printer with a fatal fault, a file that is not sliced, and a file of another order", async () => {
    report("a1", { hms: [{ attr: 84935680, code: 65604 }] });
    expect(!start().ok && (start() as { reasons: string[] }).reasons).toContain("Printer error HMS_0510_0400_0001_0044: fix it before printing");
    report("a1", { hms: [] });
    const stl = await addAttachment(ORDER, { kind: "design", filename: "part.stl", bytes: new TextEncoder().encode("solid x"), uploadedBy: "K" });
    expect(start({ attachmentId: stl.ok ? stl.attachment.id : "" })).toMatchObject({ ok: false, error: "Only a sliced Bambu Studio file (.gcode.3mf) can be printed" });
    expect(start({ orderId: "ORD-999" })).toMatchObject({ ok: false, error: "The file does not belong to this order" });
  });

  it("one job at a time per printer, at most one start a minute", () => {
    const now = Date.now();
    expect(start({}, now).ok).toBe(true);
    expect((start({}, now + 1000) as { reasons: string[] }).reasons).toEqual(expect.arrayContaining([expect.stringMatching(/^Another print job \(PJ-1-/)]));
  });

  it("a job the bridge did not pick up within 5 minutes fails: the bed was confirmed for then, not for later", () => {
    const now = Date.now();
    const r = start({}, now);
    const id = r.ok ? r.job.id : "";
    expect(bridgeQueue(null, now + 60_000).jobs.map((j) => j.id)).toEqual([id]);
    expect(bridgeQueue(null, now + 5 * 60_000 + 1).jobs).toEqual([]);
    expect(store.getPrintJob(id)).toMatchObject({ state: "failed", error: expect.stringMatching(/did not pick it up within 5 min/) });
    expect(updateQueueItem(id, { state: "uploading" }, now + 6 * 60_000)).toMatchObject({ ok: false, status: 409 });
  });

  it("a person can cancel a job before the bridge takes it", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    expect(cancelPrintJob(id, "agent").ok).toBe(false);
    expect(cancelPrintJob(id, "Khelda")).toMatchObject({ ok: true, job: { state: "cancelled", error: "Cancelled by Khelda" } });
    expect(bridgeQueue(null).jobs).toEqual([]);
  });

  it("and while it uploads: the bridge then cannot record the start and sends nothing", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    updateQueueItem(id, { state: "uploading" });
    expect(cancelPrintJob(id, "Khelda")).toMatchObject({ ok: true, job: { state: "cancelled" } });
    expect(updateQueueItem(id, { state: "sent" })).toMatchObject({ ok: false, status: 409 });
  });

  it("the ftp:/// retry reaches the bridge; nothing else does", () => {
    expect(start({ urlForm: "smb" })).toMatchObject({ ok: false, status: 400, error: "urlForm must be sdcard or ftp" });
    const r = start({ urlForm: "ftp" });
    expect(r.ok && r.job.urlForm).toBe("ftp");
    expect(bridgeQueue(null).jobs[0]).toMatchObject({ urlForm: "ftp" });
  });
});

describe("the bridge's side", () => {
  it("takes a job once, uploads, starts it; the printer's reports move it to printing and done", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    const [item] = bridgeQueue(["a1"]).jobs;
    expect(item).toMatchObject({ type: "job", id, printerId: "a1", plate: 1, amsMapping: [0, -1], fileUrl: `/api/print-jobs/${id}/file` });
    expect(item.size).toBeGreaterThan(0);
    expect(bridgeQueue(["a1-2"]).jobs).toEqual([]);
    expect(updateQueueItem(id, { state: "uploading" }).ok).toBe(true);
    expect(updateQueueItem(id, { state: "uploading" })).toMatchObject({ ok: false, status: 409 }); // taken once
    expect(bridgeQueue(null).jobs).toEqual([]);
    expect(updateQueueItem(id, { state: "sent", md5: "0123456789abcdef0123456789ABCDEF" })).toMatchObject({ ok: true, job: { md5: "0123456789abcdef0123456789abcdef" } });
    report("a1", { gcode_state: "PREPARE", stg: [2, 13], stg_cur: 2 });
    expect(store.getPrintJob(id)!.state).toBe("printing");
    report("a1", { gcode_state: "RUNNING", mc_percent: 50 });
    report("a1", { gcode_state: "FINISH", mc_percent: 100 });
    expect(store.getPrintJob(id)!.state).toBe("done");
    expect(updateQueueItem(id, { state: "printing" })).toMatchObject({ ok: false, status: 409 }); // never backwards
  });

  it("a stop by a person ends the job as cancelled; a failure as failed", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    updateQueueItem(id, { state: "uploading" });
    updateQueueItem(id, { state: "sent" });
    report("a1", { gcode_state: "RUNNING", mc_percent: 5 });
    report("a1", { gcode_state: "FAILED", print_error: 0x0300400c });
    expect(store.getPrintJob(id)!.state).toBe("cancelled");
  });

  it("never sent more than 10 min after the bed was confirmed, nor after a print ended on the printer since", () => {
    const now = Date.now();
    const r = start({}, now);
    const id = r.ok ? r.job.id : "";
    expect(bridgeQueue(null, now).jobs[0].sendBy).toBe(new Date(now + 10 * 60_000).toISOString());
    updateQueueItem(id, { state: "uploading" }, now + 1000);
    expect(updateQueueItem(id, { state: "sent" }, now + 10 * 60_000 + 1)).toMatchObject({ ok: false, status: 409 });
    expect(store.getPrintJob(id)).toMatchObject({ state: "failed", error: expect.stringMatching(/^The bed was confirmed more than 10 min ago/) });

    store.savePrinter({ ...store.getPrinter("a1")!, lastSeen: new Date(now + 11 * 60_000).toISOString() });
    const r2 = start({}, now + 11 * 60_000);
    const id2 = r2.ok ? r2.job.id : "";
    updateQueueItem(id2, { state: "uploading" }, now + 11 * 60_000);
    store.savePrinter({ ...store.getPrinter("a1")!, bedOccupiedBy: "a print without an order" });
    expect(updateQueueItem(id2, { state: "sent" }, now + 12 * 60_000)).toMatchObject({ ok: false, status: 409 });
    expect(store.getPrintJob(id2)!.error).toMatch(/^A print ended on this printer after the bed was confirmed/);
  });

  it("a job stuck uploading (30 min) or sent but never started (15 min) fails, so it never blocks the printer", () => {
    const now = Date.now();
    const a = start({}, now);
    const ida = a.ok ? a.job.id : "";
    updateQueueItem(ida, { state: "uploading" }, now);
    expireStale(now + 29 * 60_000);
    expect(store.getPrintJob(ida)!.state).toBe("uploading");
    expireStale(now + 31 * 60_000);
    expect(store.getPrintJob(ida)).toMatchObject({ state: "failed", error: expect.stringMatching(/stopped answering during the upload/) });

    const later = now + 32 * 60_000;
    store.savePrinter({ ...store.getPrinter("a1")!, lastSeen: new Date(later).toISOString() });
    const b = start({}, later);
    const idb = b.ok ? b.job.id : "";
    updateQueueItem(idb, { state: "uploading" }, later);
    updateQueueItem(idb, { state: "sent" }, later + 60_000);
    expireStale(later + 60_000 + 16 * 60_000);
    expect(store.getPrintJob(idb)).toMatchObject({ state: "failed", error: expect.stringMatching(/never showed the print starting/) });
  });

  it("a print still preparing after 15 min gets one task for a person", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    updateQueueItem(id, { state: "uploading" });
    updateQueueItem(id, { state: "sent" });
    report("a1", { gcode_state: "PREPARE", stg: [2, 13], stg_cur: 2 });
    expect(store.getPrintJob(id)!.state).toBe("printing");
    store.savePrintJob({ ...store.getPrintJob(id)!, updatedAt: new Date(Date.now() - 16 * 60_000).toISOString() });
    report("a1", { gcode_state: "PREPARE", stg_cur: 13 });
    report("a1", { gcode_state: "PREPARE", stg_cur: 1 });
    const tasks = store.listTasks(ORDER).filter((t) => t.text.includes(id));
    expect(tasks).toMatchObject([{ kind: "check_printer", status: "open" }]);
  });

  it("a failed upload is reported with its reason", () => {
    const r = start();
    const id = r.ok ? r.job.id : "";
    updateQueueItem(id, { state: "uploading" });
    expect(updateQueueItem(id, { state: "failed", error: "upload size mismatch" })).toMatchObject({ ok: true, job: { state: "failed", error: "upload size mismatch" } });
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ tool: "print_job", ok: false });
  });
});

describe("printer commands", () => {
  it("a person's control is queued for the bridge; pause and stop need a confirmation", () => {
    report("a1", { gcode_state: "RUNNING", mc_percent: 10 });
    expect(createPrinterCommand("a1", { kind: "stop", by: "Khelda" })).toMatchObject({ ok: false, status: 400, error: "Confirm first" });
    const r = createPrinterCommand("a1", { kind: "pause", by: "Khelda", confirm: true });
    expect(r).toMatchObject({ ok: true, command: { printerId: "a1", kind: "pause", params: {}, state: "queued", by: "Khelda" } });
    expect(bridgeQueue(null).commands.map((c) => c.kind)).toEqual(["pause"]);
  });

  it("refuses the Chief, unknown kinds, and controls that do not fit the printer's state", () => {
    expect(createPrinterCommand("a1", { kind: "light", params: { on: true }, by: "agent" })).toMatchObject({ ok: false, error: "A person's name is required" });
    expect(createPrinterCommand("a1", { kind: "gcode_line", params: { line: "G28" }, by: "Khelda" })).toMatchObject({ ok: false, error: "Unknown printer command" });
    expect(createPrinterCommand("a1", { kind: "resume", by: "Khelda", confirm: true }))
      .toMatchObject({ ok: false, status: 409, reasons: ["Resume works only while the printer is paused"] });
    expect(createPrinterCommand("zz", { kind: "light", params: { on: true }, by: "Khelda" })).toMatchObject({ ok: false, status: 404 });
  });

  it("keeps only the parameters a kind needs", () => {
    report("a1", { gcode_state: "RUNNING" });
    const r = createPrinterCommand("a1", { kind: "speed", params: { level: 3, gcode: "M104 S300" }, by: "Khelda" });
    expect(r.ok && r.command.params).toEqual({ level: 3 });
  });

  it("a camera frame or firmware check never holds back a control, and Stop is never held back", () => {
    report("a1", { gcode_state: "RUNNING", mc_percent: 10 });
    const now = Date.now();
    expect(createPrinterCommand("a1", { kind: "camera_snapshot", by: "Khelda" }, now).ok).toBe(true);
    expect(createPrinterCommand("a1", { kind: "pause", by: "Khelda", confirm: true }, now + 1000).ok).toBe(true);
    expect(createPrinterCommand("a1", { kind: "stop", by: "Khelda", confirm: true }, now + 1500).ok).toBe(true);
    expect(createPrinterCommand("a1", { kind: "light", params: { on: true }, by: "Khelda" }, now + 2000)).toMatchObject({ ok: false, status: 429 });
  });

  it("resume keeps the person's \"I fixed the cause\" and refuses a fault pause without it", () => {
    report("a1", { gcode_state: "RUNNING", stg: [2, 0], stg_cur: 0 });
    report("a1", { gcode_state: "PAUSE", stg_cur: 17 });
    expect(createPrinterCommand("a1", { kind: "resume", by: "Khelda", confirm: true })).toMatchObject({ ok: false, status: 409 });
    const r = createPrinterCommand("a1", { kind: "resume", params: { fixed: true, level: 9 }, by: "Khelda", confirm: true });
    expect(r.ok && r.command.params).toEqual({ fixed: true });
  });

  it("one command every 3 seconds per printer, and never the same one twice in the queue", () => {
    const now = Date.now();
    expect(createPrinterCommand("a1", { kind: "light", params: { on: true }, by: "Khelda" }, now).ok).toBe(true);
    expect(createPrinterCommand("a1", { kind: "light", params: { on: false }, by: "Khelda" }, now + 1000)).toMatchObject({ ok: false, status: 429 });
    expect(createPrinterCommand("a1", { kind: "light", params: { on: false }, by: "Khelda" }, now + 4000))
      .toMatchObject({ ok: false, error: "The same command is already waiting for the bridge" });
  });

  it("a command the bridge has not taken in 60 s expires, so a stale STOP never fires later", () => {
    report("a1", { gcode_state: "RUNNING" });
    const now = Date.now();
    const r = createPrinterCommand("a1", { kind: "stop", by: "Khelda", confirm: true }, now);
    const id = r.ok ? r.command.id : "";
    expect(bridgeQueue(null, now + 59_000).commands).toHaveLength(1);
    expect(bridgeQueue(null, now + 61_000).commands).toEqual([]);
    expect(store.getPrinterCommand(id)).toMatchObject({ state: "expired", result: "The bridge did not pick it up within 60 s" });
    expect(updateQueueItem(id, { state: "sent" }, now + 62_000)).toMatchObject({ ok: false, status: 409 });
  });

  it("the bridge takes a command once and reports the printer's answer", () => {
    const r = createPrinterCommand("a1", { kind: "light", params: { on: true }, by: "Khelda" });
    const id = r.ok ? r.command.id : "";
    expect(updateQueueItem(id, { state: "sent" }).ok).toBe(true);
    expect(updateQueueItem(id, { state: "sent" })).toMatchObject({ ok: false, status: 409 });
    expect(updateQueueItem(id, { state: "done", result: "success" })).toMatchObject({ ok: true, command: { state: "done", result: "success" } });
    expect(updateQueueItem("PC-404", { state: "done" })).toMatchObject({ ok: false, status: 404 });
    expect(updateQueueItem("XX-1", { state: "done" })).toMatchObject({ ok: false, status: 404 });
  });

  it("a command the bridge took but never answered fails after 5 minutes", () => {
    const now = Date.now();
    const r = createPrinterCommand("a1", { kind: "get_version", by: "Khelda" }, now);
    const id = r.ok ? r.command.id : "";
    updateQueueItem(id, { state: "sent" }, now + 1000);
    expireStale(now + 6 * 60_000);
    expect(store.getPrinterCommand(id)).toMatchObject({ state: "failed", result: "No answer from the bridge" });
  });
});

describe("camera frames", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  it("keeps the latest JPEG per printer, refuses anything else", () => {
    expect(saveCameraFrame("a1", JPEG)).toMatchObject({ ok: true, size: 12 });
    expect(cameraFrame("a1")!.jpeg).toEqual(JPEG);
    expect(saveCameraFrame("a1", new TextEncoder().encode("<html>"))).toMatchObject({ ok: false, error: "Not a JPEG image" });
    expect(saveCameraFrame("a1", new Uint8Array(2 * 1024 * 1024 + 1))).toMatchObject({ ok: false, status: 413 });
    expect(saveCameraFrame("nope", JPEG)).toMatchObject({ ok: false, status: 404 });
  });
});

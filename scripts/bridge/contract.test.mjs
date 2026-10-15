// The bridge's runner against the app's real bridge routes (in-memory database): what a person queues on the website
// is taken, carried out on a (fake) printer and reported back exactly as the app expects.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "../../src/lib/store.ts";
import { chooseQuote } from "../../src/lib/actions.ts";
import { setFileStore } from "../../src/lib/files.ts";
import { ingestReport } from "../../src/lib/printer/actions.ts";
import { cameraFrame, clearCameraFrames, createPrintJob, createPrinterCommand } from "../../src/lib/printer/jobs.ts";
import { POST as upload } from "../../src/app/api/orders/[id]/files/route.ts";
import { POST as postCamera } from "../../src/app/api/printers/[id]/camera/route.ts";
import { GET as queue } from "../../src/app/api/printers/queue/route.ts";
import { POST as queueItem } from "../../src/app/api/printers/queue/[id]/route.ts";
import { GET as jobFile } from "../../src/app/api/print-jobs/[id]/file/route.ts";
import { createRunner } from "./runner.mjs";
import { benchy, fakeClock, fakePrinter, idleSnapshot, md5, replyTo, withReport } from "./fakes.test-helper.mjs";

const TOKEN = "bridge-token-123";
const APP = "http://app.test";
const mem = new Map();
const ctx = (id) => ({ params: Promise.resolve({ id }) });

/** fetch -> the app's route handlers, as Next.js would call them. */
async function appFetch(url, init = {}) {
  const path = new URL(url).pathname;
  const req = new Request(url, init);
  let m;
  if (path === "/api/printers/queue") return queue(req);
  if ((m = /^\/api\/printers\/queue\/([^/]+)$/.exec(path))) return queueItem(req, ctx(decodeURIComponent(m[1])));
  if ((m = /^\/api\/print-jobs\/([^/]+)\/file$/.exec(path))) return jobFile(req, ctx(decodeURIComponent(m[1])));
  if ((m = /^\/api\/printers\/([^/]+)\/camera$/.exec(path))) return postCamera(req, ctx(decodeURIComponent(m[1])));
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  clearCameraFrames();
  setFileStore({ async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k); } });
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  chooseQuote("ORD-001", "Q-own", "agent", "within budget");
  // The app's view of printer #1, as the bridge reported it a moment ago.
  ingestReport("a1", withReport(idleSnapshot(), {}), []);
  const snap = store.getPrinter("a1").snapshot;
  store.savePrinter({ ...store.getPrinter("a1"), lastSeen: new Date().toISOString(), snapshot: { ...snap, at: new Date().toISOString() } });
});
afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
afterAll(() => setFileStore(undefined));

async function uploadSliced() {
  const form = new FormData();
  form.set("file", new File([benchy()], "Benchy.gcode.3mf"));
  form.set("kind", "design");
  form.set("by", "Khelda");
  const res = await upload(new Request("http://x/api/orders/ORD-001/files", { method: "POST", body: form }), ctx("ORD-001"));
  return (await res.json()).attachment.id;
}

function bridge(react) {
  const clock = fakeClock(Date.now());
  const printer = fakePrinter(clock, { react });
  const logs = [];
  const runner = createRunner({
    apps: [APP], token: TOKEN, printers: new Map([["a1", printer]]), clock, fetch: appFetch, log: (t) => logs.push(t), warn: (t) => logs.push(t),
    grabFrame: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0xff, 0xd9]),
    uploadToSd: async (o) => ({ path: `/${o.name}`, size: o.bytes.length }),
  });
  return { printer, logs, run: async () => { await runner.pollOnce(); await runner.idle(); } };
}

describe("bridge <-> app", () => {
  it("a person's print job: taken, uploaded, started; the app then follows it from the reports", async () => {
    const attachmentId = await uploadSliced();
    const created = createPrintJob({ printerId: "a1", attachmentId, plate: 1, amsMapping: [0], by: "Khelda", bedEmptyConfirmed: true, personPresent: true });
    expect(created.ok).toBe(true);
    const b = bridge((msg, p) => { p.emit(replyTo(msg)); p.snapshot = withReport(p.snapshot, { gcode_state: "PREPARE", stg: [2, 13], stg_cur: 2 }); });
    await b.run();
    const job = store.getPrintJob(created.job.id);
    expect(job.state).toBe("sent");
    expect(job.md5).toBe(md5(benchy()));
    expect(b.printer.published[0].payload.print).toMatchObject({
      command: "project_file", url: `file:///sdcard/${job.fileName}`, subtask_name: job.subtaskName, ams_mapping: [0], use_ams: true,
    });
    // The next report from the printer moves the job on (the app's side).
    ingestReport("a1", withReport(store.getPrinter("a1").snapshot, { gcode_state: "PREPARE", stg: [2], stg_cur: 2 }), []);
    expect(store.getPrintJob(created.job.id).state).toBe("printing");
  });

  it("a person's light and camera requests: carried out and answered", async () => {
    const light = createPrinterCommand("a1", { kind: "light", params: { on: true }, by: "Khelda" }, Date.now() - 10_000);
    const camera = createPrinterCommand("a1", { kind: "camera_snapshot", by: "Khelda" });
    expect(light.ok && camera.ok).toBe(true);
    const b = bridge((msg, p) => { p.emit(replyTo(msg)); p.snapshot = withReport(p.snapshot, { lights_report: [{ node: "chamber_light", mode: "on" }] }); });
    await b.run();
    expect(store.getPrinterCommand(light.command.id)).toMatchObject({ state: "done", result: "The light is on" });
    expect(store.getPrinterCommand(camera.command.id)).toMatchObject({ state: "done", result: "Camera frame sent" });
    expect(cameraFrame("a1").jpeg.byteLength).toBe(8);
    expect(b.logs.filter((l) => l.startsWith("!"))).toEqual([]);
  });

  it("the bridge's re-check failing is recorded on the command", async () => {
    const light = createPrinterCommand("a1", { kind: "light", params: { on: false }, by: "Khelda" });
    const b = bridge();
    b.printer.connected = false;
    await b.run();
    expect(store.getPrinterCommand(light.command.id)).toMatchObject({ state: "failed", result: "The bridge is not connected to the printer" });
  });
});

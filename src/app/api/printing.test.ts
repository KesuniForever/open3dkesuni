import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { chooseQuote } from "@/lib/actions";
import { setFileStore, type FileStore } from "@/lib/files";
import { ingestReport } from "@/lib/printer/actions";
import { clearCameraFrames } from "@/lib/printer/jobs";
import { mergeReport } from "@/lib/printer/bambu";
import { fake3mf } from "@/lib/threemf.test-helper";
import { POST as upload } from "./orders/[id]/files/route";
import { DELETE as removeFile } from "./orders/[id]/files/[fileId]/route";
import { GET as listCommands, POST as command } from "./printers/[id]/command/route";
import { GET as getCamera, POST as postCamera } from "./printers/[id]/camera/route";
import { POST as printerAction } from "./printers/[id]/route";
import { GET as queue } from "./printers/queue/route";
import { POST as queueItem } from "./printers/queue/[id]/route";
import { GET as listJobs, POST as startJob } from "./print-jobs/route";
import { GET as getJob, POST as jobAction } from "./print-jobs/[id]/route";
import { GET as jobFile } from "./print-jobs/[id]/file/route";
import { GET as colors } from "./studio/colors/route";

const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const TOKEN = "bridge-token-123";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const bridge = { authorization: `Bearer ${TOKEN}` };
const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://x${url}`, { headers });

function idlePrinter(id = "a1") {
  const snap = mergeReport(undefined, { print: {
    gcode_state: "IDLE", sdcard: true, home_flag: 847201688, hms: [], nozzle_diameter: "0.4",
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1" }] }] },
  } }, new Date().toISOString())!;
  ingestReport(id, snap, []);
}

async function uploadSliced(): Promise<string> {
  const form = new FormData();
  const bytes = fake3mf({ projectColours: ["#FCE300"], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82 }] }] });
  form.set("file", new File([bytes as BlobPart], "Benchy.gcode.3mf"));
  form.set("kind", "design");
  form.set("by", "Khelda");
  const res = await upload(new Request("http://x/api/orders/ORD-001/files", { method: "POST", body: form }), ctx("ORD-001"));
  const body = await res.json();
  return body.attachment.id;
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  clearCameraFrames();
  setFileStore(files);
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  chooseQuote("ORD-001", "Q-own", "agent", "within budget");
  idlePrinter();
});
afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
afterAll(() => setFileStore(undefined));

describe("upload: a .3mf is read right away", () => {
  it("stores what the sliced file holds on the attachment", async () => {
    const id = await uploadSliced();
    expect(store.getAttachment(id)!.parsed3mf).toMatchObject({ sliced: true, printerModelId: "N2S", plates: [{ index: 1, weightG: 9.82, predictionSec: 1644 }] });
  });
});

describe("a person starts a print; the bridge carries it out", () => {
  it("POST /api/print-jobs refuses with reasons, then queues; the bridge lists, takes, downloads and reports it", async () => {
    const attachmentId = await uploadSliced();
    const base = { printerId: "a1", attachmentId, plate: 1, amsMapping: [0], by: "Khelda", personPresent: true };
    const refused = await startJob(json("/api/print-jobs", base));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "The print cannot start", reasons: ["A person must confirm the bed is empty and clean"], warnings: [], match: { ok: true } });

    const res = await startJob(json("/api/print-jobs", { ...base, bedEmptyConfirmed: true }));
    expect(res.status).toBe(201);
    const { job } = await res.json();
    expect(job).toMatchObject({ state: "queued", orderId: "ORD-001", amsMapping: [0] });
    expect((await (await listJobs(get("/api/print-jobs?orderId=ORD-001"))).json()).jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
    expect((await (await getJob(get(`/api/print-jobs/${job.id}`), ctx(job.id))).json()).job.id).toBe(job.id);

    // The bridge, with its token.
    expect((await queue(get("/api/printers/queue"))).status).toBe(401);
    const q = await (await queue(get("/api/printers/queue?printers=a1", bridge))).json();
    expect(q.jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
    expect((await jobFile(get(`/api/print-jobs/${job.id}/file`), ctx(job.id))).status).toBe(401);
    const file = await jobFile(get(`/api/print-jobs/${job.id}/file`, bridge), ctx(job.id));
    expect(file.status).toBe(200);
    expect(file.headers.get("x-file-md5")).toMatch(/^[0-9a-f]{32}$/);
    expect(new Uint8Array(await file.arrayBuffer())[0]).toBe(0x50); // "PK"
    expect((await queueItem(json(`/api/printers/queue/${job.id}`, { state: "uploading" }, bridge), ctx(job.id))).status).toBe(200);
    expect((await queueItem(json(`/api/printers/queue/${job.id}`, { state: "uploading" }, bridge), ctx(job.id))).status).toBe(409);
    expect((await queueItem(json(`/api/printers/queue/${job.id}`, { state: "sent" }), ctx(job.id))).status).toBe(401);
    const sent = await queueItem(json(`/api/printers/queue/${job.id}`, { state: "sent" }, bridge), ctx(job.id));
    expect((await sent.json()).job.state).toBe("sent");
    // Once sent, the file is no longer served.
    expect((await jobFile(get(`/api/print-jobs/${job.id}/file`, bridge), ctx(job.id))).status).toBe(409);
  });

  it("a person cancels a queued job", async () => {
    const attachmentId = await uploadSliced();
    const { job } = await (await startJob(json("/api/print-jobs", {
      printerId: "a1", attachmentId, plate: 1, amsMapping: [0], by: "Khelda", personPresent: true, bedEmptyConfirmed: true,
    }))).json();
    expect((await jobAction(json(`/api/print-jobs/${job.id}`, { action: "cancel", by: "Khelda" }), ctx(job.id))).status).toBe(200);
    expect(store.getPrintJob(job.id)!.state).toBe("cancelled");
    expect((await jobAction(json(`/api/print-jobs/${job.id}`, { action: "explode" }), ctx(job.id))).status).toBe(400);
  });

  it("the file of a queued print cannot be removed until the job is cancelled", async () => {
    const attachmentId = await uploadSliced();
    const { job } = await (await startJob(json("/api/print-jobs", {
      printerId: "a1", attachmentId, plate: 1, amsMapping: [0], by: "Khelda", personPresent: true, bedEmptyConfirmed: true,
    }))).json();
    const del = () => removeFile(new Request(`http://x/api/orders/ORD-001/files/${attachmentId}`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ by: "Khelda" }),
    }), { params: Promise.resolve({ id: "ORD-001", fileId: attachmentId }) });
    const refused = await del();
    expect(refused.status).toBe(409);
    expect((await refused.json()).reasons).toEqual([`Print job ${job.id} is still using this file: cancel or stop the print first`]);
    // The bridge can still download it.
    expect((await jobFile(get(`/api/print-jobs/${job.id}/file`, bridge), ctx(job.id))).status).toBe(200);
    await jobAction(json(`/api/print-jobs/${job.id}`, { action: "cancel", by: "Khelda" }), ctx(job.id));
    expect((await del()).status).toBe(200);
    expect(store.getAttachment(attachmentId)).toBeUndefined();
    expect(mem.size).toBe(0);
  });
});

describe("controls", () => {
  it("POST /api/printers/a1/command queues a person's control; the bridge reports the answer", async () => {
    const res = await command(json("/api/printers/a1/command", { kind: "light", params: { on: true }, by: "Khelda" }), ctx("a1"));
    expect(res.status).toBe(201);
    const { command: c } = await res.json();
    expect(c).toMatchObject({ kind: "light", params: { on: true }, state: "queued", by: "Khelda" });
    const q = await (await queue(get("/api/printers/queue", bridge))).json();
    expect(q.commands).toEqual([expect.objectContaining({ type: "command", id: c.id, kind: "light", params: { on: true } })]);
    await queueItem(json(`/api/printers/queue/${c.id}`, { state: "sent" }, bridge), ctx(c.id));
    await queueItem(json(`/api/printers/queue/${c.id}`, { state: "done", result: "success" }, bridge), ctx(c.id));
    const list = await (await listCommands(get("/api/printers/a1/command"), ctx("a1"))).json();
    expect(list.commands[0]).toMatchObject({ id: c.id, state: "done", result: "success" });
  });

  it("refuses the Chief, a missing confirmation and a non-JSON body", async () => {
    expect((await command(json("/api/printers/a1/command", { kind: "light", params: { on: true }, by: "Chief" }), ctx("a1"))).status).toBe(400);
    idlePrinter();
    const running = mergeReport(store.getPrinter("a1")!.snapshot, { print: { gcode_state: "RUNNING" } }, new Date().toISOString())!;
    ingestReport("a1", running, []);
    const noConfirm = await command(json("/api/printers/a1/command", { kind: "stop", by: "Khelda" }), ctx("a1"));
    expect(await noConfirm.json()).toMatchObject({ error: "Confirm first" });
    const text = new Request("http://x/api/printers/a1/command", { method: "POST", body: "kind=stop", headers: { "content-type": "text/plain" } });
    expect((await command(text, ctx("a1"))).status).toBe(400);
  });

  it("a person confirms the AMS colours of a printer", async () => {
    const res = await printerAction(json("/api/printers/a1", { action: "confirm_colors", by: "Khelda" }), ctx("a1"));
    expect(res.status).toBe(200);
    expect((await res.json()).printer.colorsChecked).toMatchObject({ by: "Khelda", key: "0:PLA:#FEC600" });
  });
});

describe("camera", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const jpegPost = (headers: Record<string, string>, body: Uint8Array = JPEG) =>
    new Request("http://x/api/printers/a1/camera", { method: "POST", body: body as BodyInit, headers: { "content-type": "image/jpeg", ...headers } });

  it("the bridge posts a frame with its token; an operator reads the latest one", async () => {
    expect((await getCamera(get("/api/printers/a1/camera"), ctx("a1"))).status).toBe(404);
    expect((await postCamera(jpegPost({}), ctx("a1"))).status).toBe(401);
    expect((await postCamera(jpegPost(bridge), ctx("a1"))).status).toBe(201);
    const res = await getCamera(get("/api/printers/a1/camera"), ctx("a1"));
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect((await postCamera(jpegPost({ ...bridge, "content-type": "text/html" }), ctx("a1"))).status).toBe(415);
  });
});

describe("GET /api/studio/colors", () => {
  it("lists the loaded materials and colours, never printers or slots", async () => {
    const body = await (await colors()).json();
    expect(body.colors).toEqual([{ type: "PLA", color: "#FEC600", name: "Yellow", checked: true }]);
    expect(JSON.stringify(body)).not.toMatch(/a1|slot|printer/i);
  });
});

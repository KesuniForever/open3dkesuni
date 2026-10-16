import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as store from "@/lib/store";
import { setFileStore, type FileStore } from "@/lib/files";
import { ingestReport } from "@/lib/printer/actions";
import { mergeReport } from "@/lib/printer/bambu";
import { fake3mf } from "@/lib/threemf.test-helper";
import { resetSlicerSeen } from "@/lib/slicing";
import { GET as listFiles, POST as upload } from "./orders/[id]/files/route";
import { GET as listSlices, POST as askSlice } from "./slice-jobs/route";
import { GET as getSlice, POST as sliceAction } from "./slice-jobs/[id]/route";
import { GET as queue } from "./slicer/queue/route";
import { POST as queueItem } from "./slicer/queue/[id]/route";
import { GET as source } from "./slicer/jobs/[id]/source/route";
import { POST as result } from "./slicer/jobs/[id]/result/route";

const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const TOKEN = "bridge-token-123";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const bridge = { authorization: `Bearer ${TOKEN}` };
const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://x${url}`, { headers });
const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");
const STL = new TextEncoder().encode("solid cube\nendsolid cube\n");
const SLICED = fake3mf({ projectColours: ["#FEC600"], plates: [{ index: 1, weight: 4, prediction: 1200, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: 4 }] }] });
const resultReq = (id: string, bytes: Uint8Array, headers: Record<string, string> = {}) => new Request(`http://x/api/slicer/jobs/${id}/result`, {
  method: "POST", body: bytes as BodyInit, headers: { ...bridge, "content-type": "model/3mf", "x-file-md5": md5(bytes), "x-slice-ms": "650", ...headers },
});

async function uploadStl(): Promise<string> {
  const form = new FormData();
  form.set("file", new File([STL as BlobPart], "Clip.stl"));
  form.set("kind", "design");
  form.set("by", "Aini");
  const res = await upload(new Request("http://x/api/orders/ORD-001/files", { method: "POST", body: form }), ctx("ORD-001"));
  return (await res.json()).attachment.id;
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  resetSlicerSeen();
  setFileStore(files);
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  ingestReport("a1", mergeReport(undefined, { print: {
    gcode_state: "IDLE", sdcard: true, nozzle_diameter: "0.4",
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1" }] }] },
  } }, new Date().toISOString())!, []);
});
afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
afterAll(() => setFileStore(undefined));

describe("slicing on the website: a person asks, the studio PC slices, the order gets the sliced file", () => {
  it("POST /api/slice-jobs queues; the bridge lists, takes, downloads, uploads; the order has the .gcode.3mf", async () => {
    const attachmentId = await uploadStl();
    const bad = await askSlice(json("/api/slice-jobs", { orderId: "ORD-001", attachmentId, printerId: "a1", tray: 1, by: "Khelda" }));
    expect(bad.status).toBe(409);
    expect(await bad.json()).toEqual({ error: "The spool cannot be used", reasons: ["A1 Combo #1 slot 2 is empty"] });
    expect((await askSlice(new Request("http://x/api/slice-jobs", { method: "POST", body: "x" }))).status).toBe(400);

    const res = await askSlice(json("/api/slice-jobs", { orderId: "ORD-001", attachmentId, printerId: "a1", tray: 0, quality: "fine", infillPct: 15, supports: "off", by: "Khelda" }));
    expect(res.status).toBe(201);
    const { job, warnings, reused } = await res.json();
    expect(job).toMatchObject({ state: "queued", material: "PLA", color: "#FEC600", quality: "fine", infillPct: 15, supports: "off" });
    expect(warnings).toEqual([]); // a Bambu RFID spool: its colour comes from the tag
    expect(reused).toBeNull();
    const same = await askSlice(json("/api/slice-jobs", { orderId: "ORD-001", attachmentId, printerId: "a1", tray: 0, quality: "fine", infillPct: 15, supports: "off", by: "Aini" }));
    expect(same.status).toBe(200);
    expect((await same.json()).reused).toBe("active");

    let list = await (await listSlices(get("/api/slice-jobs?orderId=ORD-001"))).json();
    expect(list.jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
    expect(list.slicer).toMatchObject({ ready: false, seenAt: null });

    // The bridge.
    const q = await (await queue(get("/api/slicer/queue", bridge))).json();
    expect(q.slices).toHaveLength(1);
    expect(q.slices[0]).toMatchObject({ id: job.id, sourceName: "Clip.stl", sourceUrl: `/api/slicer/jobs/${job.id}/source` });
    list = await (await listSlices(get("/api/slice-jobs?orderId=ORD-001"))).json();
    expect(list.slicer.ready).toBe(true);
    expect((await source(get(`/api/slicer/jobs/${job.id}/source`, bridge), ctx(job.id))).status).toBe(409); // not taken yet
    expect((await queueItem(json(`/api/slicer/queue/${job.id}`, { state: "slicing" }, bridge), ctx(job.id))).status).toBe(200);
    expect((await queueItem(json(`/api/slicer/queue/${job.id}`, { state: "slicing" }, bridge), ctx(job.id))).status).toBe(409);
    const src = await source(get(`/api/slicer/jobs/${job.id}/source`, bridge), ctx(job.id));
    expect(src.status).toBe(200);
    const got = new Uint8Array(await src.arrayBuffer());
    expect(Buffer.from(got).toString()).toBe(Buffer.from(STL).toString());
    expect(src.headers.get("x-file-md5")).toBe(md5(STL));

    // A file changed on the way, or not a 3MF, is refused before anything is stored.
    expect((await result(resultReq(job.id, SLICED, { "x-file-md5": "0".repeat(32) }), ctx(job.id))).status).toBe(400);
    expect((await result(resultReq(job.id, SLICED, { "content-type": "text/plain" }), ctx(job.id))).status).toBe(415);
    const ok = await result(resultReq(job.id, SLICED), ctx(job.id));
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.job).toMatchObject({ state: "done", result: { weightG: 4, predictionSec: 1200, priceIdr: 6000, sliceMs: 650 } });
    expect(body.attachment).toMatchObject({ filename: "Clip PLA Yellow 0.16mm.gcode.3mf", uploadedBy: "Bambu Studio (slicer)", parsed3mf: { sliced: true } });
    const onOrder = (await (await listFiles(get("/api/orders/ORD-001/files"), ctx("ORD-001"))).json()).attachments;
    expect(onOrder.map((a: { filename: string }) => a.filename)).toEqual(["Clip.stl", "Clip PLA Yellow 0.16mm.gcode.3mf"]);
    expect((await (await getSlice(get(`/api/slice-jobs/${job.id}`), ctx(job.id))).json()).job.resultAttachmentId).toBe(body.attachment.id);
  });

  it("a person cancels; the bridge's later result is refused", async () => {
    const attachmentId = await uploadStl();
    const { job } = await (await askSlice(json("/api/slice-jobs", { orderId: "ORD-001", attachmentId, printerId: "a1", tray: 0, by: "Khelda" }))).json();
    await queueItem(json(`/api/slicer/queue/${job.id}`, { state: "slicing" }, bridge), ctx(job.id));
    expect((await sliceAction(json(`/api/slice-jobs/${job.id}`, { action: "stop" }), ctx(job.id))).status).toBe(400);
    expect((await sliceAction(json(`/api/slice-jobs/${job.id}`, { action: "cancel", by: "" }), ctx(job.id))).status).toBe(400);
    const c = await sliceAction(json(`/api/slice-jobs/${job.id}`, { action: "cancel", by: "Khelda" }), ctx(job.id));
    expect((await c.json()).job).toMatchObject({ state: "cancelled" });
    const late = await result(resultReq(job.id, SLICED), ctx(job.id));
    expect(late.status).toBe(409);
    expect(store.listAttachments("ORD-001")).toHaveLength(1);
  });

  it("every bridge route needs the bridge token", async () => {
    for (const r of [
      () => queue(get("/api/slicer/queue")),
      () => queueItem(json("/api/slicer/queue/SJ-1", { state: "slicing" }), ctx("SJ-1")),
      () => source(get("/api/slicer/jobs/SJ-1/source"), ctx("SJ-1")),
      () => result(new Request("http://x/api/slicer/jobs/SJ-1/result", { method: "POST", body: "x" }), ctx("SJ-1")),
    ]) expect((await r()).status).toBe(401);
    delete process.env.PRINTER_BRIDGE_TOKEN;
    expect((await queue(get("/api/slicer/queue", bridge))).status).toBe(503);
  });
});

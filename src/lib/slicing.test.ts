import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { chooseQuote } from "./actions";
import { addAttachment, removeAttachment, setFileStore, type FileStore } from "./files";
import { fake3mf } from "./threemf.test-helper";
import { parse3mf } from "./threemf";
import { confirmColors, ingestReport } from "./printer/actions";
import { mergeReport } from "./printer/bambu";
import { SLICER_NAME, sliceKey, slicedFileName, sliceOutputProblem, sliceSourceCheck } from "./slice-rules";
import {
  AUTO_PRINT_META, cancelSliceJob, expireStaleSlices, orderSlices, requestSlice, resetSlicerSeen, sliceJobSource, slicerStatus, sliceQueue,
  storeSliceResult, updateSliceItem, type SliceRequest,
} from "./slicing";
import type { Attachment, SliceJob } from "./types";

const mem = new Map<string, Uint8Array>();
let onPut: (() => void) | null = null;
const files: FileStore = {
  async put(k, b) { mem.set(k, b); onPut?.(); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); },
};
const ORDER = "ORD-001";
const STL = new TextEncoder().encode("solid cube\nfacet normal 0 0 1\nendsolid cube\n");

// Printer #1: idle, AMS lite with yellow PLA (Bambu RFID) in slot 1, slot 2 empty, white PETG in slot 3, ABS in slot 4.
const IDLE = {
  gcode_state: "IDLE", sdcard: true, home_flag: 847201688, hms: [], nozzle_diameter: "0.4",
  ams: { ams: [{ id: "0", info: "1002", tray: [
    { id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1" },
    { id: "2", tray_type: "PETG", tray_color: "FFFFFFFF", tray_sub_brands: "" }, { id: "3", tray_type: "ABS", tray_color: "000000FF", tray_sub_brands: "" },
  ] }] },
};
function report(id = "a1") {
  ingestReport(id, mergeReport(undefined, { print: IDLE }, new Date().toISOString())!, []);
}
async function upload(filename: string, bytes: Uint8Array = STL, orderId = ORDER): Promise<Attachment> {
  const r = await addAttachment(orderId, { kind: "design", filename, bytes, uploadedBy: "Aini" });
  if (!r.ok) throw new Error(r.error);
  return r.attachment;
}
/** What the studio PC's Bambu Studio sends back: an A1 0.4 file, textured plate, one filament. */
const sliced = (color = "#FFFFFF", type = "PETG", weight = 3.69) =>
  fake3mf({ projectColours: [color], projectTypes: [type], plates: [{ index: 1, weight, prediction: 1710, filaments: [{ id: 1, type, color, usedG: weight }] }] });

let stl: Attachment;
const ask = (over: Partial<SliceRequest> = {}, now?: number) =>
  requestSlice({ orderId: ORDER, attachmentId: stl.id, printerId: "a1", tray: 2, by: "Khelda", ...over }, now);
const okJob = (r: ReturnType<typeof requestSlice>): SliceJob => { if (!r.ok) throw new Error(`${r.error}: ${r.reasons?.join("; ")}`); return r.job; };

beforeEach(async () => {
  store.resetDb();
  mem.clear();
  onPut = null;
  resetSlicerSeen();
  setFileStore(files);
  report();
  stl = await upload("Kubus Uji (v2).STL");
});
afterAll(() => setFileStore(undefined));

describe("what can be sliced (slice-rules)", () => {
  const a = (filename: string, parsed3mf?: Attachment["parsed3mf"], kind: Attachment["kind"] = "design") => ({ filename, kind, parsed3mf });
  it("STL and OBJ as meshes; an unsliced A1 0.4 project with one filament keeps its settings; the rest goes to Bambu Studio", () => {
    expect(sliceSourceCheck(a("part.STL"))).toEqual({ ok: true, mode: "mesh" });
    expect(sliceSourceCheck(a("part.obj"))).toEqual({ ok: true, mode: "mesh" });
    expect(sliceSourceCheck(a("part.step"))).toEqual({ ok: false, reason: "STEP files cannot be sliced here: export an STL from the CAD program" });
    expect(sliceSourceCheck(a("ref.png", undefined, "reference")).ok).toBe(false);
    const project = { sliced: false, plates: [], printerModel: "Bambu Lab A1", nozzle: "0.4", projectFilaments: [{ type: "PLA", color: "#FFFFFF" }] };
    expect(sliceSourceCheck(a("lamp.3mf", project))).toEqual({ ok: true, mode: "project" });
    expect(sliceSourceCheck(a("lamp.3mf", { ...project, printerModel: "Bambu Lab P1S" }))).toMatchObject({ ok: false, reason: /not set up for the Bambu Lab A1 0\.4 mm/ });
    expect(sliceSourceCheck(a("lamp.3mf", { ...project, projectFilaments: [project.projectFilaments[0], { type: "PLA", color: "#000000" }] })))
      .toMatchObject({ ok: false, reason: "This 3MF uses several filaments: slice it in Bambu Studio" });
    expect(sliceSourceCheck(a("benchy.gcode.3mf", { ...project, sliced: true }))).toMatchObject({ ok: false, reason: "This 3MF is already sliced" });
    expect(sliceSourceCheck(a("old.3mf"))).toMatchObject({ ok: false });
  });

  it("names the sliced file after its source and settings; one key per source and settings", () => {
    expect(slicedFileName("Kubus Uji (v2).STL", "PLA", "White", "standard")).toBe("Kubus Uji (v2) PLA White 0.2mm.gcode.3mf");
    expect(slicedFileName("lamp.3mf", "PETG", "Light Blue", null)).toBe("lamp PETG Light Blue.gcode.3mf");
    const k = { attachmentId: "F-1", mode: "mesh" as const, material: "PLA" as const, color: "#FFFFFF", quality: "standard" as const, infillPct: 20, supports: "auto" as const };
    expect(sliceKey(k)).toBe("F-1|mesh|PLA|#FFFFFF|standard|20|auto");
    expect(sliceKey({ ...k, mode: "project", quality: "fine" })).toBe("F-1|project|PLA|#FFFFFF");
  });

  it("a sliced file must be printable on the A1 with the asked filament and colour", () => {
    const want = { mode: "mesh" as const, material: "PETG" as const, color: "#FFFFFF" };
    expect(sliceOutputProblem(parse3mf(sliced()), want)).toBeNull();
    expect(sliceOutputProblem(parse3mf(sliced("#FEC600")), want)).toBe("The slicer output has the wrong filament or colour");
    expect(sliceOutputProblem(parse3mf(sliced("#FFFFFF", "PLA")), want)).toBe("The slicer output has the wrong filament or colour");
    expect(sliceOutputProblem(parse3mf(fake3mf({ projectColours: ["#FFFFFF"], projectTypes: ["PETG"], modelId: "C11", plates: [{ index: 1, filaments: [{ id: 1, type: "PETG", color: "#FFFFFF", usedG: 3 }] }] })), want))
      .toBe("The slicer output is not for the Bambu Lab A1");
    expect(sliceOutputProblem(parse3mf(fake3mf({ projectColours: ["#FFFFFF"], projectTypes: ["PETG"], plates: [{ index: 1, gcode: false, filaments: [{ id: 1, type: "PETG", color: "#FFFFFF", usedG: 3 }] }] })), want))
      .toBe("The slicer output has no printable plate");
    expect(sliceOutputProblem(parse3mf(sliced("#FFFFFF", "PETG", 0)), want)).toBe("The slicer output has no weight or time");
  });
});

describe("a person asks for a slice", () => {
  it("queues it with the spool's material and colour, the order's infill, standard quality and auto supports, and logs it", () => {
    const r = ask();
    const job = okJob(r);
    expect(job).toMatchObject({
      orderId: ORDER, attachmentId: stl.id, sourceName: "Kubus Uji (v2).STL", mode: "mesh", printerId: "a1", tray: 2, material: "PETG", color: "#FFFFFF",
      quality: "standard", infillPct: 20, supports: "auto", state: "queued", actor: "person", by: "Khelda",
    });
    // A generic spool nobody confirmed: a warning, not a block.
    expect(r.ok && r.warnings).toEqual(["Nobody confirmed the colours on A1 Combo #1: check the spool is really White"]);
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ actor: "human", tool: "slice_request", ok: true, input: { file: "Kubus Uji (v2).STL", tray: 2, material: "PETG" }, output: { jobId: job.id } });
    // The spec's infill is used when the request leaves it out.
    store.saveOrder({ ...store.getOrder(ORDER)!, spec: { dimensions: "", toleranceMm: 0.2, material: "PLA", color: "", layerMm: 0.2, infillPct: 35, finishing: "", promise: "" } });
    expect(okJob(ask({ tray: 0, quality: "fine", supports: "off" }))).toMatchObject({ material: "PLA", color: "#FEC600", quality: "fine", infillPct: 35, supports: "off" });
  });

  it("refuses without a person, for a file that cannot be sliced, an empty or non-PLA/PETG slot, and bad settings", async () => {
    expect(ask({ by: "" })).toMatchObject({ ok: false, status: 400, error: "A person's name is required" });
    expect(ask({ by: "Chief" })).toMatchObject({ ok: false, error: "A person's name is required" });
    const step = await upload("bracket.step");
    expect(ask({ attachmentId: step.id })).toMatchObject({ ok: false, status: 400, reasons: ["STEP files cannot be sliced here: export an STL from the CAD program"] });
    const done = await upload("benchy.gcode.3mf", sliced());
    expect(ask({ attachmentId: done.id })).toMatchObject({ ok: false, reasons: ["This 3MF is already sliced"] });
    expect(ask({ tray: 1 })).toMatchObject({ ok: false, status: 409, reasons: ["A1 Combo #1 slot 2 is empty"] });
    expect(ask({ tray: 3 })).toMatchObject({ ok: false, reasons: ["A1 Combo #1 slot 4 holds ABS: only PLA and PETG are sliced here"] });
    expect(ask({ tray: 99 })).toMatchObject({ ok: false, error: "Pick an AMS spool (tray 0 to 15)" });
    expect(ask({ tray: undefined })).toMatchObject({ ok: false, error: "Pick an AMS spool (tray 0 to 15)" });
    expect(ask({ quality: "ultra" })).toMatchObject({ ok: false, error: "Quality must be standard, fine or draft" });
    expect(ask({ infillPct: 101 })).toMatchObject({ ok: false, error: "Infill must be a whole number from 0 to 100" });
    expect(ask({ infillPct: 12.5 })).toMatchObject({ ok: false });
    expect(ask({ supports: "everywhere" })).toMatchObject({ ok: false, error: "Supports must be auto or off" });
    expect(ask({ printerId: "x1c" })).toMatchObject({ ok: false, status: 404 });
    store.saveOrder({ ...store.getOrder(ORDER)!, status: "EVIDENCE_SUBMITTED" });
    expect(ask()).toMatchObject({ ok: false, status: 409, error: "Order is EVIDENCE_SUBMITTED; nothing to slice now" });
    expect(store.listSliceJobs()).toEqual([]);
  });

  it("`slot` means the same tray number; the same slice is never queued twice, and a finished one is reused", async () => {
    const first = okJob(ask({ slot: 2, tray: undefined }));
    const again = ask();
    expect(again).toMatchObject({ ok: true, reused: "active", job: { id: first.id } });
    expect(store.listSliceJobs()).toHaveLength(1);
    // A second active row with the same key is refused by the database itself.
    expect(() => store.insertSliceJob({ ...first, id: "SJ-dup" })).toThrow();
    // Other settings are another slice; at most 3 wait per order.
    okJob(ask({ infillPct: 30 }));
    okJob(ask({ quality: "draft" }));
    expect(ask({ supports: "off" })).toMatchObject({ ok: false, status: 429 });
    // Finished: the next identical request gets the finished slice and its file.
    expect(updateSliceItem(first.id, { state: "slicing" }).ok).toBe(true);
    const stored = await storeSliceResult(first.id, sliced());
    expect(stored.ok).toBe(true);
    expect(ask()).toMatchObject({ ok: true, reused: "done", job: { id: first.id, state: "done" } });
  });

  it("a person cancels a waiting slice; the order's list is newest first", () => {
    const a = okJob(ask());
    const b = okJob(ask({ tray: 0 }));
    expect(cancelSliceJob(a.id, "")).toMatchObject({ ok: false, status: 400 });
    expect(cancelSliceJob(a.id, "Khelda")).toMatchObject({ ok: true, job: { state: "cancelled", error: "Cancelled by Khelda" } });
    expect(cancelSliceJob(a.id, "Khelda")).toMatchObject({ ok: false, status: 409 });
    expect(orderSlices(ORDER).map((j) => j.id)).toEqual([b.id, a.id]);
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ tool: "slice_cancel", actor: "human", input: { by: "Khelda" } });
  });
});

describe("the agent asks for a slice (from code only)", () => {
  const agent = (over: Partial<SliceRequest> = {}) => ask({ by: "agent", actor: "agent", why: ["earliest deadline"], ...over });

  it("only with the switch on, a person's colour check, a reporting printer and an order in production", () => {
    expect(agent()).toMatchObject({ ok: false, status: 409, error: "Agent prints are off: only a person can ask for a slice" });
    store.setMeta(AUTO_PRINT_META, { on: true, by: "Khelda", at: new Date().toISOString() });
    expect(agent()).toMatchObject({ ok: false, error: "Order is CREATED; nothing to slice now" });
    chooseQuote(ORDER, "Q-own", "agent", "within budget");
    expect(agent()).toMatchObject({ ok: false, reasons: ["Nobody confirmed the colours on A1 Combo #1"] });
    expect(confirmColors("a1", "Khelda").ok).toBe(true);
    const job = okJob(agent());
    expect(job).toMatchObject({ actor: "agent", by: "agent", why: ["earliest deadline"], state: "queued" });
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ actor: "agent", tool: "slice_request", input: { by: "agent", why: ["earliest deadline"] } });
    // Asking again while it waits returns the same slice (the dispatcher may ask on every tick).
    expect(agent()).toMatchObject({ ok: true, reused: "active", job: { id: job.id } });
    store.setMeta(AUTO_PRINT_META, { on: false, by: "Khelda", at: new Date().toISOString() });
    expect(agent({ tray: 0 })).toMatchObject({ ok: false, error: "Agent prints are off: only a person can ask for a slice" });
  });
});

describe("the studio PC's side", () => {
  it("lists queued slices with their links, takes one once, serves the source only while slicing, and fails with a reason", () => {
    expect(slicerStatus()).toMatchObject({ ready: false, seenAt: null });
    const job = okJob(ask());
    const [item] = sliceQueue();
    expect(slicerStatus().ready).toBe(true);
    expect(item).toMatchObject({
      type: "slice", id: job.id, mode: "mesh", sourceName: "Kubus Uji (v2).STL", size: STL.byteLength, material: "PETG", color: "#FFFFFF",
      quality: "standard", infillPct: 20, supports: "auto", sourceUrl: `/api/slicer/jobs/${job.id}/source`, resultUrl: `/api/slicer/jobs/${job.id}/result`,
    });
    expect(sliceJobSource(job.id)).toMatchObject({ ok: false, status: 409 });
    expect(updateSliceItem(job.id, { state: "slicing" })).toMatchObject({ ok: true, job: { state: "slicing" } });
    expect(updateSliceItem(job.id, { state: "slicing" })).toMatchObject({ ok: false, status: 409 }); // a second studio PC
    expect(sliceQueue()).toEqual([]);
    expect(sliceJobSource(job.id)).toMatchObject({ ok: true, attachment: { id: stl.id } });
    expect(updateSliceItem(job.id, { state: "done" })).toMatchObject({ ok: false, status: 409 }); // done comes with the file only
    expect(updateSliceItem(job.id, { state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" }))
      .toMatchObject({ ok: true, job: { state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" } });
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ tool: "slice_result", ok: false, actor: "human" });
  });

  it("stores a good result on the order as the slicer's file, with time, grams and the price by weight", async () => {
    const job = okJob(ask());
    updateSliceItem(job.id, { state: "slicing" });
    const r = await storeSliceResult(job.id, sliced(), { sliceMs: 650 });
    if (!r.ok) throw new Error(r.error);
    expect(r.attachment).toMatchObject({ kind: "design", filename: "Kubus Uji (v2) PETG White 0.2mm.gcode.3mf", uploadedBy: SLICER_NAME, parsed3mf: { sliced: true, printerModelId: "N2S" } });
    // 3.69 g x Rp1.500 = Rp5.535, rounded up to Rp500 like every price by weight.
    expect(r.job).toMatchObject({ state: "done", resultAttachmentId: r.attachment.id, result: { predictionSec: 1710, weightG: 3.69, priceIdr: 6000, sliceMs: 650 } });
    expect(store.listLog(ORDER).at(-1)).toMatchObject({ tool: "slice_result", ok: true, output: { file: r.attachment.filename, weightG: 3.69, minutes: 29, priceIdr: 6000 } });
    expect(await storeSliceResult(job.id, sliced())).toMatchObject({ ok: false, status: 409 });
  });

  it("refuses a result that does not match, one for a slice not taken, and keeps the file of a slice cancelled meanwhile", async () => {
    const job = okJob(ask());
    expect(await storeSliceResult(job.id, sliced())).toMatchObject({ ok: false, status: 409, error: "The slice is queued" });
    updateSliceItem(job.id, { state: "slicing" });
    expect(await storeSliceResult(job.id, sliced("#FEC600"))).toMatchObject({ ok: false, status: 422, error: "The slicer output has the wrong filament or colour" });
    expect(store.getSliceJob(job.id)).toMatchObject({ state: "failed", error: "The slicer output has the wrong filament or colour" });
    expect(store.listAttachments(ORDER)).toHaveLength(1);

    const second = okJob(ask({ tray: 0 }));
    updateSliceItem(second.id, { state: "slicing" });
    onPut = () => { cancelSliceJob(second.id, "Khelda"); };
    const r = await storeSliceResult(second.id, sliced("#FEC600", "PLA"));
    expect(r).toMatchObject({ ok: false, status: 409, error: "The slice is cancelled; the sliced file was kept on the order" });
    expect(store.getSliceJob(second.id)).toMatchObject({ state: "cancelled", resultAttachmentId: expect.any(String) });
  });

  it("stale slices fail: not taken in 15 min, or 3 min without the studio PC's 'alive' while slicing", () => {
    const t0 = Date.now();
    const a = okJob(ask({}, t0));
    const b = okJob(ask({ tray: 0 }, t0));
    updateSliceItem(b.id, { state: "slicing" }, t0);
    // The studio PC says "alive" every minute while it works: the slice keeps running however long it takes.
    for (let m = 1; m <= 14; m++) expect(updateSliceItem(b.id, { state: "alive" }, t0 + m * 60_000).ok).toBe(true);
    expireStaleSlices(t0 + 14 * 60_000);
    expect(store.getSliceJob(a.id)!.state).toBe("queued");
    expect(updateSliceItem(a.id, { state: "alive" }, t0)).toMatchObject({ ok: false, status: 409 }); // only a slice being sliced
    expireStaleSlices(t0 + 16 * 60_000);
    expect(store.getSliceJob(a.id)).toMatchObject({ state: "failed", failKind: "studio", error: "The studio PC did not take the slice within 15 min: is the bridge running with Bambu Studio?" });
    expect(store.getSliceJob(b.id)!.state).toBe("slicing");
    // The bridge was closed mid-slice: no "alive" any more, so the slice fails 3 min after the last one.
    expireStaleSlices(t0 + 18 * 60_000);
    expect(store.getSliceJob(b.id)).toMatchObject({ state: "failed", failKind: "studio", error: "The studio PC stopped answering while slicing" });
  });

  it("why a slice failed: the model (the default) or the studio PC; a person's cancel and the switch's are told apart", () => {
    const a = okJob(ask());
    updateSliceItem(a.id, { state: "slicing" });
    expect(updateSliceItem(a.id, { state: "failed", error: "The model does not fit on the A1 bed (256 x 256 x 256 mm) or is empty" })).toMatchObject({ job: { failKind: "model" } });
    const b = okJob(ask({ tray: 0 }));
    updateSliceItem(b.id, { state: "slicing" });
    expect(updateSliceItem(b.id, { state: "failed", error: "Could not download the model", kind: "studio" })).toMatchObject({ job: { failKind: "studio" } });
    const c = okJob(ask({ quality: "fine" }));
    expect(cancelSliceJob(c.id, "Khelda")).toMatchObject({ job: { failKind: "person" } });
    const d = okJob(ask({ quality: "draft" }));
    expect(cancelSliceJob(d.id, "Khelda", Date.now(), "switch")).toMatchObject({ job: { failKind: "switch" } });
  });

  it("the source file cannot be removed while a slice uses it", async () => {
    const job = okJob(ask());
    const refused = await removeAttachment(ORDER, stl.id, "Khelda");
    expect(refused).toMatchObject({ ok: false, status: 409, reasons: [`Slice ${job.id} is still using this file: cancel the slice first`] });
    cancelSliceJob(job.id, "Khelda");
    expect((await removeAttachment(ORDER, stl.id, "Khelda")).ok).toBe(true);
  });
});

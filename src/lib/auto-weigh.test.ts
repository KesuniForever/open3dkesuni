import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./store";
import { addAttachment, setFileStore, type FileStore } from "./files";
import { customerCreateOrder, customerView, designOf, jakartaToday } from "./customer";
import { ingestReport, confirmColors } from "./printer/actions";
import { mergeReport } from "./printer/bambu";
import { agentFileProblem } from "./printer/autoprint";
import { setAutoPrint } from "./printer/dispatch";
import { MAX_ACTIVE_WEIGHING, noteSlicerPoll, requestSlice, resetSlicerSeen, storeSliceResult, updateSliceItem } from "./slicing";
import { quoteByWeight, setSlicerGrams } from "./agreement";
import { microToUsdc } from "./policy";
import { fake3mf, makeZip } from "./threemf.test-helper";
import { AUTO_WEIGH_BY } from "./slice-rules";
import { CUSTOMER_UPLOAD_BY, customerDesignProblem } from "./file-rules";
import { checkHeartbeat } from "./agent/heartbeat";
import {
  addCustomerDesign, afterAutoWeigh, customerDesignContentProblem, newOrderWake, pricingSpool, startAutoWeigh,
} from "./auto-weigh";

// The Chief is not called in tests: only who would be woken, and with what.
const wake = vi.hoisted(() => vi.fn<(orderId: string, trigger: string) => boolean>(() => true));
vi.mock("./agent/chief", async (orig) => ({ ...(await orig<typeof import("./agent/chief")>()), wakeChief: wake }));

/** Two weeks ahead: a fixed date would turn into a past deadline (refused) one day. */
const DEADLINE = jakartaToday(Date.now() + 14 * 86_400_000);
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const enc = (s: string) => new TextEncoder().encode(s);
const ASCII_STL = enc("solid clip\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid clip\n");
function binaryStl(triangles: number): Uint8Array {
  const b = Buffer.alloc(84 + triangles * 50);
  b.write("solid but really binary", 0, "latin1"); // some exporters start binary files with "solid" too
  b.writeUInt32LE(triangles, 80);
  return new Uint8Array(b);
}
const OBJ = enc("# clip\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(0)]);
/** An unsliced Bambu Studio project for the A1: a person may slice it; a customer may not send it. */
const PROJECT = makeZip([
  { name: "3D/3dmodel.model", data: "<model/>" },
  { name: "Metadata/project_settings.config", data: JSON.stringify({ printer_model: "Bambu Lab A1", nozzle_diameter: ["0.4"], filament_colour: ["#FFFFFF"], filament_type: ["PLA"] }) },
]);
const SLICED = fake3mf({ projectColours: ["#FEC600"], plates: [{ index: 1, weight: 16.4, prediction: 1500, filaments: [{ id: 1, type: "PLA", color: "#FEC600", usedG: 16.4 }] }] });

/** Printer #1 reports now: yellow PLA (Bambu tag) in slot 1, black PLA in slot 2. Printer #2 reported 10 min ago with white PETG. */
function studio(now = Date.now()) {
  const report = (trays: object[]) => mergeReport(undefined, { print: { gcode_state: "IDLE", sdcard: true, nozzle_diameter: "0.4", ams: { ams: [{ id: "0", info: "1002", tray: trays }] } } }, new Date(now).toISOString())!;
  ingestReport("a1", report([{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1", tray_type: "PLA", tray_color: "000000FF" }]), [], now);
  ingestReport("a1-2", report([{ id: "0", tray_type: "PETG", tray_color: "FFFFFFFF" }]), [], now - 10 * 60_000);
}
function order(extra: Partial<Parameters<typeof customerCreateOrder>[0]> = {}) {
  const r = customerCreateOrder({ name: "Aini", product: "Clip", quantity: 3, deadline: DEADLINE, budgetIdr: 500_000, note: "make it 2 g", ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.order;
}
/** The studio PC takes the slice and sends the sliced file back. */
async function slicedBack(jobId: string, bytes = SLICED) {
  expect(updateSliceItem(jobId, { state: "slicing" }).ok).toBe(true);
  return storeSliceResult(jobId, bytes);
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  resetSlicerSeen();
  setFileStore(files);
  wake.mockClear();
});
afterAll(() => setFileStore(undefined));

describe("the customer's design: only what the studio's slicer can weigh", () => {
  it("takes real STL (text and binary) and OBJ", () => {
    expect(customerDesignContentProblem("Clip.stl", ASCII_STL)).toBeNull();
    expect(customerDesignContentProblem("Clip.STL", binaryStl(12))).toBeNull();
    expect(customerDesignContentProblem("clip.obj", OBJ)).toBeNull();
  });

  it("refuses a renamed or broken file, any 3MF (its own settings and G-code), STEP, and anything over 25 MB, with one clear reason", () => {
    expect(customerDesignContentProblem("photo.stl", PNG)).toBe("This STL file is broken or empty. Export it again and send it.");
    expect(customerDesignContentProblem("empty.stl", enc("solid x\nendsolid x\n"))).toBe("This STL file is broken or empty. Export it again and send it.");
    expect(customerDesignContentProblem("photo.obj", PNG)).toBe("This OBJ file is broken or empty. Export it again and send it.");
    expect(customerDesignContentProblem("notes.obj", enc("just some text\n"))).toBe("This OBJ file is broken or empty. Export it again and send it.");
    // A 3MF project, sliced or not, even a 1-byte one: refused by its name, before its content is read.
    for (const [name, bytes] of [["clip.3mf", PROJECT], ["plate.3MF", SLICED], ["x.3mf", new Uint8Array([0x50])]] as const) {
      expect(customerDesignContentProblem(name, bytes)).toBe("Export your model as an STL or OBJ. Send a 3MF project on WhatsApp.");
    }
    expect(customerDesignContentProblem("clip.step", ASCII_STL)).toBe("STEP files cannot be weighed here: export an STL from your CAD program");
    expect(customerDesignContentProblem("clip.zip", ASCII_STL)).toBe("Send your design as an STL or OBJ file");
    expect(customerDesignContentProblem("clip.stl", new Uint8Array())).toBe("Your design file is empty");
    expect(customerDesignProblem("big.stl", 25 * 1024 * 1024 + 1)).toBe("Your design is larger than 25 MB. Send it on WhatsApp instead.");
    expect(customerDesignProblem("ok.stl", 25 * 1024 * 1024)).toBeNull();
  });
});

describe("weighing it automatically (nothing prints)", () => {
  it("picks a printer that reports now with a spool of the order's material, the customer's colour first", () => {
    studio();
    expect(pricingSpool(order())).toEqual({ ok: true, printerId: "a1", tray: 0 }); // no colour chosen: PLA, any colour
    expect(pricingSpool(order({ material: "PLA", colors: [{ type: "PLA", color: "#000000" }] }))).toEqual({ ok: true, printerId: "a1", tray: 1 });
    // PETG is only on printer #2, which has not reported for 10 min.
    expect(pricingSpool({ material: "PETG" })).toEqual({ ok: false, reason: "No printer reported in the last 2 min with a PETG spool loaded" });
  });

  it("queues a standard slice on that spool, for the customer's design only, and the Chief waits for the grams", async () => {
    studio();
    noteSlicerPoll();
    const o = order({ material: "PLA", colors: [{ type: "PLA", color: "#FEC600" }] });
    const d = await addCustomerDesign(o.id, { filename: "../../Clip (v2).stl", bytes: ASCII_STL });
    expect(d.stored).toBe(true);
    expect(d.attachment).toMatchObject({ kind: "design", filename: "Clip (v2).stl", uploadedBy: CUSTOMER_UPLOAD_BY });
    expect(d.weighing).toMatchObject({ ok: true, job: {
      actor: "system", by: AUTO_WEIGH_BY, state: "queued", printerId: "a1", tray: 0, material: "PLA", color: "#FEC600", quality: "standard", infillPct: 20, supports: "auto",
    } });
    expect(newOrderWake(d)).toMatch(/weighing it automatically: wait for slicerGrams .* do not ask the operator/);
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "weighing", gramsPerPiece: null });
    expect(store.listLog(o.id).map((e) => e.tool)).toEqual(["customer_design", "slice_request"]);
    // While it is weighed the heartbeat does not wake the Chief to ask for grams.
    const f = checkHeartbeat().filter((x) => x.orderId === o.id);
    expect(f).toEqual([expect.objectContaining({ key: `weighing:${o.id}`, wake: false })]);
  });

  it("no printer with the material, or a quiet slicer: the order stays, logged, and a person weighs it", async () => {
    const o = order();
    const none = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    expect(none).toMatchObject({ stored: true, weighing: { ok: false, reasons: ["No printer reported in the last 2 min with a PLA spool loaded"] } });
    studio();
    const quiet = startAutoWeigh(o.id, none.attachment!.id);
    expect(quiet).toEqual({ ok: false, reasons: ["The studio PC's slicer has not asked for work in the last 2 min"] });
    expect(store.getOrder(o.id)!.status).toBe("CREATED");
    expect(store.listLog(o.id).filter((e) => e.tool === "auto_weigh").map((e) => e.ok)).toEqual([false, false]);
    expect(store.listSliceJobs({ orderId: o.id })).toEqual([]);
    expect(newOrderWake(none)).toMatch(/could not start \(No printer reported .*\)\. Prepare it: .* ask the operator/);
    expect(newOrderWake(null)).toMatch(/^A customer just placed this order through the order form\. Prepare it: .*ask the operator/);
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "check", gramsPerPiece: null });
  });

  it("the sliced weight becomes the grams per unit (one piece), by the slicer, and the Chief is woken once to price it", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    const job = weighing!.ok ? weighing!.job : null;
    const r = await slicedBack(job!.id);
    expect(r).toMatchObject({ ok: true, autoGrams: { ok: true, gramsPerUnit: 16.4 } });
    const after = store.getOrder(o.id)!;
    expect(after.slicerGrams).toMatchObject({ gramsPerUnit: 16.4, by: "slicer", colorMode: "single", source: `slicer (automatic), ${job!.id}, Clip.stl` });
    expect(store.listLog(o.id).find((e) => e.tool === "slicer_grams")).toMatchObject({ actor: "human", input: { automatic: true, jobId: job!.id }, output: { by: "slicer" } });
    expect(afterAutoWeigh(job!.id)).toBe(true);
    expect(afterAutoWeigh(job!.id)).toBe(false); // once
    expect(wake).toHaveBeenCalledTimes(1);
    expect(wake.mock.calls[0]).toEqual([o.id, "The studio's slicer weighed the customer's design: 16.4 g per unit, single colour (slicerGrams). Price it by weight and continue."]);
    expect(designOf(after)).toMatchObject({ state: "weighed", gramsPerPiece: 16.4 });
    // The quantity multiplies it; the note's "2 g" is never used.
    expect(after.quantity).toBe(3);
  });

  it("a person's grams stay: the automatic weighing never replaces them", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    expect(setSlicerGrams(o.id, { gramsPerUnit: 20, source: "Bambu Studio, plate 1", by: "Khelda" }).ok).toBe(true);
    const r = await slicedBack(weighing!.ok ? weighing!.job.id : "");
    expect(r).toMatchObject({ ok: true, autoGrams: { ok: false, reason: "The order already has grams per unit: they stay" } });
    expect(store.getOrder(o.id)!.slicerGrams).toMatchObject({ gramsPerUnit: 20, by: "Khelda" });
    expect(afterAutoWeigh(weighing!.ok ? weighing!.job.id : "")).toBe(false); // nothing waits on it
    expect(wake).not.toHaveBeenCalled();
  });

  it("a person's slice of the same design does not set the grams by itself: the person enters them", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const d = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    const mine = requestSlice({ orderId: o.id, attachmentId: d.attachment!.id, printerId: "a1", tray: 0, quality: "fine", by: "Khelda" });
    expect(mine.ok && mine.job.actor).toBe("person");
    const r = await slicedBack(mine.ok ? mine.job.id : "");
    expect(r.ok && "autoGrams" in r).toBe(false);
    expect(store.getOrder(o.id)!.slicerGrams).toBeUndefined();
    expect(afterAutoWeigh(mine.ok ? mine.job.id : "")).toBe(false);
    expect(wake).not.toHaveBeenCalled();
  });

  it("a person already slicing the same file with the same settings: the weighing leaves the grams to them", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const up = await addAttachment(o.id, { kind: "design", filename: "Clip.stl", bytes: ASCII_STL, uploadedBy: CUSTOMER_UPLOAD_BY });
    if (!up.ok) throw new Error(up.error);
    expect(requestSlice({ orderId: o.id, attachmentId: up.attachment.id, printerId: "a1", tray: 0, by: "Khelda" }).ok).toBe(true);
    expect(startAutoWeigh(o.id, up.attachment.id)).toEqual({ ok: false, reasons: ["A person already slices this file: a person enters the grams"] });
    expect(store.listSliceJobs({ orderId: o.id }).map((j) => j.actor)).toEqual(["person"]);
  });

  it("a failed weighing wakes the Chief to ask the operator, and the customer sees Kesuni checks the file", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    const id = weighing!.ok ? weighing!.job.id : "";
    updateSliceItem(id, { state: "slicing" });
    updateSliceItem(id, { state: "failed", error: "Slicing failed (code -77)" });
    expect(afterAutoWeigh(id)).toBe(true);
    expect(wake.mock.calls[0][1]).toBe("The automatic weighing of the customer's design did not finish (Slicing failed (code -77)). Ask the operator for the grams per unit from the slicer.");
    expect(store.listLog(o.id).at(-1)).toMatchObject({ tool: "auto_weigh_result", ok: false, output: { state: "failed", error: "Slicing failed (code -77)" } });
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "check", gramsPerPiece: null });
    const f = checkHeartbeat().find((x) => x.orderId === o.id)!;
    expect(f).toMatchObject({ key: expect.stringMatching(new RegExp(`^needs_price:${o.id}:.*:failed$`)), wake: true });
    expect(f.text).toMatch(/automatic weighing of the customer's design did not finish\. Ask the operator/);
  });

  it("the agent never prints the weighing's file, and slices again for itself instead of reusing it", async () => {
    studio();
    noteSlicerPoll();
    const o = order({ material: "PLA", colors: [{ type: "PLA", color: "#FEC600" }] });
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    const r = await slicedBack(weighing!.ok ? weighing!.job.id : "");
    if (!r.ok) throw new Error(r.error);
    store.saveOrder({ ...store.getOrder(o.id)!, status: "PLAN_CHOSEN" });
    expect(agentFileProblem(store.getOrder(o.id)!, r.attachment)).toEqual({ key: "Sliced only to weigh the design: the agent slices it again to print" });
    expect(setAutoPrint({ on: true, by: "Khelda", confirm: true }).ok).toBe(true);
    expect(confirmColors("a1", "Khelda").ok).toBe(true);
    const agent = requestSlice({ orderId: o.id, attachmentId: weighing!.ok ? weighing!.job.attachmentId : "", printerId: "a1", tray: 0, by: "agent", actor: "agent" });
    expect(agent).toMatchObject({ ok: true, job: { actor: "agent", state: "queued" } });
    expect(agent.ok && agent.reused).toBeUndefined();
    // A person asking the same settings still gets the finished file.
    const person = requestSlice({ orderId: o.id, attachmentId: weighing!.ok ? weighing!.job.attachmentId : "", printerId: "a1", tray: 0, by: "Khelda" });
    expect(person.ok && person.reused).toBe("active"); // the agent's slice with the same key is running
  });

  it("only orders waiting for their price are weighed, and the customer sees nothing without a design of their own", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    expect(designOf(o)).toBeNull();
    const d = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    store.saveOrder({ ...store.getOrder(o.id)!, status: "PLAN_CHOSEN" });
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "weighing", estimate: null }); // still theirs to see, no estimate
    const r = requestSlice({ orderId: o.id, attachmentId: d.attachment!.id, printerId: "a1", tray: 1, by: AUTO_WEIGH_BY, actor: "system" });
    expect(r).toMatchObject({ ok: false, status: 409, error: "Order is PLAN_CHOSEN; nothing to slice now" });
  });

  it("weighs only a mesh with the studio's presets: a 3MF project on the order is left to a person", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const up = await addAttachment(o.id, { kind: "design", filename: "clip.3mf", bytes: PROJECT, uploadedBy: CUSTOMER_UPLOAD_BY });
    if (!up.ok) throw new Error(up.error);
    expect(startAutoWeigh(o.id, up.attachment.id)).toEqual({ ok: false, reasons: ["Only an STL or OBJ is weighed automatically: a person enters the grams"] });
    expect(store.listSliceJobs()).toEqual([]);
    expect(store.listLog(o.id).at(-1)).toMatchObject({ tool: "auto_weigh", ok: false });
  });

  it(`at most ${MAX_ACTIVE_WEIGHING} weighings wait at once: the rest of the studio PC's queue stays free for people and the agent`, async () => {
    studio();
    noteSlicerPoll();
    const sent = [];
    for (let i = 0; i <= MAX_ACTIVE_WEIGHING; i++) sent.push(await addCustomerDesign(order().id, { filename: `Clip ${i}.stl`, bytes: ASCII_STL }));
    expect(sent.map((d) => d.weighing?.ok)).toEqual([...new Array(MAX_ACTIVE_WEIGHING).fill(true), false]);
    expect(sent.at(-1)!.weighing).toEqual({ ok: false, reasons: ["Too many designs are being weighed: a person enters the grams"] });
    expect(newOrderWake(sent.at(-1)!)).toMatch(/could not start \(Too many designs are being weighed.*ask the operator/);
    const mine = await addAttachment(order().id, { kind: "design", filename: "Mine.stl", bytes: ASCII_STL, uploadedBy: "Khelda" });
    if (!mine.ok) throw new Error(mine.error);
    expect(requestSlice({ orderId: mine.attachment.orderId, attachmentId: mine.attachment.id, printerId: "a1", tray: 0, by: "Khelda" }).ok).toBe(true);
  });

  it("a disk error while storing the design never throws: the order stays, it is logged without the error text, and a person weighs it", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    setFileStore({ ...files, async put() { throw new Error("ENOSPC: no space left on device, open 'L:/kesuni/files/F-1.stl'"); } });
    const d = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    expect(d).toEqual({ stored: false });
    expect(store.getOrder(o.id)!.status).toBe("CREATED");
    expect(store.listAttachments(o.id)).toEqual([]);
    expect(store.listSliceJobs()).toEqual([]);
    const row = store.listLog(o.id).find((e) => e.tool === "customer_design")!;
    expect(row).toMatchObject({ ok: false, output: { error: "The design could not be stored" } });
    expect(JSON.stringify(row)).not.toMatch(/ENOSPC|kesuni\/files/);
    expect(newOrderWake(d)).toMatch(/^A customer just placed this order through the order form\. Prepare it: .*ask the operator/);
  });
});

describe("what the customer sees of their design (the order page's \"Your design\")", () => {
  const KEYS = ["name", "bytes", "sizeMm", "state", "gramsPerPiece", "printMinutesPerPiece", "material", "colourName", "colourHex", "estimate", "priced"];

  it("weighed: their file, its size, weight, print time, the spool, and the estimate the quote by weight gives; nothing else", async () => {
    studio();
    noteSlicerPoll();
    const o = order({ material: "PLA", colors: [{ type: "PLA", color: "#FEC600" }] });
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    await slicedBack(weighing!.ok ? weighing!.job.id : "");
    const d = designOf(store.getOrder(o.id)!)!;
    expect(Object.keys(d).sort()).toEqual([...KEYS].sort());
    expect(d).toEqual({
      name: "Clip.stl", bytes: ASCII_STL.byteLength, sizeMm: [1, 1, 0], state: "weighed", gramsPerPiece: 16.4, printMinutesPerPiece: 25,
      material: "PLA", colourName: "Yellow", colourHex: "#FEC600",
      // 16.4 g × Rp1.500 = Rp24.600, rounded up to Rp25.000 per piece, × 3 pieces
      estimate: { unitIdr: 25_000, totalIdr: 75_000, usdc: expect.stringMatching(/^\d+(\.\d+)?$/) }, priced: false,
    });
    // The very numbers Kesuni's quote by weight gives for the same grams.
    const q = quoteByWeight(o.id, { gramsPerUnit: 16.4, source: "slicer", by: "agent" });
    if (!q.ok) throw new Error(q.error);
    expect(d.estimate).toEqual({ unitIdr: q.price.unitPriceIdr, totalIdr: q.price.totalIdr, usdc: microToUsdc(q.quote.priceMicro) });
    // The whole customer view: no printer, tray, sliced file, cost per gram or margin anywhere in the design.
    const view = customerView(store.getOrder(o.id)!, o.customerToken!);
    expect(JSON.stringify(view.design)).not.toMatch(/a1|tray|printer|gcode|cost|margin|perGram|F-[0-9a-f]{8}|Slicer/i);
  });

  it("a person's grams: weighed and estimated in the order's material, without the automatic slice's time or spool", async () => {
    process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG = "2000";
    try {
      const o = order({ material: "PETG" });
      await addCustomerDesign(o.id, { filename: "Clip.obj", bytes: OBJ }); // no PETG reports now: not weighed automatically
      expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "check", gramsPerPiece: null, estimate: null, sizeMm: [1, 1, 0] });
      expect(setSlicerGrams(o.id, { gramsPerUnit: 10, source: "Bambu Studio, plate 1", by: "Khelda" }).ok).toBe(true);
      expect(designOf(store.getOrder(o.id)!)).toMatchObject({
        state: "weighed", gramsPerPiece: 10, printMinutesPerPiece: null, material: null, colourName: null, colourHex: null,
        estimate: { unitIdr: 20_000, totalIdr: 60_000 },
      });
    } finally {
      delete process.env.KESUNI_PRICE_PER_GRAM_IDR_PETG;
    }
  });

  it("once Kesuni's price exists the card is short: no estimate (the price block shows the real price), no new design", async () => {
    studio();
    noteSlicerPoll();
    const o = order();
    const { weighing } = await addCustomerDesign(o.id, { filename: "Clip.stl", bytes: ASCII_STL });
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "weighing", gramsPerPiece: null, estimate: null, priced: false });
    await slicedBack(weighing!.ok ? weighing!.job.id : "");
    const q = quoteByWeight(o.id, { gramsPerUnit: 16.4, source: "slicer", by: "agent" });
    if (!q.ok) throw new Error(q.error);
    store.saveOrder({ ...store.getOrder(o.id)!, chosenQuoteId: q.quote.id, status: "PLAN_CHOSEN" });
    expect(designOf(store.getOrder(o.id)!)).toMatchObject({ state: "weighed", gramsPerPiece: 16.4, estimate: null, priced: true });
    expect(customerView(store.getOrder(o.id)!, o.customerToken!).canAddDesign).toBe(false);
  });

  it("only the customer's own STL or OBJ: none for a file a person added or a 3MF under the customer's name", async () => {
    const o = order();
    await addAttachment(o.id, { kind: "design", filename: "Kesuni.stl", bytes: ASCII_STL, uploadedBy: "Khelda" });
    await addAttachment(o.id, { kind: "design", filename: "clip.3mf", bytes: PROJECT, uploadedBy: CUSTOMER_UPLOAD_BY });
    expect(designOf(store.getOrder(o.id)!)).toBeNull();
    expect(customerView(store.getOrder(o.id)!, o.customerToken!).canAddDesign).toBe(false); // a design of theirs is there (a 3MF)
    const fresh = order();
    expect(designOf(fresh)).toBeNull();
    expect(customerView(fresh, fresh.customerToken!).canAddDesign).toBe(true);
  });

  it("the Chief hears a design added later in the same words, with only the first line changed", async () => {
    studio();
    noteSlicerPoll();
    const d = await addCustomerDesign(order().id, { filename: "Clip.stl", bytes: ASCII_STL });
    expect(newOrderWake(d, "later")).toBe(newOrderWake(d).replace(
      "A customer just placed this order through the order form with their own design", "The customer just added their own design to this order on their order page"));
    expect(newOrderWake(d, "later")).toMatch(/^The customer just added their own design to this order on their order page\. The studio's slicer is weighing it/);
  });
});

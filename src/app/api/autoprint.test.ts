import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import * as store from "@/lib/store";
import { chooseQuote } from "@/lib/actions";
import { addAttachment, setFileStore, type FileStore } from "@/lib/files";
import { confirmColors, ingestReport } from "@/lib/printer/actions";
import { mergeReport } from "@/lib/printer/bambu";
import { resetSlicerSeen, sliceQueue, updateSliceItem } from "@/lib/slicing";
import { md5 } from "@/lib/slicing";
import { fake3mf } from "@/lib/threemf.test-helper";
import { GET as getAutoPrint, POST as postAutoPrint } from "./auto-print/route";
import { POST as orderRuns } from "./orders/[id]/auto-print/route";
import { GET as getOrder } from "./orders/[id]/route";
import { POST as printerAction } from "./printers/[id]/route";
import { POST as bedEmpty } from "./printers/[id]/bed/route";
import { SLICER_NAME } from "@/lib/slice-rules";
import { GET as listPrinters } from "./printers/route";
import { POST as printerReport } from "./printers/report/route";
import { POST as taskDone } from "./tasks/[id]/route";
import { POST as sliceResult } from "./slicer/jobs/[id]/result/route";

// Agent prints through the routes: the switch, "Bed is empty", runs, and the triggers that run the dispatcher.
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const TOKEN = "bridge-token-123";
const ORDER = "ORD-001";
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://x${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
const IDLE = {
  gcode_state: "IDLE", sdcard: true, hms: [], nozzle_diameter: "0.4",
  ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "" }] }] },
};
const sliced = (color = "#FCE300") => fake3mf({ projectColours: [color], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color, usedG: 9 }] }] });

async function paidOrder(bytes: Uint8Array | null = sliced(), filename = "Benchy.gcode.3mf") {
  store.saveOrder({ ...store.getOrder(ORDER)!, label: "real", preferredColors: [{ type: "PLA", color: "#FEC600", name: "Yellow" }] });
  store.saveEscrow({
    orderId: ORDER, amountMicro: 30_000_000, escrowWalletId: "w1", escrowAddress: "0xe", customerWalletId: "w2", customerAddress: "0xc",
    state: "FUNDED", txs: [], network: "ARC-TESTNET", label: "testnet", createdAt: new Date().toISOString(),
  });
  if (!bytes) return;
  // A .gcode.3mf as the studio PC makes it (the agent prints only those): the STL first, then a done slice links them.
  const sliced = filename.endsWith(".gcode.3mf");
  const src = sliced ? await addAttachment(ORDER, { kind: "design", filename: "Benchy.stl", bytes: new TextEncoder().encode("solid b\nendsolid b\n"), uploadedBy: "Khelda" }) : null;
  const up = await addAttachment(ORDER, { kind: "design", filename, bytes, uploadedBy: sliced ? SLICER_NAME : "Khelda" });
  if (!up.ok || (src && !src.ok)) throw new Error("upload failed");
  if (src?.ok) {
    const at = new Date().toISOString();
    store.insertSliceJob({
      id: store.nextSliceJobId(), orderId: ORDER, attachmentId: src.attachment.id, sourceName: "Benchy.stl", mode: "mesh", printerId: "a1", tray: 0,
      material: "PLA", color: "#FCE300", quality: "standard", infillPct: 20, supports: "auto", key: "test", state: "done", actor: "person", by: "Khelda",
      createdAt: at, updatedAt: at, resultAttachmentId: up.attachment.id,
    });
  }
}
const bed = (by: string, body: Record<string, unknown> = { confirm: true }) => bedEmpty(json("/api/printers/a1/bed", { by, ...body }), ctx("a1"));
const switchOn = async () => (await postAutoPrint(json("/api/auto-print", { on: true, by: "Khelda", confirm: true }))).json();

beforeEach(() => {
  store.resetDb();
  mem.clear();
  setFileStore(files);
  resetSlicerSeen();
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  chooseQuote(ORDER, "Q-own", "agent", "within budget");
  ingestReport("a1", mergeReport(undefined, { print: IDLE }, new Date().toISOString())!, []);
  confirmColors("a1", "Khelda");
});
afterEach(() => { delete process.env.PRINTER_BRIDGE_TOKEN; });
afterAll(() => setFileStore(undefined));

describe("agent prints through the API", () => {
  it("the switch: a person's name and confirm; GET shows it, the plan and the last decisions", async () => {
    expect((await postAutoPrint(json("/api/auto-print", { on: true, by: "Khelda" }))).status).toBe(400);
    expect((await postAutoPrint(json("/api/auto-print", { on: true, by: "Claude", confirm: true }))).status).toBe(400);
    const on = await switchOn();
    expect(on).toMatchObject({ on: true, by: "Khelda", cancelled: [], dispatch: { started: [], sliced: [] } });
    const g = await (await getAutoPrint()).json();
    expect(g).toMatchObject({ on: true, by: "Khelda", locked: false, plan: { on: true, printers: { a1: { bed: null } } } });
    expect(g.feed.map((e: { tool: string }) => e.tool)).toContain("auto_print_switch");
    const off = await (await postAutoPrint(json("/api/auto-print", { on: false, by: "Aini", confirm: true }))).json();
    expect(off).toMatchObject({ on: false, by: "Aini", dispatch: null });
  });

  it("'Bed is empty' (POST /api/printers/:id/bed) needs a person and confirm, then the dispatcher runs at once and starts the paid order", async () => {
    await paidOrder();
    await switchOn();
    expect((await bed("agent")).status).toBe(400);
    expect((await bed("Khelda", {})).status).toBe(400); // no confirm
    // The order page's "Bed is empty" frees the bed only: no agent print from it.
    const plain = await (await printerAction(json("/api/printers/a1", { action: "clear_bed", by: "Khelda" }), ctx("a1"))).json();
    expect(plain.printer.bedCheck).toBeUndefined();
    expect(store.listPrintJobs()).toEqual([]);
    const res = await bed("Khelda");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ granted: true, dispatch: { on: true, started: [{ orderId: ORDER, printerId: "a1" }] } });
    expect(body.printer.bedCheck).toMatchObject({ by: "Khelda", usedBy: body.dispatch.started[0].jobId });
  });

  it("GET /api/printers carries the plan: agent prints on or off and each printer's next print", async () => {
    await paidOrder();
    const off = await (await listPrinters()).json();
    expect(off.autoPrint).toMatchObject({ on: false, printers: { a1: { why: { key: "Agent prints are off" } } } });
    await switchOn();
    const on = await (await listPrinters()).json();
    expect(on.autoPrint.printers.a1).toMatchObject({ next: { orderId: ORDER }, why: { key: "Waiting for a person to confirm the bed is empty" } });
    const order = await (await getOrder(new Request("http://x/api/orders/ORD-001"), ctx(ORDER))).json();
    expect(order.autoPrint).toMatchObject({ on: true, runsSet: false, line: { runsNeeded: 1, runsDone: 0, why: { key: "Waiting for a person to confirm the bed on {printer}" } } });
  });

  it("runs on an order: a person sets them (0 to 50) and the dispatcher runs", async () => {
    await paidOrder();
    expect((await orderRuns(json("/api/orders/ORD-001/auto-print", { runsNeeded: 99, by: "Khelda" }), ctx(ORDER))).status).toBe(400);
    const r = await (await orderRuns(json("/api/orders/ORD-001/auto-print", { runsNeeded: 3, by: "Khelda" }), ctx(ORDER))).json();
    expect(r).toMatchObject({ order: { autoPrint: { runsNeeded: 3, by: "Khelda" } }, autoPrint: { runsSet: true, line: { runsNeeded: 3 } }, started: [] });
  });

  it("a collect task marked done frees the bed but starts nothing: the agent waits for 'Bed is empty'", async () => {
    await paidOrder();
    // Two runs: the collect task is the first one (a finished print of the order).
    store.saveOrder({ ...store.getOrder(ORDER)!, autoPrint: { runsNeeded: 2, by: "Khelda", at: new Date().toISOString() } });
    await switchOn();
    store.savePrinter({ ...store.getPrinter("a1")!, bedOccupiedBy: ORDER });
    store.saveTask({ id: "T-c", orderId: ORDER, kind: "collect_and_qc", printerId: "a1", text: "Collect", status: "open", createdBy: "agent", at: new Date().toISOString() });
    const r = await (await taskDone(json("/api/tasks/T-c", { by: "Aini" }), ctx("T-c"))).json();
    expect(r.dispatch).toMatchObject({ on: true, started: [] });
    expect(store.getPrinter("a1")!.bedOccupiedBy).toBeUndefined();
    expect((await (await bed("Aini")).json()).dispatch).toMatchObject({ started: [{ orderId: ORDER, printerId: "a1" }] });
  });

  it("a printer report runs the dispatcher: a printer that became ready takes the waiting order", async () => {
    await paidOrder();
    await switchOn();
    // The bed was confirmed, but the printer had not reported for 2 minutes: nothing could start.
    store.savePrinter({ ...store.getPrinter("a1")!, lastSeen: new Date(Date.now() - 120_000).toISOString() });
    expect((await bed("Khelda")).status).toBe(200);
    expect(store.listPrintJobs()).toEqual([]);
    const snapshot = mergeReport(undefined, { print: IDLE }, new Date().toISOString());
    const res = await printerReport(json("/api/printers/report", { printerId: "a1", snapshot, events: [] }, { authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
    expect(store.listPrintJobs()).toEqual([expect.objectContaining({ actor: "agent", printerId: "a1", bedConfirmedBy: "Khelda" })]);
  });

  it("a slice arriving from the studio PC runs the dispatcher", async () => {
    await paidOrder(new TextEncoder().encode("solid cube\nendsolid cube\n"), "Kubus.stl");
    sliceQueue();
    const on = await switchOn();
    const sliceId = on.dispatch.sliced[0].sliceId as string;
    await bed("Khelda");
    expect(store.listPrintJobs()).toEqual([]);
    updateSliceItem(sliceId, { state: "slicing" });
    const bytes = sliced("#FEC600");
    const res = await sliceResult(new Request(`http://x/api/slicer/jobs/${sliceId}/result`, {
      method: "POST", body: bytes as BodyInit, headers: { "content-type": "model/3mf", "x-file-md5": md5(bytes), authorization: `Bearer ${TOKEN}` },
    }), ctx(sliceId));
    expect(res.status).toBe(201);
    expect(store.listPrintJobs()).toEqual([expect.objectContaining({ actor: "agent", printerId: "a1" })]);
  });
});

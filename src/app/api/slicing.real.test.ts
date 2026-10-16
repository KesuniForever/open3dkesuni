import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as store from "@/lib/store";
import { addAttachment, setFileStore, type FileStore } from "@/lib/files";
import { ingestReport } from "@/lib/printer/actions";
import { mergeReport } from "@/lib/printer/bambu";
import { requestSlice } from "@/lib/slicing";
import { canStartPrint } from "@/lib/printer/control";
import { matchJob } from "@/lib/colors";
import { GET as queue } from "./slicer/queue/route";
import { POST as queueItem } from "./slicer/queue/[id]/route";
import { GET as source } from "./slicer/jobs/[id]/source/route";
import { POST as result } from "./slicer/jobs/[id]/result/route";
import { createSliceRunner } from "../../../scripts/bridge/slice-runner.mjs";
import { sliceModel, slicerConfig } from "../../../scripts/bridge/slicer.mjs";

// The whole slice path with the REAL Bambu Studio on the studio PC: a person asks in the app (in-memory database), the
// bridge's slice runner takes it through the app's own route handlers, slices with Bambu Studio's command line, uploads
// the .gcode.3mf, and the app stores it on the order where "Colours & print" can print it. Nothing reaches a printer.
// Opt-in (needs Bambu Studio): KESUNI_REAL_SLICER=1 npx vitest run src/app/api/slicing.real.test.ts
const REAL = process.env.KESUNI_REAL_SLICER === "1";
const cfg = slicerConfig(process.env);
const mem = new Map<string, Uint8Array>();
const files: FileStore = { async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); } };
const TOKEN = "real-slicer-token";

/** A 20 mm cube, ASCII STL, 12 triangles. */
function cubeStl(size = 20): Uint8Array {
  const v = (x: number, y: number, z: number) => [x * size, y * size, z * size].join(" ");
  const quads: [number[], number[], number[], number[], string][] = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0], "0 0 -1"], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1], "0 0 1"],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], "0 -1 0"], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0], "0 1 0"],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0], "-1 0 0"], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1], "1 0 0"],
  ];
  const facet = (n: string, a: number[], b: number[], c: number[]) =>
    `facet normal ${n}\n outer loop\n  vertex ${v(a[0], a[1], a[2])}\n  vertex ${v(b[0], b[1], b[2])}\n  vertex ${v(c[0], c[1], c[2])}\n endloop\nendfacet\n`;
  const body = quads.map(([a, b, c, d, n]) => facet(n, a, b, c) + facet(n, a, c, d)).join("");
  return new TextEncoder().encode(`solid cube\n${body}endsolid cube\n`);
}

/** The bridge's fetch, answered by the app's route handlers (no network). */
async function appFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url).pathname;
  const req = new Request(url, init);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  let m: RegExpExecArray | null;
  if (path === "/api/slicer/queue") return queue(req);
  if ((m = /^\/api\/slicer\/queue\/([^/]+)$/.exec(path))) return queueItem(req, ctx(decodeURIComponent(m[1])));
  if ((m = /^\/api\/slicer\/jobs\/([^/]+)\/source$/.exec(path))) return source(req, ctx(decodeURIComponent(m[1])));
  if ((m = /^\/api\/slicer\/jobs\/([^/]+)\/result$/.exec(path))) return result(req, ctx(decodeURIComponent(m[1])));
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  store.resetDb();
  mem.clear();
  setFileStore(files);
  process.env.PRINTER_BRIDGE_TOKEN = TOKEN;
  ingestReport("a1", mergeReport(undefined, { print: {
    gcode_state: "IDLE", sdcard: true, nozzle_diameter: "0.4", hms: [],
    ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "FFFFFFFF", tray_sub_brands: "PLA Basic" }, { id: "1" },
      { id: "2", tray_type: "PETG", tray_color: "1E90FFFF", tray_sub_brands: "" }, { id: "3" }] }] },
  } }, new Date().toISOString())!, []);
});
afterAll(() => { setFileStore(undefined); delete process.env.PRINTER_BRIDGE_TOKEN; });

describe.skipIf(!REAL || !cfg.on)("slicing with the real Bambu Studio (opt-in)", () => {
  it("an STL becomes a printable A1 .gcode.3mf on the order, with the picked spool's colour", async () => {
    const up = await addAttachment("ORD-001", { kind: "design", filename: "Kubus Uji (v2).STL", bytes: cubeStl(), uploadedBy: "Aini" });
    if (!up.ok) throw new Error(up.error);
    const asked = requestSlice({ orderId: "ORD-001", attachmentId: up.attachment.id, printerId: "a1", tray: 2, quality: "standard", infillPct: 20, supports: "auto", by: "Khelda" });
    if (!asked.ok) throw new Error(asked.error);

    const workRoot = mkdtempSync(join(tmpdir(), "kesuni-slicer-e2e-"));
    const logs: string[] = [];
    const runner = createSliceRunner({
      apps: ["http://studio.test"], token: TOKEN, fetch: appFetch, log: (t: string) => logs.push(t), warn: (t: string) => logs.push(t),
      slice: (req: Omit<Parameters<typeof sliceModel>[0], "profilesDir" | "workRoot">) => sliceModel({ ...req, exe: cfg.exe, profilesDir: cfg.profilesDir, workRoot }),
    });
    await runner.pollOnce();
    console.log(logs.join("\n"));

    const job = store.getSliceJob(asked.job.id)!;
    expect(job).toMatchObject({ state: "done", material: "PETG", color: "#1E90FF" });
    const file = store.getAttachment(job.resultAttachmentId!)!;
    expect(file).toMatchObject({ filename: "Kubus Uji (v2) PETG Blue 0.2mm.gcode.3mf", uploadedBy: "Bambu Studio (slicer)" });
    const info = file.parsed3mf!;
    expect(info).toMatchObject({ sliced: true, printerModel: "Bambu Lab A1", printerModelId: "N2S", nozzle: "0.4", projectFilaments: [{ type: "PETG", color: "#1E90FF" }] });
    expect(info.plates).toHaveLength(1);
    expect(info.plates[0]).toMatchObject({ bedType: "textured_plate", filaments: [{ id: 1, type: "PETG", color: "#1E90FF", infoIdx: "GFG00" }] });
    expect(info.plates[0].weightG).toBeGreaterThan(1);
    expect(job.result!.priceIdr).toBeGreaterThan(0);
    // "Colours & print" would print it on #1 from slot 3, the spool that was picked.
    const printer = store.getPrinter("a1")!;
    const match = matchJob(info.plates[0].filaments, printer, 1);
    expect(match).toMatchObject({ ok: true, mapping: [2] });
    const verdict = canStartPrint(printer, { info, plate: 1, amsMapping: [2], options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true },
      bedEmptyConfirmed: true, personPresent: true, by: "Khelda", orderId: "ORD-001" }, Date.now());
    expect(verdict).toMatchObject({ ok: true, reasons: [] });
    expect(readdirSync(workRoot)).toEqual([]);
    rmSync(workRoot, { recursive: true, force: true });
  }, 120_000);
});

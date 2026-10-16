import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as store from "./store";
import { chooseQuote, addEvidence } from "./actions";
import { addAttachment, fileStore, removeAttachment, setFileStore, type FileStore } from "./files";
import { describeEntry } from "./ops";
import { tLib } from "./lib-text";
import { callTool, TOOLS } from "./agent/tools";
import { makeT } from "@/i18n/core";
import { ID } from "@/i18n/id";
import type { Attachment, PrintJob, PrintJobState } from "./types";
import type { PrinterState } from "./printer/bambu";
import { GET as download } from "@/app/api/files/[id]/route";
import { DELETE as removeRoute } from "@/app/api/orders/[id]/files/[fileId]/route";
import * as customerFile from "@/app/api/c/[token]/files/[fileId]/route";
import * as customerOrder from "@/app/api/c/[token]/route";

const mem = new Map<string, Uint8Array>();
const fake: FileStore = {
  async put(k, b) { mem.set(k, b); }, async get(k) { return mem.get(k)!; }, async remove(k) { mem.delete(k); },
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const STL = new TextEncoder().encode("solid cube\nendsolid cube\n");
const ORDER = "ORD-001";

beforeEach(() => { store.resetDb(); mem.clear(); setFileStore(fake); });
afterAll(() => setFileStore(undefined));

describe("order attachments", () => {
  it("stores a design file under its id, never under the uploaded name", async () => {
    const r = await addAttachment(ORDER, { kind: "design", filename: "../../etc/clicker v2.stl", bytes: STL, uploadedBy: "Aini" });
    expect(r.ok).toBe(true);
    const a = r.ok ? r.attachment : undefined!;
    expect(a.filename).toBe("clicker v2.stl");
    expect(a.storageKey).toBe(`${a.id}.stl`);
    expect(store.listAttachments(ORDER)).toHaveLength(1);
  });

  it("refuses the wrong type, an empty file, and a fake image", async () => {
    expect((await addAttachment(ORDER, { kind: "design", filename: "virus.exe", bytes: STL, uploadedBy: "x" })).ok).toBe(false);
    expect((await addAttachment(ORDER, { kind: "design", filename: "a.stl", bytes: new Uint8Array(), uploadedBy: "x" })).ok).toBe(false);
    const fakePng = await addAttachment(ORDER, { kind: "reference", filename: "ref.png", bytes: STL, uploadedBy: "x" });
    expect(!fakePng.ok && fakePng.reasons).toContain("File content is not a real image");
  });

  it("a QC photo becomes photo evidence but never counts as the QC result", async () => {
    chooseQuote(ORDER, "Q-own", "agent", "ok");
    addEvidence(ORDER, { kind: "log", note: "printing", label: "manual" });
    const r = await addAttachment(ORDER, { kind: "qc_photo", filename: "qc.png", bytes: PNG, uploadedBy: "Khelda" });
    expect(r.ok).toBe(true);
    const ev = store.listEvidence(ORDER);
    expect(ev.at(-1)).toMatchObject({ kind: "photo", attachmentId: r.ok ? r.attachment.id : "" });
    expect(ev.some((e) => e.kind === "qc")).toBe(false);
  });

  it("downloads the bytes with a safe content type", async () => {
    const r = await addAttachment(ORDER, { kind: "reference", filename: "ref.png", bytes: PNG, uploadedBy: "Aini" });
    const id = r.ok ? r.attachment.id : "";
    const res = await download(new Request("http://x"), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });
});

// ---------- a person removes a file ----------

const uploaded = async (kind: Attachment["kind"] = "design", orderId = ORDER): Promise<Attachment> => {
  const r = kind === "design"
    ? await addAttachment(orderId, { kind, filename: "obj_1_scraper.stl", bytes: STL, uploadedBy: "Khelda" })
    : await addAttachment(orderId, { kind, filename: "qc.png", bytes: PNG, uploadedBy: "Khelda" });
  if (!r.ok) throw new Error(r.error);
  return r.attachment;
};
/** The order in production (a log line is evidence), so QC photos can be uploaded. */
const inProduction = () => {
  chooseQuote(ORDER, "Q-own", "agent", "ok");
  addEvidence(ORDER, { kind: "log", note: "printing", label: "manual" });
};
const job = (a: Attachment, state: PrintJobState, at = new Date().toISOString(), id = `PJ-${state}-x`): PrintJob => {
  const j: PrintJob = {
    id, orderId: a.orderId, printerId: "a1", attachmentId: a.id, plate: 1, fileName: "ORD-001_p1.gcode.3mf", amsMapping: [0],
    options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: true }, state, by: "Khelda", createdAt: at, updatedAt: at,
  };
  store.savePrintJob(j);
  return j;
};
/** Printer a1 as it last reported: its state, and when (a print is only "on the printer" while it reports). */
const printer = (state: PrinterState, lastSeen = new Date().toISOString()) => store.savePrinter({
  id: "a1", name: "A1 #1", lastSeen, snapshot: {
    state, percent: 40, remainingMin: 30, layer: 10, totalLayers: 100, jobName: "ORD-001", errorCode: 0, nozzleTemp: 220, bedTemp: 65, at: lastSeen,
  },
});
const del = (orderId: string, fileId: string, body: unknown, type = "application/json") =>
  removeRoute(new Request(`http://x/api/orders/${orderId}/files/${fileId}`, {
    method: "DELETE", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ id: orderId, fileId }) });

describe("removing an order file (a person only)", () => {
  it("removes the row and the bytes, and logs who removed what", async () => {
    const a = await uploaded();
    const other = await uploaded();
    const r = await removeAttachment(ORDER, a.id, " Khelda ");
    expect(r).toMatchObject({ ok: true, evidenceRemoved: [], bytesRemoved: true });
    expect(store.getAttachment(a.id)).toBeUndefined();
    expect(mem.has(a.storageKey)).toBe(false);
    // The same name uploaded twice: only the one asked for goes.
    expect(store.listAttachments(ORDER).map((x) => x.id)).toEqual([other.id]);
    expect(mem.has(other.storageKey)).toBe(true);
    expect(store.listLog(ORDER).at(-1)).toMatchObject({
      actor: "human", tool: "remove_file", ok: true,
      input: { fileId: a.id, filename: "obj_1_scraper.stl", kind: "design", size: STL.byteLength, by: "Khelda" },
      output: { evidenceRemoved: [], storageKey: a.storageKey },
    });
    expect(store.listLog(ORDER).filter((e) => e.tool === "remove_file")).toHaveLength(1);
    // Gone for the download link too.
    expect((await download(new Request("http://x"), { params: Promise.resolve({ id: a.id }) })).status).toBe(404);
  });

  it("refuses while a print job uses the file (queued, uploading, sent or printing)", async () => {
    const a = await uploaded();
    printer("RUNNING");
    for (const state of ["queued", "uploading", "sent", "printing"] as const) {
      const j = job(a, state);
      const r = await removeAttachment(ORDER, a.id, "Khelda");
      expect(r, state).toMatchObject({
        ok: false, status: 409, error: "The file cannot be removed now",
        reasons: [`Print job ${j.id} is still using this file: cancel or stop the print first`],
      });
      store.savePrintJob({ ...j, state: "cancelled" });
    }
    expect(store.getAttachment(a.id)).toBeDefined();
    expect(mem.has(a.storageKey)).toBe(true);
    expect(store.listLog(ORDER).some((e) => e.tool === "remove_file")).toBe(false);
    // Ended jobs (done, failed, cancelled) do not hold the file.
    job(a, "done");
    job(a, "failed");
    expect((await removeAttachment(ORDER, a.id, "Khelda")).ok).toBe(true);
  });

  it("a print that is no longer on the printer (power cut, unplugged, a newer job) does not hold the file", async () => {
    // Nothing ends such a job (the printer never reports FINISH for it), and nobody can cancel or stop it.
    const a = await uploaded();
    const j = job(a, "printing");
    for (const [state, seen, why] of [
      ["IDLE", new Date().toISOString(), "came back idle"],
      ["RUNNING", new Date(Date.now() - 3 * 60_000).toISOString(), "offline"],
    ] as const) {
      printer(state, seen);
      expect(await removeAttachment(ORDER, a.id, "Khelda"), why).toMatchObject({ ok: true });
      store.saveAttachment(a); // back, for the next case
    }
    // The printer is printing, but a newer job: this one is lost.
    printer("RUNNING");
    expect((await removeAttachment(ORDER, a.id, "Khelda")).ok).toBe(false);
    const b = await uploaded();
    job(b, "printing", new Date().toISOString(), "PJ-newer");
    expect(await removeAttachment(ORDER, a.id, "Khelda")).toMatchObject({ ok: true });
    expect(store.getPrintJob(j.id)!.state).toBe("printing"); // the job itself is left as it is
    // ...and the newer one, on the running printer, holds its own file.
    expect(await removeAttachment(ORDER, b.id, "Khelda")).toMatchObject({
      ok: false, reasons: ["Print job PJ-newer is still using this file: cancel or stop the print first"],
    });
  });

  it("a job on one copy of a file never holds the other copies (the same STL uploaded twice)", async () => {
    const copyA = await uploaded();
    const copyB = await uploaded();
    expect(copyA.filename).toBe(copyB.filename);
    printer("RUNNING");
    const j = job(copyA, "printing");
    expect(await removeAttachment(ORDER, copyB.id, "Khelda")).toMatchObject({ ok: true });
    expect(await removeAttachment(ORDER, copyA.id, "Khelda")).toMatchObject({
      ok: false, status: 409, reasons: [`Print job ${j.id} is still using this file: cancel or stop the print first`],
    });
    expect(store.listAttachments(ORDER).map((x) => x.id)).toEqual([copyA.id]);
  });

  it("a stale queued job that will never run does not hold the file", async () => {
    const a = await uploaded();
    const j = job(a, "queued", new Date(Date.now() - 10 * 60_000).toISOString());
    expect((await removeAttachment(ORDER, a.id, "Khelda")).ok).toBe(true);
    expect(store.getPrintJob(j.id)!.state).toBe("failed");
  });

  it("a QC photo can go while the order is in production, with its photo evidence", async () => {
    inProduction();
    const a = await uploaded("qc_photo");
    const keep = await uploaded("qc_photo");
    const ev = store.listEvidence(ORDER).find((e) => e.attachmentId === a.id)!;
    expect(await removeAttachment(ORDER, a.id, "Khelda")).toMatchObject({ ok: true, evidenceRemoved: [ev.id] });
    const left = store.listEvidence(ORDER);
    expect(left.some((e) => e.attachmentId === a.id)).toBe(false);
    // The other photo and the log line stay; the order does not move.
    expect(left.some((e) => e.attachmentId === keep.id)).toBe(true);
    expect(left.some((e) => e.kind === "log")).toBe(true);
    expect(store.getOrder(ORDER)!.status).toBe("IN_PRODUCTION");
    expect(store.listLog(ORDER).at(-1)!.output).toMatchObject({ evidenceRemoved: [ev.id] });
  });

  it("a QC photo stays once evidence is submitted (the customer and the escrow release rely on it)", async () => {
    inProduction();
    const a = await uploaded("qc_photo");
    const design = await uploaded("design");
    addEvidence(ORDER, { kind: "qc", note: "QC passed", label: "manual" });
    expect(store.getOrder(ORDER)!.status).toBe("EVIDENCE_SUBMITTED");
    expect(await removeAttachment(ORDER, a.id, "Khelda")).toMatchObject({
      ok: false, status: 409, error: "The file cannot be removed now",
      reasons: ["Order is EVIDENCE_SUBMITTED; a QC photo stays once evidence is submitted"],
    });
    expect(store.getAttachment(a.id)).toBeDefined();
    expect(store.listEvidence(ORDER).some((e) => e.attachmentId === a.id)).toBe(true);
    for (const status of ["ACCEPTED", "REJECTED", "PAID"] as const) {
      store.saveOrder({ ...store.getOrder(ORDER)!, status });
      expect((await removeAttachment(ORDER, a.id, "Khelda")).ok, status).toBe(false);
    }
    // Other files of the order can still go.
    expect((await removeAttachment(ORDER, design.id, "Khelda")).ok).toBe(true);
  });

  it("needs a person's name: not empty, not the Chief", async () => {
    const a = await uploaded();
    for (const by of [undefined, "", "   ", "Chief", "agent", 42]) {
      expect(await removeAttachment(ORDER, a.id, by)).toMatchObject({ ok: false, status: 400, error: "A person's name is required" });
    }
    expect(store.getAttachment(a.id)).toBeDefined();
  });

  it("404 for an unknown order, an unknown file, or a file of another order", async () => {
    const a = await uploaded();
    expect(await removeAttachment("ORD-999", a.id, "Khelda")).toMatchObject({ ok: false, status: 404, error: "Order not found" });
    expect(await removeAttachment(ORDER, "F-nope", "Khelda")).toMatchObject({ ok: false, status: 404, error: "File not found" });
    store.saveOrder({ ...store.getOrder(ORDER)!, id: "ORD-002" });
    expect(await removeAttachment("ORD-002", a.id, "Khelda")).toMatchObject({ ok: false, status: 404, error: "File not found" });
    expect(store.getAttachment(a.id)).toBeDefined();
  });

  it("bytes already missing, or a store that fails to delete them, do not stop the removal", async () => {
    const a = await uploaded();
    mem.delete(a.storageKey);
    expect(await removeAttachment(ORDER, a.id, "Khelda")).toMatchObject({ ok: true, bytesRemoved: true });
    const b = await uploaded();
    setFileStore({ ...fake, async remove() { throw Object.assign(new Error("EPERM: operation not permitted, unlink 'L:/x/F-1.stl'"), { code: "EPERM" }); } });
    expect(await removeAttachment(ORDER, b.id, "Khelda")).toMatchObject({ ok: true, bytesRemoved: false });
    expect(store.getAttachment(b.id)).toBeUndefined();
    // The removal and who did it are logged; a second, failed row names the stored copy that stayed (no local path).
    expect(store.listLog(ORDER).slice(-2)).toMatchObject([
      { tool: "remove_file", ok: true, input: { fileId: b.id, by: "Khelda" }, output: { storageKey: b.storageKey } },
      {
        tool: "remove_file", ok: false, input: { fileId: b.id },
        output: { error: "The stored copy could not be deleted", storageKey: b.storageKey, bytesRemoved: false, code: "EPERM" },
      },
    ]);
    expect(JSON.stringify(store.listLog(ORDER).at(-1))).not.toMatch(/unlink|L:/);
    // A store that throws before it even starts (made by older code, without remove): still removed and logged, never half done.
    const c = await uploaded();
    setFileStore({ put: fake.put, get: fake.get } as unknown as FileStore);
    expect(await removeAttachment(ORDER, c.id, "Khelda")).toMatchObject({ ok: true, bytesRemoved: false });
    expect(store.getAttachment(c.id)).toBeUndefined();
    const rows = store.listLog(ORDER).filter((e) => e.tool === "remove_file");
    expect(rows.filter((e) => e.ok).map((e) => (e.input as { fileId: string }).fileId)).toEqual([a.id, b.id, c.id]);
    expect(rows.filter((e) => !e.ok).map((e) => (e.input as { fileId: string }).fileId)).toEqual([b.id, c.id]);
  });

  it("without a test store, the disk store is the current code's on every call (a dev server's hot reload keeps no old one)", async () => {
    // Older code kept its disk store on globalThis, where a hot reload left it without remove().
    (globalThis as Record<string, unknown>).__kesuniFiles = { put: fake.put, get: fake.get };
    setFileStore(undefined);
    try {
      expect(typeof fileStore().remove).toBe("function");
      expect(fileStore()).not.toBe((globalThis as Record<string, unknown>).__kesuniFiles);
    } finally {
      delete (globalThis as Record<string, unknown>).__kesuniFiles;
      setFileStore(fake);
    }
  });

  it("on disk: deletes the file, tolerates one already gone, and never takes a path as a key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kesuni-files-"));
    process.env.KESUNI_FILES_DIR = dir;
    setFileStore(undefined);
    try {
      const a = await uploaded();
      expect(readdirSync(dir)).toEqual([a.storageKey]);
      expect((await removeAttachment(ORDER, a.id, "Khelda")).ok).toBe(true);
      expect(readdirSync(dir)).toEqual([]);
      const b = await uploaded();
      unlinkSync(path.join(dir, b.storageKey));
      expect(await removeAttachment(ORDER, b.id, "Khelda")).toMatchObject({ ok: true, bytesRemoved: true });
      await expect(fileStore().remove("../kesuni.db")).rejects.toThrow(/Not a file key/);
      await expect(fileStore().remove("")).rejects.toThrow(/Not a file key/);
    } finally {
      delete process.env.KESUNI_FILES_DIR;
      setFileStore(fake);
      rmSync(dir, { recursive: true, force: true });
    }
    expect(existsSync(dir)).toBe(false);
  });

  it("DELETE /api/orders/:id/files/:fileId takes { by } as JSON and answers with reasons", async () => {
    const a = await uploaded();
    expect((await del(ORDER, a.id, "by=Khelda", "application/x-www-form-urlencoded")).status).toBe(400); // only JSON counts
    const noName = await del(ORDER, a.id, {});
    expect(noName.status).toBe(400);
    expect(await noName.json()).toMatchObject({ error: "A person's name is required" });
    expect((await del(ORDER, "F-nope", { by: "Khelda" })).status).toBe(404);
    printer("RUNNING");
    const j = job(a, "printing");
    const busy = await del(ORDER, a.id, { by: "Khelda" });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({
      error: "The file cannot be removed now", reasons: [`Print job ${j.id} is still using this file: cancel or stop the print first`],
    });
    store.savePrintJob({ ...j, state: "done" });
    const ok = await del(ORDER, a.id, { by: "Khelda" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ attachment: { id: a.id, filename: "obj_1_scraper.stl" }, evidenceRemoved: [], bytesRemoved: true });
    // A stored copy that stays is said in the answer.
    const b = await uploaded();
    setFileStore({ ...fake, async remove() { throw new Error("EBUSY"); } });
    try {
      expect(await (await del(ORDER, b.id, { by: "Khelda" })).json()).toMatchObject({ bytesRemoved: false });
    } finally {
      setFileStore(fake);
    }
    expect(store.getAttachment(a.id)).toBeUndefined();
  });

  it("the Chief has no tool for it, its code never calls it, and customers get no way to remove a file", () => {
    expect(Object.keys(customerFile)).toEqual(["GET"]);
    expect(Object.keys(customerOrder)).not.toContain("DELETE");
    for (const t of TOOLS) expect(t.name, t.name).not.toMatch(/remove|delete/i);
    expect(callTool("remove_file", { orderId: ORDER, fileId: "F-1" }).ok).toBe(false);
    const dir = path.join(process.cwd(), "src", "lib", "agent");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      expect(readFileSync(path.join(dir, file), "utf8"), file).not.toMatch(/removeAttachment|deleteAttachment|["']\.\.\/files["']/);
    }
  });

  it("the log line and the refusals read in English and Indonesian", async () => {
    const en = makeT("en", ID);
    const id = makeT("id", ID);
    const a = await uploaded();
    await removeAttachment(ORDER, a.id, "Khelda");
    const row = store.listLog(ORDER).at(-1)!;
    expect(describeEntry(row, en)).toEqual({ title: "File removed by Khelda", line: "obj_1_scraper.stl" });
    expect(describeEntry(row, id)).toEqual({ title: "File dihapus oleh Khelda", line: "obj_1_scraper.stl" });
    const failed = { ...row, ok: false, output: { error: "The stored copy could not be deleted", storageKey: "F-1.stl", bytesRemoved: false } };
    expect(describeEntry(failed, en)).toEqual({ title: "Stored copy not deleted", line: "obj_1_scraper.stl · F-1.stl" });
    expect(describeEntry(failed, id)).toEqual({ title: "Salinan tersimpan tidak terhapus", line: "obj_1_scraper.stl · F-1.stl" });
    const texts = [
      "The file cannot be removed now", "Print job PJ-3-mgq1x2 is still using this file: cancel or stop the print first",
      "Order is EVIDENCE_SUBMITTED; a QC photo stays once evidence is submitted", "Order is PAID; a QC photo stays once evidence is submitted",
      "Expected { by }", "The stored copy could not be deleted",
    ];
    for (const s of texts) {
      expect(tLib(en, s), s).toBe(s);
      expect(tLib(id, s), s).not.toBe(s);
    }
    expect(tLib(id, texts[1])).toBe("Job cetak PJ-3-mgq1x2 masih memakai file ini: batalkan atau hentikan cetakannya dulu");
    expect(tLib(id, texts[2])).toBe("Pesanan berstatus BUKTI DIKIRIM; foto QC tetap disimpan setelah bukti dikirim");
  });
});

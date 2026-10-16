import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./store";
import { createOrder } from "./actions";
import { setFileStore, type FileStore } from "./files";
import { compareTables, hasSqliteHeader, importBlockers, importDatabase, inspectDatabase, type DbInfo } from "./deploy-import";
import { GET as importStatus, POST as importDb } from "@/app/api/admin/import-db/route";
import { POST as importFile } from "@/app/api/admin/import-file/route";
import { GET as adminStatus } from "@/app/api/admin/status/route";

// Real SQLite files in a temp folder: slow on Windows (antivirus scans every new file), so allow more than 5 s.
vi.setConfig({ testTimeout: 30_000 });

const g = globalThis as unknown as { __kesuniSqlite?: { close(): void } };
/** Close the store's cached connection so the next store call opens KESUNI_DB_PATH again. */
const closeDb = () => { g.__kesuniSqlite?.close(); g.__kesuniSqlite = undefined; };
let dir = "";
let n = 0;
/** A new database file with the app's real tables and the seeded demo order (made by the store itself). */
function freshDb(): string {
  closeDb();
  process.env.KESUNI_DB_PATH = path.join(dir, `db-${++n}.db`);
  store.listOrders();
  return process.env.KESUNI_DB_PATH;
}
const realOrder = (product: string) =>
  createOrder({ product, quantity: 1, deadline: "2026-11-20", designVersion: "v1", mandateMicro: 40_000_000, label: "real" });
/** Like scripts/railway-import-db.mjs: a consistent copy of a live database. */
function snapshot(file: string): string {
  const out = path.join(dir, `snap-${++n}.db`);
  const db = new DatabaseSync(file, { readOnly: true });
  db.prepare("VACUUM INTO ?").run(out);
  db.close();
  return out;
}
/** The studio PC's database: two real orders on top of the demo order. */
function studioSnapshot(): string {
  const file = freshDb();
  expect(realOrder("Lamp shade for Aini").ok).toBe(true);
  expect(realOrder("Key tags for the kos").ok).toBe(true);
  store.setMeta("ownerNote", { text: "from the studio PC" });
  return snapshot(file);
}
const info = (over: Partial<DbInfo>): DbInfo => ({ tables: {}, counts: {}, realOrders: 0, simulatedOrders: 1, ...over });

beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "kesuni-deploy-")); });
afterAll(() => {
  closeDb();
  process.env.KESUNI_DB_PATH = ":memory:";
  rmSync(dir, { recursive: true, force: true });
});

describe("checking an uploaded file", () => {
  it("refuses a file that is not SQLite", () => {
    const f = path.join(dir, "notes.txt");
    writeFileSync(f, "orders,vendors\n1,2\n");
    expect(hasSqliteHeader(f)).toBe(false);
    expect(inspectDatabase(f)).toEqual({ ok: false, problems: ["Not a SQLite database file"] });
  });

  it("refuses a SQLite file that is not an Open3DKesuni database", () => {
    const f = path.join(dir, "other.db");
    const db = new DatabaseSync(f);
    db.exec("CREATE TABLE photos (id TEXT)");
    db.close();
    const r = inspectDatabase(f);
    expect(!r.ok && r.problems[0]).toMatch(/Not an Open3DKesuni database/);
  });

  it("refuses views and triggers (the app's schema has none)", () => {
    const f = snapshot(freshDb());
    const db = new DatabaseSync(f);
    db.exec("CREATE TRIGGER t AFTER INSERT ON orders BEGIN DELETE FROM vendors; END");
    db.close();
    const r = inspectDatabase(f);
    expect(!r.ok && r.problems[0]).toMatch(/Unexpected trigger t/);
  });

  it("refuses a cut-off file", () => {
    const whole = readFileSync(studioSnapshot());
    const f = path.join(dir, "half.db");
    writeFileSync(f, whole.subarray(0, Math.floor(whole.length / 2)));
    expect(inspectDatabase(f).ok).toBe(false);
  });

  it("reads tables, row counts and real vs simulated orders", () => {
    const r = inspectDatabase(studioSnapshot());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info).toMatchObject({ realOrders: 2, simulatedOrders: 1 });
    expect(r.info.tables.orders).toEqual(["id", "data"]);
    expect(r.info.counts.orders).toBe(3);
  });
});

describe("compareTables and importBlockers", () => {
  it("needs every uploaded table on the server with the same columns", () => {
    const server = { orders: ["id", "data"], meta: ["key", "data"] };
    expect(compareTables(server, { orders: ["data", "id"], meta: ["key", "data"] })).toEqual({ problems: [], notes: [] });
    expect(compareTables(server, { orders: ["id", "data"] }).notes).toEqual(["Table meta is not in the upload; the server keeps its own rows"]);
    expect(compareTables(server, { ...server, wishlist: ["id"] }).problems[0]).toMatch(/wishlist is unknown/);
    expect(compareTables(server, { orders: ["id", "data", "extra"], meta: ["key", "data"] }).problems[0]).toMatch(/Table orders has columns/);
  });

  it("only a fresh server (demo order only, no money, no files) takes an import", () => {
    expect(importBlockers(info({}))).toEqual([]);
    expect(importBlockers(info({ realOrders: 1 }))[0]).toMatch(/1 real order/);
    expect(importBlockers(info({ counts: { escrows: 1 } }))[0]).toMatch(/escrows/);
    expect(importBlockers(info({ counts: { intents: 2, attachments: 1 } }))).toHaveLength(2);
  });
});

describe("importDatabase", () => {
  it("fills a fresh server in one go, and the server's open connection sees the rows at once", () => {
    const upload = studioSnapshot();
    const server = freshDb(); // the store keeps this connection open, like the running server
    expect(store.listOrders().map((o) => o.label)).toEqual(["simulated"]);

    const r = importDatabase(server, upload);
    expect(r).toMatchObject({ ok: true, realOrders: 2, simulatedOrders: 1 });
    expect(store.listOrders().map((o) => o.product)).toContain("Lamp shade for Aini");
    expect(store.getMeta("ownerNote")).toEqual({ text: "from the studio PC" });
    expect(realOrder("New order after the move").ok).toBe(true); // ids keep counting from the imported rows
  });

  it("never overwrites a server that already has a real order", () => {
    const upload = studioSnapshot();
    const server = freshDb();
    expect(realOrder("Order taken on the server").ok).toBe(true);

    const r = importDatabase(server, upload);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(store.listOrders().map((o) => o.product)).toContain("Order taken on the server");
    expect(store.listOrders().map((o) => o.product)).not.toContain("Lamp shade for Aini");
  });

  it("leaves the server untouched when the upload is broken", () => {
    const server = freshDb();
    const bad = path.join(dir, "bad.db");
    writeFileSync(bad, "SQLite format 3\u0000 but then nothing useful");
    expect(importDatabase(server, bad)).toMatchObject({ ok: false, status: 400 });
    expect(store.listOrders()).toHaveLength(1);
  });
});

describe("admin routes", () => {
  const PASSWORD = "correct horse";
  const auth = (pw = PASSWORD) => ({ authorization: `Basic ${Buffer.from(`operator:${pw}`).toString("base64")}` });
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  const upload = (bytes: Buffer, over: Record<string, string> = {}) => ({
    ...auth(), "x-kesuni-gzip": "1", "x-kesuni-bytes": String(bytes.length), "x-kesuni-sha256": sha(bytes), ...over,
  });
  const post = (url: string, bytes: Buffer, headers: Record<string, string>) =>
    new Request(url, { method: "POST", headers, body: new Uint8Array(gzipSync(bytes)) });
  const mem = new Map<string, Uint8Array>();
  const fake: FileStore = {
    async put(k, b) { mem.set(k, b); },
    async get(k) { const b = mem.get(k); if (!b) throw new Error("ENOENT"); return b; },
    async remove(k) { mem.delete(k); },
  };

  beforeEach(() => { process.env.OPERATOR_PASSWORD = PASSWORD; mem.clear(); setFileStore(fake); });
  afterEach(() => { delete process.env.OPERATOR_PASSWORD; setFileStore(undefined); });

  it("stay closed without OPERATOR_PASSWORD on the server, and ask for it otherwise", async () => {
    freshDb();
    delete process.env.OPERATOR_PASSWORD;
    expect((await importStatus(new Request("http://x/api/admin/import-db", { headers: auth() }))).status).toBe(403);
    process.env.OPERATOR_PASSWORD = PASSWORD;
    const wrong = await importStatus(new Request("http://x/api/admin/import-db", { headers: auth("guess") }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect((await adminStatus(new Request("http://x/api/admin/status"))).status).toBe(401);
  });

  it("imports once, then refuses; a damaged or cut-off upload is refused before anything changes", async () => {
    const bytes = readFileSync(studioSnapshot());
    freshDb();
    const before = await (await importStatus(new Request("http://x/api/admin/import-db", { headers: auth() }))).json();
    expect(before).toMatchObject({ importAllowed: true, server: { realOrders: 0, simulatedOrders: 1 } });

    const cut = await importDb(post("http://x/api/admin/import-db", bytes.subarray(0, 4096), upload(bytes)));
    expect(cut.status).toBe(400);
    const forged = await importDb(post("http://x/api/admin/import-db", bytes, upload(bytes, { "x-kesuni-sha256": "0".repeat(64) })));
    expect(forged.status).toBe(400);
    expect(store.listOrders()).toHaveLength(1);

    const ok = await importDb(post("http://x/api/admin/import-db", bytes, upload(bytes)));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, realOrders: 2 });
    expect(store.listOrders().filter((o) => o.label === "real")).toHaveLength(2);

    const again = await importDb(post("http://x/api/admin/import-db", bytes, upload(bytes)));
    expect(again.status).toBe(409);
    const after = await (await importStatus(new Request("http://x/api/admin/import-db", { headers: auth() }))).json();
    expect(after.importAllowed).toBe(false);
  });

  it("copies an attachment's bytes only for a known attachment, at its exact size, never over another file", async () => {
    freshDb();
    const bytes = Buffer.from("solid part\nendsolid part\n");
    store.saveAttachment({
      id: "F-0a1b2c3d", orderId: "ORD-001", kind: "design", filename: "part.stl", size: bytes.length, mime: "model/stl",
      uploadedBy: "Khelda", at: new Date().toISOString(), storageKey: "F-0a1b2c3d.stl",
    });
    const url = (key: string) => `http://x/api/admin/import-file?key=${encodeURIComponent(key)}`;

    expect((await importFile(post(url("F-99999999.stl"), bytes, upload(bytes)))).status).toBe(404);
    expect((await importFile(post(url("../../etc/passwd"), bytes, upload(bytes)))).status).toBe(404);
    const short = Buffer.from("solid");
    expect((await importFile(post(url("F-0a1b2c3d.stl"), short, upload(short)))).status).toBe(400);

    expect((await importFile(post(url("F-0a1b2c3d.stl"), bytes, upload(bytes)))).status).toBe(201);
    expect(Buffer.from(mem.get("F-0a1b2c3d.stl")!).toString()).toBe(bytes.toString());
    const same = await importFile(post(url("F-0a1b2c3d.stl"), bytes, upload(bytes)));
    expect(await same.json()).toMatchObject({ ok: true, alreadyThere: true });
    const other = Buffer.from("solid evil\nendsolid evil\n");
    expect((await importFile(post(url("F-0a1b2c3d.stl"), other, upload(other)))).status).toBe(409);
    expect(Buffer.from(mem.get("F-0a1b2c3d.stl")!).toString()).toBe(bytes.toString());
  });

  it("the deploy check names variables but never shows a value", async () => {
    freshDb();
    process.env.PRINTER_BRIDGE_TOKEN = "bridge-token-value";
    try {
      const res = await adminStatus(new Request("http://x/api/admin/status", { headers: auth() }));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain("bridge-token-value");
      const body = JSON.parse(text);
      expect(body.env.set).toContain("PRINTER_BRIDGE_TOKEN");
      expect(body.data).toMatchObject({ realOrders: 0, simulatedOrders: 1, importAllowed: true });
      expect(body.storage.dbPath).toBe(process.env.KESUNI_DB_PATH);
    } finally {
      delete process.env.PRINTER_BRIDGE_TOKEN;
    }
  });
});

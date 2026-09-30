// SQLite storage (Node's built-in node:sqlite). One file on disk, git-ignored.
// Rows are stored as JSON documents; the id/order_id columns are for lookup only.
// Path: KESUNI_DB_PATH, default data/local/kesuni.db. Tests use ":memory:".
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Acceptance, AgentLogEntry, Decision, Evidence, Order, PaymentIntent, Quote, Vendor,
} from "./types";
import { usdcToMicro } from "./policy";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders      (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendors     (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quotes      (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions   (seq INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence    (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS acceptances (order_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS intents     (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
                                        data TEXT NOT NULL, UNIQUE (order_id, idempotency_key));
CREATE TABLE IF NOT EXISTS agent_log   (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, data TEXT NOT NULL);
`;
const ORDER_TABLES = ["quotes", "decisions", "evidence", "acceptances", "intents", "agent_log"] as const;

function open(): DatabaseSync {
  const file = process.env.KESUNI_DB_PATH ?? path.join(process.cwd(), "data", "local", "kesuni.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  conn.exec(SCHEMA);
  const empty = (conn.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n === 0;
  if (empty) seedSimulated(conn);
  return conn;
}

// Reuse one connection across Next.js hot reloads.
const g = globalThis as unknown as { __kesuniSqlite?: DatabaseSync };
const conn = (): DatabaseSync => (g.__kesuniSqlite ??= open());

const parse = <T>(rows: unknown[]): T[] => rows.map((r) => JSON.parse((r as { data: string }).data) as T);
const one = <T>(row: unknown): T | undefined => (row ? (JSON.parse((row as { data: string }).data) as T) : undefined);
const count = (table: string): number =>
  (conn().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

// ---------- orders ----------
export const listOrders = (): Order[] => parse(conn().prepare("SELECT data FROM orders ORDER BY rowid").all());
export const getOrder = (id: string): Order | undefined => one(conn().prepare("SELECT data FROM orders WHERE id = ?").get(id));
export function saveOrder(o: Order): void {
  conn().prepare("INSERT INTO orders (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(o.id, JSON.stringify(o));
}
export function nextOrderIds(): { id: string; jobId: string } {
  const n = count("orders") + 1;
  const pad = String(n).padStart(3, "0");
  return getOrder(`ORD-${pad}`) ? { id: `ORD-${Date.now()}`, jobId: `JOB-${Date.now()}` } : { id: `ORD-${pad}`, jobId: `JOB-${pad}` };
}

// ---------- vendors ----------
export const listVendors = (): Vendor[] => parse(conn().prepare("SELECT data FROM vendors ORDER BY rowid").all());
export const getVendor = (id: string): Vendor | undefined => one(conn().prepare("SELECT data FROM vendors WHERE id = ?").get(id));
function saveVendor(c: DatabaseSync, v: Vendor): void {
  c.prepare("INSERT INTO vendors (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(v.id, JSON.stringify(v));
}

// ---------- quotes ----------
export const listQuotes = (orderId: string): Quote[] =>
  parse(conn().prepare("SELECT data FROM quotes WHERE order_id = ? ORDER BY rowid").all(orderId));
export const getQuote = (id: string): Quote | undefined => one(conn().prepare("SELECT data FROM quotes WHERE id = ?").get(id));
export function saveQuote(q: Quote): void {
  conn().prepare("INSERT INTO quotes (id, order_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(q.id, q.orderId, JSON.stringify(q));
}
export const deleteQuote = (id: string): void => void conn().prepare("DELETE FROM quotes WHERE id = ?").run(id);
export const nextQuoteId = (): string => `Q-${count("quotes") + 1}-${Date.now().toString(36)}`;

// ---------- decisions ----------
export const listDecisions = (orderId: string): Decision[] =>
  parse(conn().prepare("SELECT data FROM decisions WHERE order_id = ? ORDER BY seq").all(orderId));
export const addDecision = (d: Decision): void =>
  void conn().prepare("INSERT INTO decisions (order_id, data) VALUES (?, ?)").run(d.orderId, JSON.stringify(d));

// ---------- evidence ----------
export const listEvidence = (orderId: string): Evidence[] =>
  parse(conn().prepare("SELECT data FROM evidence WHERE order_id = ? ORDER BY rowid").all(orderId));
export const nextEvidenceId = (): string => `E-${count("evidence") + 1}-${Date.now().toString(36)}`;
export const addEvidence = (e: Evidence): void =>
  void conn().prepare("INSERT INTO evidence (id, order_id, data) VALUES (?, ?, ?)").run(e.id, e.orderId, JSON.stringify(e));

// ---------- acceptance ----------
export const getAcceptance = (orderId: string): Acceptance | undefined =>
  one(conn().prepare("SELECT data FROM acceptances WHERE order_id = ?").get(orderId));
export function saveAcceptance(a: Acceptance): void {
  conn().prepare("INSERT INTO acceptances (order_id, data) VALUES (?, ?) ON CONFLICT(order_id) DO UPDATE SET data = excluded.data")
    .run(a.orderId, JSON.stringify(a));
}

// ---------- payment intents ----------
export const listIntents = (orderId?: string): PaymentIntent[] =>
  orderId === undefined
    ? parse(conn().prepare("SELECT data FROM intents ORDER BY rowid").all())
    : parse(conn().prepare("SELECT data FROM intents WHERE order_id = ? ORDER BY rowid").all(orderId));
export const nextIntentId = (): string => `PI-${count("intents") + 1}-${Date.now().toString(36)}`;
/** Insert only. The UNIQUE(order_id, idempotency_key) constraint is a second guard against double payment. */
export function insertIntent(p: PaymentIntent): void {
  conn().prepare("INSERT INTO intents (id, order_id, idempotency_key, data) VALUES (?, ?, ?, ?)")
    .run(p.id, p.orderId, p.idempotencyKey, JSON.stringify(p));
}

// ---------- agent log ----------
export const listLog = (orderId: string): AgentLogEntry[] =>
  parse(conn().prepare("SELECT data FROM agent_log WHERE order_id = ? ORDER BY id").all(orderId));
export function addLog(entry: Omit<AgentLogEntry, "id">): AgentLogEntry {
  const c = conn();
  const { lastInsertRowid } = c.prepare("INSERT INTO agent_log (order_id, data) VALUES (?, '{}')").run(entry.orderId);
  const full: AgentLogEntry = { id: Number(lastInsertRowid), ...entry };
  c.prepare("UPDATE agent_log SET data = ? WHERE id = ?").run(JSON.stringify(full), lastInsertRowid);
  return full;
}

// ---------- seed + reset ----------
function seedSimulated(c: DatabaseSync): void {
  saveVendor(c, { id: "own", name: "Own studio", address: "0x0000000000000000000000000000000000000001", approved: true });
  saveVendor(c, { id: "partner-a", name: "Partner printer A (simulated)", address: "0x0000000000000000000000000000000000000002", approved: true });
  const order: Order = {
    id: "ORD-001", jobId: "JOB-001", product: "Custom lamp side table (3D-printed components)",
    quantity: 1, deadline: "2026-10-08", designVersion: "v1",
    mandateMicro: usdcToMicro("32"), status: "CREATED", label: "simulated",
  };
  c.prepare("INSERT INTO orders (id, data) VALUES (?, ?)").run(order.id, JSON.stringify(order));
  // Demo refusal: partner quote 35 exceeds mandate 32.
  const quotes: Quote[] = [
    { id: "Q-own", orderId: "ORD-001", vendorId: "own", priceMicro: usdcToMicro("30"), etaHours: 48, source: "own" },
    { id: "Q-partner", orderId: "ORD-001", vendorId: "partner-a", priceMicro: usdcToMicro("35"), etaHours: 24, source: "partner" },
  ];
  for (const q of quotes) c.prepare("INSERT INTO quotes (id, order_id, data) VALUES (?, ?, ?)").run(q.id, q.orderId, JSON.stringify(q));
}

/** Delete simulated orders and everything attached to them, then re-seed. Real orders are never touched. */
export function resetSimulated(): void {
  const c = conn();
  const simIds = listOrders().filter((o) => o.label === "simulated").map((o) => o.id);
  c.exec("BEGIN");
  try {
    for (const id of simIds) {
      for (const t of ORDER_TABLES) c.prepare(`DELETE FROM ${t} WHERE order_id = ?`).run(id);
      c.prepare("DELETE FROM orders WHERE id = ?").run(id);
    }
    if (!getOrder("ORD-001")) seedSimulated(c);
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

/** Tests only: wipe everything, including real orders. */
export function resetDb(): void {
  const c = conn();
  for (const t of [...ORDER_TABLES, "orders", "vendors"]) c.exec(`DELETE FROM ${t}`);
  seedSimulated(c);
}

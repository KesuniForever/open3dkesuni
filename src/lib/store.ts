// SQLite storage (Node's built-in node:sqlite). One file on disk, git-ignored.
// Rows are stored as JSON documents; the id/order_id columns are for lookup only.
// Path: KESUNI_DB_PATH, default data/local/kesuni.db. Tests use ":memory:".
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Acceptance, AgentLogEntry, Attachment, CustomerMessage, DailyReview, Decision, Escrow, Evidence, OperatorTask, Order, PaymentIntent, Printer,
  PrinterCommand, PrintJob, Quote, Vendor,
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
CREATE TABLE IF NOT EXISTS escrows     (order_id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS printers    (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks       (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta        (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages    (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_reviews (day TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS print_jobs  (id TEXT PRIMARY KEY, order_id TEXT, printer_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS printer_commands (id TEXT PRIMARY KEY, printer_id TEXT NOT NULL, data TEXT NOT NULL);
`;
const ORDER_TABLES = ["quotes", "decisions", "evidence", "acceptances", "intents", "agent_log", "escrows", "tasks", "attachments", "messages", "print_jobs"] as const;

function open(): DatabaseSync {
  const file = process.env.KESUNI_DB_PATH || path.join(process.cwd(), "data", "local", "kesuni.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  conn.exec(SCHEMA);
  const empty = (conn.prepare("SELECT COUNT(*) AS n FROM orders").get() as { n: number }).n === 0;
  if (empty) seedSimulated(conn);
  return conn;
}

/** The "own" vendor is Kesuni itself: its payout address comes from KESUNI_PAYOUT_ADDRESS when set. */
function syncOwnVendorAddress(c: DatabaseSync): void {
  const address = process.env.KESUNI_PAYOUT_ADDRESS;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return;
  const own = one<Vendor>(c.prepare("SELECT data FROM vendors WHERE id = 'own'").get());
  if (own && own.address !== address) saveVendor(c, { ...own, name: "Kesuni studio", address });
}

// Reuse one connection across Next.js hot reloads. Re-sync the payout address whenever the
// env value changes (a long-running dev server keeps its connection across .env edits).
const g = globalThis as unknown as { __kesuniSqlite?: DatabaseSync; __kesuniPayout?: string; __kesuniSchema?: string };
function conn(): DatabaseSync {
  const c = (g.__kesuniSqlite ??= open());
  if (g.__kesuniSchema !== SCHEMA) {
    c.exec(SCHEMA); // new tables after a hot reload (CREATE IF NOT EXISTS)
    g.__kesuniSchema = SCHEMA;
  }
  if (g.__kesuniPayout !== process.env.KESUNI_PAYOUT_ADDRESS) {
    g.__kesuniPayout = process.env.KESUNI_PAYOUT_ADDRESS;
    syncOwnVendorAddress(c);
  }
  return c;
}

const parse = <T>(rows: unknown[]): T[] => rows.map((r) => JSON.parse((r as { data: string }).data) as T);
const one = <T>(row: unknown): T | undefined => (row ? (JSON.parse((row as { data: string }).data) as T) : undefined);
const count = (table: string): number =>
  (conn().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

// ---------- orders ----------
export const listOrders = (): Order[] => parse(conn().prepare("SELECT data FROM orders ORDER BY rowid").all());
export const getOrder = (id: string): Order | undefined => one(conn().prepare("SELECT data FROM orders WHERE id = ?").get(id));
export const getOrderByToken = (token: string): Order | undefined =>
  one(conn().prepare("SELECT data FROM orders WHERE json_extract(data, '$.customerToken') = ?").get(token));
export function saveOrder(o: Order): void {
  conn().prepare("INSERT INTO orders (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(o.id, JSON.stringify(o));
}
/**
 * A number no order has ever used. A deleted order can leave rows behind (a Chief run that finished after the reset),
 * and its Circle wallets keep its id, so a reused number would hand that history to a new, maybe real, order.
 * Highest of: the order count, any ORD-<n> in orders or the order tables, and the last number handed out.
 */
export function nextOrderIds(): { id: string; jobId: string } {
  const c = conn();
  const refs = ["SELECT id AS ref FROM orders", ...ORDER_TABLES.map((t) => `SELECT order_id AS ref FROM ${t}`)].join(" UNION ");
  // ORD- plus 3 to 6 digits: the old ORD-<timestamp> fallback ids do not count as numbers.
  const used = (c.prepare(`SELECT MAX(CAST(substr(ref, 5) AS INTEGER)) AS n FROM (${refs})
    WHERE ref GLOB 'ORD-[0-9][0-9][0-9]*' AND length(ref) <= 10 AND NOT substr(ref, 5) GLOB '*[^0-9]*'`).get() as { n: number | null }).n ?? 0;
  const n = Math.max(count("orders"), used, getMeta<number>("lastOrderNo") ?? 0) + 1;
  setMeta("lastOrderNo", n);
  const pad = String(n).padStart(3, "0");
  return { id: `ORD-${pad}`, jobId: `JOB-${pad}` };
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
export const listAllDecisions = (): Decision[] => parse(conn().prepare("SELECT data FROM decisions ORDER BY seq").all());
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

export function updateIntent(p: PaymentIntent): void {
  conn().prepare("UPDATE intents SET data = ? WHERE id = ?").run(JSON.stringify(p), p.id);
}

// ---------- escrow ----------
export const getEscrow = (orderId: string): Escrow | undefined =>
  one(conn().prepare("SELECT data FROM escrows WHERE order_id = ?").get(orderId));
export const listEscrows = (): Escrow[] => parse(conn().prepare("SELECT data FROM escrows ORDER BY rowid").all());
export function saveEscrow(e: Escrow): void {
  conn().prepare("INSERT INTO escrows (order_id, data) VALUES (?, ?) ON CONFLICT(order_id) DO UPDATE SET data = excluded.data")
    .run(e.orderId, JSON.stringify(e));
}

// ---------- printers ----------
export const listPrinters = (): Printer[] => parse(conn().prepare("SELECT data FROM printers ORDER BY rowid").all());
export const getPrinter = (id: string): Printer | undefined => one(conn().prepare("SELECT data FROM printers WHERE id = ?").get(id));
export function savePrinter(p: Printer): void {
  conn().prepare("INSERT INTO printers (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(p.id, JSON.stringify(p));
}

// ---------- operator tasks ----------
export const listTasks = (orderId: string): OperatorTask[] =>
  parse(conn().prepare("SELECT data FROM tasks WHERE order_id = ? ORDER BY rowid").all(orderId));
export const listAllTasks = (): OperatorTask[] => parse(conn().prepare("SELECT data FROM tasks ORDER BY rowid").all());
export const listOpenTasks = (): OperatorTask[] =>
  parse<OperatorTask>(conn().prepare("SELECT data FROM tasks ORDER BY rowid").all()).filter((t) => t.status === "open");
export const getTask = (id: string): OperatorTask | undefined => one(conn().prepare("SELECT data FROM tasks WHERE id = ?").get(id));
export const nextTaskId = (): string => `T-${count("tasks") + 1}-${Date.now().toString(36)}`;
export function saveTask(t: OperatorTask): void {
  conn().prepare("INSERT INTO tasks (id, order_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(t.id, t.orderId, JSON.stringify(t));
}

// ---------- attachments ----------
export const listAttachments = (orderId: string): Attachment[] =>
  parse(conn().prepare("SELECT data FROM attachments WHERE order_id = ? ORDER BY rowid").all(orderId));
export const getAttachment = (id: string): Attachment | undefined =>
  one(conn().prepare("SELECT data FROM attachments WHERE id = ?").get(id));
export function saveAttachment(a: Attachment): void {
  conn().prepare("INSERT INTO attachments (id, order_id, data) VALUES (?, ?, ?)").run(a.id, a.orderId, JSON.stringify(a));
}
/** Replace an attachment's metadata (e.g. parsed3mf read again). The bytes in the file store are not touched. */
export function updateAttachment(a: Attachment): void {
  conn().prepare("UPDATE attachments SET data = ? WHERE id = ?").run(JSON.stringify(a), a.id);
}

// ---------- print jobs and printer commands (a person asks on the website; the LAN bridge carries them out) ----------
// Write through src/lib/printer/jobs.ts: it checks who asks, the printer's state and the expiry of stale commands.
export const listPrintJobs = (filter: { orderId?: string; printerId?: string } = {}): PrintJob[] =>
  filter.orderId !== undefined
    ? parse(conn().prepare("SELECT data FROM print_jobs WHERE order_id = ? ORDER BY rowid").all(filter.orderId))
    : filter.printerId !== undefined
      ? parse(conn().prepare("SELECT data FROM print_jobs WHERE printer_id = ? ORDER BY rowid").all(filter.printerId))
      : parse(conn().prepare("SELECT data FROM print_jobs ORDER BY rowid").all());
export const getPrintJob = (id: string): PrintJob | undefined => one(conn().prepare("SELECT data FROM print_jobs WHERE id = ?").get(id));
export const nextPrintJobId = (): string => `PJ-${count("print_jobs") + 1}-${Date.now().toString(36)}`;
export function savePrintJob(j: PrintJob): void {
  conn().prepare(`INSERT INTO print_jobs (id, order_id, printer_id, data) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(j.id, j.orderId ?? null, j.printerId, JSON.stringify(j));
}

export const listPrinterCommands = (printerId?: string): PrinterCommand[] =>
  printerId === undefined
    ? parse(conn().prepare("SELECT data FROM printer_commands ORDER BY rowid").all())
    : parse(conn().prepare("SELECT data FROM printer_commands WHERE printer_id = ? ORDER BY rowid").all(printerId));
export const getPrinterCommand = (id: string): PrinterCommand | undefined =>
  one(conn().prepare("SELECT data FROM printer_commands WHERE id = ?").get(id));
export const nextPrinterCommandId = (): string => `PC-${count("printer_commands") + 1}-${Date.now().toString(36)}`;
export function savePrinterCommand(c: PrinterCommand): void {
  conn().prepare("INSERT INTO printer_commands (id, printer_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(c.id, c.printerId, JSON.stringify(c));
}

// ---------- customer messages (shown on the customer's page; write through src/lib/messages.ts) ----------
export const listMessages = (orderId: string): CustomerMessage[] =>
  parse(conn().prepare("SELECT data FROM messages WHERE order_id = ? ORDER BY rowid").all(orderId));
export const listAllMessages = (): CustomerMessage[] => parse(conn().prepare("SELECT data FROM messages ORDER BY rowid").all());
export const nextMessageId = (): string => `M-${count("messages") + 1}-${Date.now().toString(36)}`;
export const addMessage = (m: CustomerMessage): void =>
  void conn().prepare("INSERT INTO messages (id, order_id, data) VALUES (?, ?, ?)").run(m.id, m.orderId, JSON.stringify(m));

// ---------- meta (settings saved by the operator; JSON values) ----------
export const getMeta = <T>(key: string): T | undefined => one(conn().prepare("SELECT data FROM meta WHERE key = ?").get(key));
export function setMeta(key: string, value: unknown): void {
  conn().prepare("INSERT INTO meta (key, data) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data")
    .run(key, JSON.stringify(value));
}

// ---------- agent log ----------
export const listLog = (orderId: string): AgentLogEntry[] =>
  parse(conn().prepare("SELECT data FROM agent_log WHERE order_id = ? ORDER BY id").all(orderId));
/** Log entries of every order with fromIso <= at < toIso (ISO strings compare in time order). */
export const listLogBetween = (fromIso: string, toIso: string): AgentLogEntry[] =>
  parse(conn().prepare("SELECT data FROM agent_log WHERE json_extract(data, '$.at') >= ? AND json_extract(data, '$.at') < ? ORDER BY id")
    .all(fromIso, toIso));
export function addLog(entry: Omit<AgentLogEntry, "id">): AgentLogEntry {
  const c = conn();
  const { lastInsertRowid } = c.prepare("INSERT INTO agent_log (order_id, data) VALUES (?, '{}')").run(entry.orderId);
  const full: AgentLogEntry = { id: Number(lastInsertRowid), ...entry };
  c.prepare("UPDATE agent_log SET data = ? WHERE id = ?").run(JSON.stringify(full), lastInsertRowid);
  return full;
}

// ---------- daily reviews (the Chief's daily report to the owner; one per Jakarta day) ----------
export const getDailyReview = (day: string): DailyReview | undefined =>
  one(conn().prepare("SELECT data FROM daily_reviews WHERE day = ?").get(day));
export const listDailyReviews = (): DailyReview[] => parse(conn().prepare("SELECT data FROM daily_reviews ORDER BY day DESC").all());
/** Regenerating a day replaces its review. */
export function saveDailyReview(r: DailyReview): void {
  conn().prepare("INSERT INTO daily_reviews (day, data) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data")
    .run(r.day, JSON.stringify(r));
}

// ---------- seed + reset ----------
function seedSimulated(c: DatabaseSync): void {
  saveVendor(c, { id: "own", name: "Own studio", address: "0x0000000000000000000000000000000000000001", approved: true });
  saveVendor(c, { id: "partner-a", name: "Partner printer A (simulated)", address: "0x0000000000000000000000000000000000000002", approved: true });
  const order: Order = {
    id: "ORD-001", jobId: "JOB-001", product: "Custom lamp side table (3D-printed components)",
    quantity: 1, deadline: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), designVersion: "v1",
    mandateMicro: usdcToMicro("32"), status: "CREATED", label: "simulated", createdAt: new Date().toISOString(),
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
    // The heartbeat's memory (src/lib/agent/heartbeat.ts) of problems it handled for these orders: the re-seeded
    // demo order is a new order, so the Chief must be woken for it again. Keys look like "kind:<id>[:...]".
    const seen = getMeta<Record<string, unknown>>("heartbeatSeen");
    if (seen) setMeta("heartbeatSeen", Object.fromEntries(Object.entries(seen).filter(([k]) => !k.split(":").slice(1).some((p) => simIds.includes(p)))));
    c.exec("COMMIT");
  } catch (e) {
    c.exec("ROLLBACK");
    throw e;
  }
}

/** Tests only: wipe everything, including real orders. */
export function resetDb(): void {
  const c = conn();
  for (const t of [...ORDER_TABLES, "orders", "vendors", "printers", "meta", "daily_reviews", "printer_commands"]) c.exec(`DELETE FROM ${t}`);
  seedSimulated(c);
  syncOwnVendorAddress(c);
}

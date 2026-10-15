// One-time move of the studio PC's database onto a fresh server (docs/DEPLOY-RAILWAY.md). The upload is checked
// (a real SQLite file, intact, the same tables) and copied in ONE transaction through a second connection, so the
// server's open connection (src/lib/store.ts) keeps working and simply sees the new rows. It never replaces a
// database that is already in use: any non-simulated order, escrow, payment intent or attachment refuses the import.
// scripts/railway-import-db.mjs also loads this file with Node's type stripping: plain TypeScript, node: imports only.
import { closeSync, openSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** Table name -> column names. */
export type Tables = Record<string, string[]>;
export interface DbInfo {
  tables: Tables;
  counts: Record<string, number>;
  realOrders: number;
  simulatedOrders: number;
}
export type Inspection = { ok: true; info: DbInfo } | { ok: false; problems: string[] };
export type ImportResult =
  | { ok: true; copied: Record<string, number>; realOrders: number; simulatedOrders: number; notes: string[] }
  | { ok: false; status: number; error: string; problems: string[] };

const MAGIC = "SQLite format 3\u0000";
/** Without these it is not an Open3DKesuni database. */
const CORE_TABLES = ["orders", "vendors", "meta"];
/** Rows that mean the server is already in use (money or files), even when every order is simulated. */
const IN_USE_TABLES = ["escrows", "intents", "attachments"];
const SAFE_NAME = /^[a-z_][a-z0-9_]*$/i;
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The first 16 bytes of every SQLite 3 database file. */
export function hasSqliteHeader(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    return readSync(fd, head, 0, 16, 0) === 16 && head.toString("latin1") === MAGIC;
  } finally {
    closeSync(fd);
  }
}

/** Tables, columns and row counts of one schema ("main" or an attached one). Names are checked before use in SQL. */
export function readInfo(db: DatabaseSync, schema = "main"): DbInfo {
  const names = (db.prepare(`SELECT name FROM ${q(schema)}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[]).map((r) => r.name);
  const bad = names.filter((n) => !SAFE_NAME.test(n));
  if (bad.length) throw new Error(`Unexpected table name(s): ${bad.join(", ")}`);
  const tables: Tables = {};
  const counts: Record<string, number> = {};
  for (const name of names) {
    tables[name] = (db.prepare("SELECT name FROM pragma_table_info(?, ?) ORDER BY cid").all(name, schema) as { name: string }[])
      .map((r) => r.name);
    counts[name] = (db.prepare(`SELECT COUNT(*) AS n FROM ${q(schema)}.${q(name)}`).get() as { n: number }).n;
  }
  let realOrders = 0;
  let simulatedOrders = 0;
  if (tables.orders) {
    const rows = db.prepare(`SELECT json_extract(data, '$.label') = 'simulated' AS sim, COUNT(*) AS n FROM ${q(schema)}.orders GROUP BY 1`)
      .all() as { sim: number | null; n: number }[];
    for (const r of rows) if (r.sim === 1) simulatedOrders += r.n; else realOrders += r.n;
  }
  return { tables, counts, realOrders, simulatedOrders };
}

/** Is this file an intact Open3DKesuni database? Opened read-only. */
export function inspectDatabase(file: string): Inspection {
  try {
    if (!hasSqliteHeader(file)) return { ok: false, problems: ["Not a SQLite database file"] };
  } catch (e) {
    return { ok: false, problems: [`Cannot read the file: ${(e as Error).message}`] };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = (db.prepare("PRAGMA integrity_check").all() as Record<string, string>[]).map((r) => Object.values(r)[0]);
    if (integrity.length !== 1 || integrity[0] !== "ok") return { ok: false, problems: [`Database is damaged: ${integrity.slice(0, 3).join("; ")}`] };
    const extras = (db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('view', 'trigger')").all() as { type: string; name: string }[]);
    if (extras.length) return { ok: false, problems: [`Unexpected ${extras.map((e) => `${e.type} ${e.name}`).join(", ")}`] };
    const info = readInfo(db);
    const missing = CORE_TABLES.filter((t) => !info.tables[t]);
    if (missing.length) return { ok: false, problems: [`Not an Open3DKesuni database (missing ${missing.join(", ")})`] };
    return { ok: true, info };
  } catch (e) {
    return { ok: false, problems: [`Cannot open the database: ${(e as Error).message}`] };
  } finally {
    db?.close();
  }
}

/** Upload vs server: every uploaded table must exist on the server with the same columns (or rows would be lost). */
export function compareTables(server: Tables, upload: Tables): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const [name, cols] of Object.entries(upload)) {
    const have = server[name];
    if (!have) { problems.push(`Table ${name} is unknown to this server version: deploy the newer code first`); continue; }
    const a = [...cols].sort().join(","), b = [...have].sort().join(",");
    if (a !== b) problems.push(`Table ${name} has columns (${cols.join(", ")}) but the server expects (${have.join(", ")})`);
  }
  for (const name of Object.keys(server)) if (!upload[name]) notes.push(`Table ${name} is not in the upload; the server keeps its own rows`);
  return { problems, notes };
}

/** Why the server is not fresh. Empty = an import may replace its data (only the seeded demo order is there). */
export function importBlockers(server: DbInfo): string[] {
  const out: string[] = [];
  if (server.realOrders > 0) out.push(`The server already has ${server.realOrders} real order(s). Import only fills a fresh server.`);
  for (const t of IN_USE_TABLES) {
    const n = server.counts[t] ?? 0;
    if (n > 0) out.push(`The server already has ${n} row(s) in ${t}. Import only fills a fresh server.`);
  }
  return out;
}

/** Read-only look at the server's database (for GET /api/admin/import-db and the status page). */
export function serverInfo(targetFile: string): DbInfo {
  const db = new DatabaseSync(targetFile, { readOnly: true });
  try {
    return readInfo(db);
  } finally {
    db.close();
  }
}

/**
 * Copy every table of `uploadFile` into `targetFile`, replacing the server's rows, in one transaction.
 * The target must already have the app's schema (call any store function first) and must be fresh.
 */
export function importDatabase(targetFile: string, uploadFile: string): ImportResult {
  const up = inspectDatabase(uploadFile);
  if (!up.ok) return { ok: false, status: 400, error: "The uploaded file is not a usable Open3DKesuni database", problems: up.problems };

  const db = new DatabaseSync(targetFile);
  try {
    db.exec("PRAGMA busy_timeout = 10000");
    const before = readInfo(db);
    const blockers = importBlockers(before);
    if (blockers.length) return { ok: false, status: 409, error: "The server's database is already in use", problems: blockers };
    const { problems, notes } = compareTables(before.tables, up.info.tables);
    if (problems.length) return { ok: false, status: 400, error: "The upload does not match this server's tables", problems };

    db.prepare("ATTACH DATABASE ? AS up").run(uploadFile);
    try {
      db.exec("BEGIN IMMEDIATE");
      try {
        // Checked again under the write lock: an order may have arrived since the first look.
        const again = importBlockers(readInfo(db));
        if (again.length) {
          db.exec("ROLLBACK");
          return { ok: false, status: 409, error: "The server's database is already in use", problems: again };
        }
        for (const name of Object.keys(up.info.tables)) {
          const cols = before.tables[name].map(q).join(", ");
          db.exec(`DELETE FROM main.${q(name)}`);
          db.exec(`INSERT INTO main.${q(name)} (${cols}) SELECT ${cols} FROM up.${q(name)}`);
        }
        db.exec("COMMIT");
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw e;
      }
    } finally {
      db.exec("DETACH DATABASE up");
    }
    const after = readInfo(db);
    return { ok: true, copied: after.counts, realOrders: after.realOrders, simulatedOrders: after.simulatedOrders, notes };
  } finally {
    db.close();
  }
}

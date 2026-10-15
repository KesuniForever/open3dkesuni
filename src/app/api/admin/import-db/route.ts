// One-time import of the studio PC's database into a fresh server (docs/DEPLOY-RAILWAY.md).
// GET: may this server take an import?  POST: the database file (from scripts/railway-import-db.mjs).
// Needs OPERATOR_PASSWORD on the server and Basic auth with it. Refuses once the server holds a real order,
// an escrow, a payment intent or an attachment, so it can never overwrite a database in use.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import * as store from "@/lib/store";
import { storagePlan } from "@/lib/deploy";
import { importBlockers, importDatabase, serverInfo } from "@/lib/deploy-import";
import { readUpload, refuse } from "../shared";

const MAX_DB_BYTES = 256 * 1024 * 1024;

function target(): string | null {
  store.listOrders(); // opens the database (creates it with the app's tables on a new volume)
  const { dbPath } = storagePlan(process.env, process.cwd());
  return dbPath === ":memory:" ? null : dbPath;
}

export async function GET(req: Request) {
  const no = refuse(req);
  if (no) return no;
  const file = target();
  if (!file) return NextResponse.json({ error: "The database is in memory; nothing to import into" }, { status: 409 });
  const info = serverInfo(file);
  const blockers = importBlockers(info);
  return NextResponse.json({
    importAllowed: blockers.length === 0, blockers,
    server: { realOrders: info.realOrders, simulatedOrders: info.simulatedOrders, rows: info.counts },
  });
}

export async function POST(req: Request) {
  const no = refuse(req);
  if (no) return no;
  const file = target();
  if (!file) return NextResponse.json({ error: "The database is in memory; nothing to import into" }, { status: 409 });
  const up = await readUpload(req, MAX_DB_BYTES);
  if (!up.ok) return NextResponse.json({ error: up.error }, { status: up.status });

  // Staged next to the database (on the volume), checked, copied in one transaction, then deleted.
  const staged = path.join(path.dirname(file), `.import-${randomUUID()}.db`);
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(staged, up.bytes);
    const r = importDatabase(file, staged);
    if (!r.ok) return NextResponse.json({ error: r.error, reasons: r.problems }, { status: r.status });
    return NextResponse.json({ ok: true, realOrders: r.realOrders, simulatedOrders: r.simulatedOrders, rows: r.copied, notes: r.notes });
  } finally {
    await Promise.all([staged, `${staged}-journal`, `${staged}-wal`, `${staged}-shm`].map((f) => rm(f, { force: true })));
  }
}

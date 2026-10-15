// One-time: copy this computer's Open3DKesuni data (database + uploaded files) to a FRESH server on Railway.
//
//   node scripts/railway-import-db.mjs https://YOUR-APP.up.railway.app            check, ask, then upload
//   node scripts/railway-import-db.mjs https://YOUR-APP.up.railway.app --check    check only, upload nothing
//   options: --db <file> (default data/local/kesuni.db)  --files <dir> (default data/local/files)  --yes (no question)
//
// 1. Takes a consistent snapshot of the database with VACUUM INTO (the local file is only read, never changed).
// 2. Checks the snapshot (src/lib/deploy-import.ts) and asks the server whether it is still fresh.
// 3. Uploads the snapshot (gzip, with size + SHA-256) to POST /api/admin/import-db, then each attachment file to
//    POST /api/admin/import-file. The server refuses if it already holds a real order, so this cannot overwrite data.
// The operator password is asked for (hidden), or taken from OPERATOR_PASSWORD. It is never printed or saved.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { BODY_LIMIT_MB } from "../src/lib/deploy.ts";
import { inspectDatabase } from "../src/lib/deploy-import.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Next.js cuts request bodies over BODY_LIMIT_MB (proxyClientMaxBodySize in next.config.ts); stay a little under it.
const LIMIT_MB = BODY_LIMIT_MB - 2;
const LIMIT = LIMIT_MB * 1024 * 1024;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? resolve(args[i + 1]) : fallback;
};
const appArg = args.find((a) => /^https?:\/\//.test(a));
const dbFile = option("--db", join(ROOT, "data", "local", "kesuni.db"));
const filesDir = option("--files", process.env.KESUNI_FILES_DIR || join(ROOT, "data", "local", "files"));

const die = (msg) => {
  console.error(`x ${msg}`);
  process.exit(1);
};
if (!appArg) die("Give the app address, e.g. node scripts/railway-import-db.mjs https://YOUR-APP.up.railway.app");
const app = appArg.replace(/\/+$/, "");
if (!app.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(app)) die("Use the https:// address (the password must not travel unencrypted)");
if (!existsSync(dbFile)) die(`Database not found: ${dbFile}`);

// ---------- 1. snapshot ----------
const tmp = mkdtempSync(join(tmpdir(), "kesuni-import-"));
const snapshot = join(tmp, "kesuni-snapshot.db");
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
{
  let src;
  try {
    src = new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    src = new DatabaseSync(dbFile); // a WAL file left without its index needs a normal open; data is still only read
  }
  try {
    src.prepare("VACUUM INTO ?").run(snapshot);
  } finally {
    src.close();
  }
}

// ---------- 2. check ----------
const local = inspectDatabase(snapshot);
if (!local.ok) die(`The local database cannot be used: ${local.problems.join("; ")}`);
const snap = new DatabaseSync(snapshot, { readOnly: true });
const attachments = local.info.tables.attachments
  ? snap.prepare("SELECT data FROM attachments ORDER BY rowid").all().map((r) => JSON.parse(r.data))
  : [];
snap.close();
const bytes = readFileSync(snapshot);
const packed = gzipSync(bytes, { level: 9 });
console.log(`Local database: ${local.info.realOrders} real order(s), ${local.info.simulatedOrders} simulated, ` +
  `${local.info.counts.escrows ?? 0} escrow(s), ${attachments.length} attachment(s); ${(bytes.length / 1024).toFixed(0)} KB ` +
  `(${(packed.length / 1024).toFixed(0)} KB packed)`);
if (packed.length > LIMIT) die(`The database is too big for one upload (over ${LIMIT_MB} MB packed). Raise BODY_LIMIT_MB in src/lib/deploy.ts and proxyClientMaxBodySize in next.config.ts first.`);

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}
function askHidden(question) {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);
  return new Promise((done, fail) => {
    process.stdout.write(question);
    let value = "";
    const stop = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") { stop(); return done(value); }
        if (c === "\u0003") { stop(); return fail(new Error("Cancelled")); }
        if (c === "\u007f" || c === "\b") value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

const password = process.env.OPERATOR_PASSWORD || (await askHidden("Operator password (the one set on Railway): "));
if (!password) die("No password given");
const auth = `Basic ${Buffer.from(`operator:${password}`).toString("base64")}`;

async function call(path, init = {}) {
  let res;
  try {
    res = await fetch(`${app}${path}`, { ...init, headers: { authorization: auth, ...init.headers } });
  } catch (e) {
    die(`Cannot reach ${app}: ${e.cause?.code || e.message}`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
  return { status: res.status, body };
}
const explain = (r) => [r.body.error, ...(r.body.reasons ?? [])].filter(Boolean).join("; ") || `HTTP ${r.status}`;

const status = await call("/api/admin/import-db");
if (status.status === 401) die("Wrong operator password (or OPERATOR_PASSWORD is not set on Railway yet)");
if (status.status === 403) die(explain(status));
if (status.status !== 200) die(`Server check failed: ${explain(status)}`);
if (!status.body.importAllowed) die(`The server is not fresh, nothing was sent:\n  - ${status.body.blockers.join("\n  - ")}`);
console.log(`Server: fresh (${status.body.server.simulatedOrders} demo order(s), no real orders). Import is allowed.`);

if (flag("--check")) {
  console.log("ok Check passed. Run the same command without --check to upload.");
  process.exit(0);
}
if (!flag("--yes")) {
  const answer = await ask(`Upload ${local.info.realOrders} real order(s) to ${app}? This replaces the server's demo data. (y/n) `);
  if (!/^y(es)?$/i.test(answer)) die("Stopped, nothing was sent");
}

// ---------- 3. upload ----------
const sha = (b) => createHash("sha256").update(b).digest("hex");
const sent = await call("/api/admin/import-db", {
  method: "POST",
  headers: { "content-type": "application/octet-stream", "x-kesuni-gzip": "1", "x-kesuni-bytes": String(bytes.length), "x-kesuni-sha256": sha(bytes) },
  body: packed,
});
if (sent.status !== 200) die(`Import refused: ${explain(sent)}`);
console.log(`ok Database imported: ${sent.body.realOrders} real order(s), ${sent.body.simulatedOrders} simulated.`);
for (const n of sent.body.notes ?? []) console.log(`  note: ${n}`);

let copied = 0;
const skipped = [];
for (const a of attachments) {
  const file = join(filesDir, a.storageKey);
  if (!existsSync(file)) { skipped.push(`${a.storageKey} (${a.filename}): not on this computer`); continue; }
  const raw = readFileSync(file);
  const body = gzipSync(raw);
  if (body.length > LIMIT) { skipped.push(`${a.storageKey} (${a.filename}): over ${LIMIT_MB} MB packed, too big to send`); continue; }
  const r = await call(`/api/admin/import-file?key=${encodeURIComponent(a.storageKey)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-kesuni-gzip": "1", "x-kesuni-bytes": String(raw.length), "x-kesuni-sha256": sha(raw) },
    body,
  });
  if (r.status === 200 || r.status === 201) copied++;
  else skipped.push(`${a.storageKey} (${a.filename}): ${explain(r)}`);
}
console.log(`ok Files: ${copied} of ${attachments.length} copied (${statSync(filesDir, { throwIfNoEntry: false }) ? filesDir : "no local files folder"}).`);
for (const s of skipped) console.log(`  ! ${s}`);
console.log("Done. Open the app on Railway and check the orders.");

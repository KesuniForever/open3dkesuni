// Bambu Lab A1 -> Open3DKesuni bridge. Runs on a computer on the SAME network as the printers.
//   node scripts/printer-bridge.mjs          (or double-click scripts/start-bridge.cmd: restarts by itself)
// Read-only: subscribes to each printer's status reports and asks for a full status ("pushall").
// It never sends print, move, heat or stop commands.
//
// Settings: .env.bridge (optional, wins) then .env.local, both next to package.json:
//   Printer #1 (id "a1"):   PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE
//   Printer #2 (id "a1-2"): PRINTER_2_IP, PRINTER_2_SERIAL, PRINTER_2_ACCESS_CODE   (and _3, _4 ...)
//   PRINTER_BRIDGE_TOKEN  the same value on every app that receives the reports
//   APP_URL               one or more app addresses, comma separated, e.g.
//                         APP_URL=http://localhost:3000,https://open3dkesuni.up.railway.app
// Log: logs/printer-bridge.log (rolled over at about 5 MB).
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mqtt from "mqtt";
import { detectEvents, mergeReport } from "../src/lib/printer/bambu.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
for (const file of [".env.bridge", ".env.local"]) {
  try {
    for (const line of readFileSync(join(ROOT, file), "utf8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && m[2] && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* the file is optional */ }
}

// Everything printed also goes to a log file, so a bridge started at logon can be checked later.
const LOG_DIR = join(ROOT, "logs");
const LOG = join(LOG_DIR, "printer-bridge.log");
function toFile(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    try { if (statSync(LOG).size > 5_000_000) renameSync(LOG, `${LOG}.1`); } catch { /* no log yet */ }
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never stop the bridge */ }
}
for (const level of ["log", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => { original(...args); toFile(args.join(" ")); };
}

if (!env.PRINTER_BRIDGE_TOKEN) {
  console.error("x Missing PRINTER_BRIDGE_TOKEN in .env.local");
  process.exit(1);
}
const APPS = (env.APP_URL || "http://localhost:3000").split(",").map((u) => u.trim().replace(/\/$/, "")).filter(Boolean);

const printers = [];
for (let n = 1; n <= 9; n++) {
  const pre = n === 1 ? "PRINTER_" : `PRINTER_${n}_`;
  const ip = env[`${pre}IP`], serial = env[`${pre}SERIAL`], code = env[`${pre}ACCESS_CODE`];
  if (!ip && !serial && !code) continue;
  if (!ip || !serial || !code) {
    console.error(`! printer #${n}: needs ${pre}IP, ${pre}SERIAL and ${pre}ACCESS_CODE; skipping`);
    continue;
  }
  printers.push({ id: n === 1 ? "a1" : `a1-${n}`, label: `#${n}`, codeVar: `${pre}ACCESS_CODE`, ip, serial, code });
}
if (!printers.length) {
  console.error("x No printer configured in .env.local (PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE)");
  process.exit(1);
}

async function sendTo(app, p, snapshot, events) {
  try {
    const res = await fetch(`${app}/api/printers/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.PRINTER_BRIDGE_TOKEN}` },
      body: JSON.stringify({ printerId: p.id, snapshot, events }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) console.error(`! ${p.label} ${app} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    else if (events.length) console.log(`> ${p.label} sent ${events.map((e) => e.kind).join(", ")} to ${app}`);
  } catch (e) {
    console.error(`! ${p.label} could not reach ${app}: ${e.message}`);
  }
}
// Every app gets every report; one app being down never blocks the others.
const send = (p, snapshot, events) => Promise.all(APPS.map((app) => sendTo(app, p, snapshot, events)));
const pushall = (client, p) =>
  client.publish(`device/${p.serial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));

function watch(p) {
  // Bambu printers use a self-signed certificate on the LAN, so it cannot be verified.
  const client = mqtt.connect(`mqtts://${p.ip}:8883`, {
    username: "bblp", password: p.code, rejectUnauthorized: false, reconnectPeriod: 5000, connectTimeout: 10_000,
  });
  let snap;
  let lastSentAt = 0;
  let lastKey = "";
  client.on("connect", () => {
    console.log(`ok ${p.label} connected at ${p.ip}`);
    client.subscribe(`device/${p.serial}/report`, (err) => {
      if (err) return console.error(`x ${p.label} subscribe failed (check the serial): ${err.message}`);
      pushall(client, p);
    });
  });
  client.on("error", (e) => {
    console.error(`! ${p.label} mqtt: ${e.message}`);
    if (/not authori[sz]ed/i.test(e.message)) {
      console.error(`  ${p.label}: access code refused. Read it on the printer (Settings > LAN Only) and update ${p.codeVar}.`);
    }
  });
  client.on("offline", () => console.error(`! ${p.label} offline, retrying...`));
  client.on("message", (_t, buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const next = mergeReport(snap, msg, new Date().toISOString());
    if (!next) return;
    const events = detectEvents(snap, next);
    snap = next;
    // Send on events, on a state/percent change, or as a heartbeat every 30 s.
    const key = `${next.state}:${Math.floor(next.percent)}`;
    if (events.length || key !== lastKey || Date.now() - lastSentAt > 30_000) {
      lastKey = key;
      lastSentAt = Date.now();
      console.log(`  ${p.label} ${next.state} ${Math.round(next.percent)}%${next.jobName ? ` ${next.jobName}` : ""}`);
      void send(p, next, events);
    }
  });
  // A quiet but connected printer still counts as online: repeat the last reading every 30 s and ask for a
  // full status every 5 min. A disconnected printer sends nothing, so the app marks it offline after 2 min.
  setInterval(() => {
    if (client.connected && snap && Date.now() - lastSentAt > 30_000) {
      lastSentAt = Date.now();
      void send(p, snap, []);
    }
  }, 10_000);
  setInterval(() => { if (client.connected) pushall(client, p); }, 300_000);
  return client;
}

const clients = printers.map(watch);
console.log(`watching ${printers.length} printer(s): ${printers.map((p) => `${p.label} ${p.ip}`).join(", ")}; reporting to ${APPS.join(", ")}`);
const stop = () => { for (const c of clients) c.end(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

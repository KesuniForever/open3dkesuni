// Bambu Lab A1 -> Kesuni 3D bridge. Runs on a computer on the SAME network as the printers.
//   node scripts/printer-bridge.mjs
// Read-only: subscribes to each printer's status reports and asks once for a full status
// ("pushall"). It never sends print, move, heat or stop commands.
//
// .env.local:
//   Printer #1 (id "a1"):   PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE
//   Printer #2 (id "a1-2"): PRINTER_2_IP, PRINTER_2_SERIAL, PRINTER_2_ACCESS_CODE   (and _3, _4 ...)
//   PRINTER_BRIDGE_TOKEN, APP_URL
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { detectEvents, mergeReport } from "../src/lib/printer/bambu.ts";

const env = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && m[2] && !env[m[1]]) env[m[1]] = m[2];
  }
} catch { /* env vars only */ }

if (!env.PRINTER_BRIDGE_TOKEN) {
  console.error("x Missing PRINTER_BRIDGE_TOKEN in .env.local");
  process.exit(1);
}
const APP = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

const printers = [];
for (let n = 1; n <= 9; n++) {
  const pre = n === 1 ? "PRINTER_" : `PRINTER_${n}_`;
  const ip = env[`${pre}IP`], serial = env[`${pre}SERIAL`], code = env[`${pre}ACCESS_CODE`];
  if (!ip && !serial && !code) continue;
  if (!ip || !serial || !code) {
    console.error(`! printer #${n}: needs ${pre}IP, ${pre}SERIAL and ${pre}ACCESS_CODE; skipping`);
    continue;
  }
  printers.push({ id: n === 1 ? "a1" : `a1-${n}`, label: `#${n}`, ip, serial, code });
}
if (!printers.length) {
  console.error("x No printer configured in .env.local (PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE)");
  process.exit(1);
}

async function send(p, snapshot, events) {
  try {
    const res = await fetch(`${APP}/api/printers/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.PRINTER_BRIDGE_TOKEN}` },
      body: JSON.stringify({ printerId: p.id, snapshot, events }),
    });
    if (!res.ok) console.error(`! ${p.label} app answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    else if (events.length) console.log(`> ${p.label} sent ${events.map((e) => e.kind).join(", ")}`);
  } catch (e) {
    console.error(`! ${p.label} could not reach ${APP}: ${e.message}`);
  }
}

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
      client.publish(`device/${p.serial}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));
    });
  });
  client.on("error", (e) => console.error(`! ${p.label} mqtt: ${e.message}`));
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
  return client;
}

const clients = printers.map(watch);
console.log(`watching ${printers.length} printer(s): ${printers.map((p) => `${p.label} ${p.ip}`).join(", ")}`);
process.on("SIGINT", () => { for (const c of clients) c.end(); process.exit(0); });

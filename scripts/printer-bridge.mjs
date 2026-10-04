// Bambu Lab A1 -> Kesuni 3D bridge. Runs on a computer on the SAME network as the printer.
//   node scripts/printer-bridge.mjs
// Read-only: it subscribes to the printer's status reports and asks for one full status
// ("pushall"). It never sends print, move, heat or stop commands.
// Reads PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE, PRINTER_BRIDGE_TOKEN, APP_URL from .env.local.
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { detectEvents, mergeReport } from "../src/lib/printer/bambu.ts";

const env = { ...process.env };
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && m[2] && !env[m[1]]) env[m[1]] = m[2];
  }
} catch { /* env vars only */ }

const need = ["PRINTER_IP", "PRINTER_SERIAL", "PRINTER_ACCESS_CODE", "PRINTER_BRIDGE_TOKEN"];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.error(`x Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
const APP = (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const PRINTER_ID = "a1";
const topic = `device/${env.PRINTER_SERIAL}/report`;

// Bambu printers use a self-signed certificate on the LAN, so it cannot be verified.
const client = mqtt.connect(`mqtts://${env.PRINTER_IP}:8883`, {
  username: "bblp",
  password: env.PRINTER_ACCESS_CODE,
  rejectUnauthorized: false,
  reconnectPeriod: 5000,
  connectTimeout: 10_000,
});

let snap;
let lastSentAt = 0;
let lastKey = "";

async function send(snapshot, events) {
  try {
    const res = await fetch(`${APP}/api/printers/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.PRINTER_BRIDGE_TOKEN}` },
      body: JSON.stringify({ printerId: PRINTER_ID, snapshot, events }),
    });
    if (!res.ok) console.error(`! app answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    else if (events.length) console.log(`> sent ${events.map((e) => e.kind).join(", ")}`);
  } catch (e) {
    console.error(`! could not reach ${APP}: ${e.message}`);
  }
}

client.on("connect", () => {
  console.log(`ok connected to printer at ${env.PRINTER_IP}`);
  client.subscribe(topic, (err) => {
    if (err) return console.error(`x subscribe failed: ${err.message}`);
    // Ask once for the full status; later reports are partial updates.
    client.publish(`device/${env.PRINTER_SERIAL}/request`, JSON.stringify({ pushing: { sequence_id: "0", command: "pushall" } }));
  });
});
client.on("error", (e) => console.error(`! mqtt: ${e.message}`));
client.on("offline", () => console.error("! printer offline, retrying..."));

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
    console.log(`  ${next.state} ${Math.round(next.percent)}%${next.jobName ? ` ${next.jobName}` : ""}`);
    void send(next, events);
  }
});

process.on("SIGINT", () => { client.end(); process.exit(0); });

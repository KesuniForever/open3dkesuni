// Bambu Lab A1 -> Open3DKesuni bridge. Runs on a computer on the SAME network as the printers.
//   node scripts/printer-bridge.mjs              (or double-click scripts/start-bridge.cmd: restarts by itself)
//   node scripts/printer-bridge.mjs --dry-run    does everything except publish to the printers and upload to their
//                                                SD cards, and prints what it would send (never the access code)
//   node scripts/printer-bridge.mjs --read-only  status only, takes no commands (same as BRIDGE_CONTROL=off)
//   node scripts/printer-bridge.mjs --slice-only [--once]
//                                                slicing only: contacts no printer (no MQTT, no FTPS, no print queue,
//                                                no commands); with --once it takes at most one slice, then exits
// Status: subscribes to each printer's reports, asks for a full status ("pushall") and the firmware versions
// ("get_version", once per connection), and sends the snapshot to every app.
// Commands: carries out what a PERSON asked for on the website (scripts/bridge/runner.mjs): pause, resume, stop,
// print speed, light, starting a print (upload to the SD card, then project_file) and camera frames, each checked
// again against the live printer first. Never G-code, moves, homing, temperatures or SD-card browsing.
// Slicing: turns an order's STL/OBJ into an A1 .gcode.3mf with this PC's Bambu Studio command line, one at a time, and
// uploads it to the app (scripts/bridge/slice-runner.mjs, slicer.mjs). Never sends anything to a printer.
//
// Settings: .env.bridge (optional, wins) then .env.local, both next to package.json:
//   Printer #1 (id "a1"):   PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE
//   Printer #2 (id "a1-2"): PRINTER_2_IP, PRINTER_2_SERIAL, PRINTER_2_ACCESS_CODE   (and _3, _4 ...)
//   PRINTER_BRIDGE_TOKEN  the same value on every app that receives the reports
//   APP_URL               one or more app addresses, comma separated, e.g.
//                         APP_URL=http://localhost:3000,https://open3dkesuni.up.railway.app
//                         (plain http only for this computer or the studio network: the token must not travel in clear)
//   CONTROL_APP_URL       optional: the app whose controls and print jobs are carried out. Default: the first APP_URL
//                         on this computer or the studio network (the studio app). A public app (Railway) controls the
//                         printers ONLY when it is named here.
//   BRIDGE_CONTROL=off    optional: status only, take no commands
//   BAMBU_STUDIO_PATH     optional: Bambu Studio for slicing, default C:\Program Files\Bambu Studio\bambu-studio.exe
//   BAMBU_PROFILES_DIR    optional: its system profiles, default <its folder>\resources\profiles\BBL
//   BRIDGE_SLICER=off     optional: take no slices (also off when Bambu Studio is not found)
//   BRIDGE_AGENT_PRINTS=on optional: also carry out agent prints (the app's dispatcher, after a person's "Bed is empty").
//                         Off by default: such a job is refused before anything is downloaded or sent.
// Log: logs/printer-bridge.log (rolled over at about 5 MB).
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mqtt from "mqtt";
import { detectEvents, mergeReport } from "../src/lib/printer/bambu.ts";
import { buildMqttPayload } from "../src/lib/printer/control.ts";
import { grabFrame } from "./bridge/camera.mjs";
import { uploadToSd } from "./bridge/ftps.mjs";
import { appList, controlApps, parseArgs, quietLog, safeApps, sendKey } from "./bridge/logic.mjs";
import { createRunner } from "./bridge/runner.mjs";
import { createSliceRunner } from "./bridge/slice-runner.mjs";
import { cleanWorkRoot, sliceModel, slicerConfig } from "./bridge/slicer.mjs";

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

const args = parseArgs(process.argv.slice(2));

// Everything printed also goes to a log file, so a bridge started at logon can be checked later. A dry run writes
// its own file, so it never mixes with the real bridge's log.
const LOG_DIR = join(ROOT, "logs");
const LOG = join(LOG_DIR, args.dryRun ? "printer-bridge-dry-run.log" : args.sliceOnly ? "printer-bridge-slice-only.log" : "printer-bridge.log");
function toFile(line) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    try { if (statSync(LOG).size > 5_000_000) renameSync(LOG, `${LOG}.1`); } catch { /* no log yet */ }
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch { /* logging must never stop the bridge */ }
}
for (const level of ["log", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...a) => { original(...a); toFile(a.join(" ")); };
}

if (!env.PRINTER_BRIDGE_TOKEN) {
  console.error("x Missing PRINTER_BRIDGE_TOKEN in .env.local");
  process.exit(1);
}
const apps = safeApps(appList(env.APP_URL || "http://localhost:3000"));
for (const r of apps.refused) console.error(`x APP_URL ${r}: not used`);
const APPS = apps.ok;
// One control app (the studio's own, by default): see controlApps in scripts/bridge/logic.mjs.
const control = controlApps({ apps: APPS, controlUrl: env.CONTROL_APP_URL, readOnly: args.readOnly, bridgeControl: env.BRIDGE_CONTROL });
for (const n of control.notes) (n.loud ? console.error : console.log)(n.text);
const CONTROL = control.control;

// --slice-only: this PC's Bambu Studio for the control app, nothing else. No printer is contacted (no MQTT, no FTPS),
// and no print job or command is taken. --once: at most one slice, then exit.
if (args.sliceOnly) {
  const slicer = slicerConfig(env);
  if (!CONTROL.length) {
    console.error("x --slice-only: no control app to take slices from (APP_URL or CONTROL_APP_URL, and not BRIDGE_CONTROL=off)");
    process.exit(1);
  }
  if (!slicer.on) {
    console.error(`x --slice-only: ${slicer.note}`);
    process.exit(1);
  }
  cleanWorkRoot(slicer.workRoot);
  const only = createSliceRunner({
    apps: CONTROL, token: env.PRINTER_BRIDGE_TOKEN,
    slice: (req) => sliceModel({ ...req, exe: slicer.exe, profilesDir: slicer.profilesDir, workRoot: slicer.workRoot }),
  });
  console.log(`slice only: no printer is contacted; taking slices from ${CONTROL.join(", ")}; ${slicer.note}${args.once ? "; one slice, then exit" : ""}`);
  if (args.once) {
    const id = await only.pollOnce();
    console.log(id ? `slice ${id} done or failed: see its order page` : "no slice taken (none waiting, or the app was not reached: see above)");
    process.exit(0);
  }
  only.start();
  await new Promise(() => {}); // runs until Ctrl+C; nothing below (the printers) runs in this mode
}

const printers = [];
for (let n = 1; n <= 9; n++) {
  const pre = n === 1 ? "PRINTER_" : `PRINTER_${n}_`;
  const ip = env[`${pre}IP`], serial = env[`${pre}SERIAL`], code = env[`${pre}ACCESS_CODE`];
  if (!ip && !serial && !code) continue;
  if (!ip || !serial || !code) {
    console.error(`! printer #${n}: needs ${pre}IP, ${pre}SERIAL and ${pre}ACCESS_CODE; skipping`);
    continue;
  }
  printers.push(link({ id: n === 1 ? "a1" : `a1-${n}`, label: `#${n}`, codeVar: `${pre}ACCESS_CODE`, ip, serial, code }));
}
if (!printers.length) {
  console.error("x No printer configured in .env.local (PRINTER_IP, PRINTER_SERIAL, PRINTER_ACCESS_CODE)");
  process.exit(1);
}

/** What the command runner needs from one printer: its live snapshot, its messages, and a careful publish. */
function link(p) {
  Object.assign(p, { client: null, snap: undefined, gotStatus: false, lastStatusAt: 0, listeners: new Set(), seq: 50_000 });
  p.live = () => ({
    snapshot: p.snap, lastSeen: p.lastStatusAt ? new Date(p.lastStatusAt).toISOString() : undefined, connected: Boolean(p.client?.connected),
  });
  p.onMessage = (fn) => { p.listeners.add(fn); return () => p.listeners.delete(fn); };
  // Our sequence ids start at 50000, clear of Bambu Studio's 20000-29999.
  p.nextSeq = () => String(p.seq++);
  // Only the runner calls this, and never in a dry run. A QoS 1 message the printer has not received can be taken
  // back (cancel), so it is not sent late after a reconnect.
  p.publish = ({ payload, qos }) => {
    if (args.dryRun) throw new Error("dry run: nothing is published");
    const client = p.client;
    if (!client?.connected) throw new Error("the bridge is not connected to the printer");
    const before = client.getLastMessageId();
    let mid;
    const acked = new Promise((resolve, reject) => {
      client.publish(`device/${p.serial}/request`, JSON.stringify(payload), { qos }, (err) => (err ? reject(err) : resolve()));
      const after = client.getLastMessageId();
      if (qos > 0 && after !== before) mid = after;
    });
    return { acked, cancel: () => { if (mid !== undefined) client.removeOutgoingMessage(mid); } };
  };
  return p;
}

const quiet = quietLog((text) => console.error(text));
async function sendTo(app, p, snapshot, events) {
  const key = `report|${app}|${p.id}`;
  try {
    const res = await fetch(`${app}/api/printers/report`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.PRINTER_BRIDGE_TOKEN}` },
      body: JSON.stringify({ printerId: p.id, snapshot, events }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return quiet.problem(key, `! ${p.label} ${app} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    quiet.ok(key, `ok ${p.label} reports reach ${app} again`);
    if (events.length) console.log(`> ${p.label} sent ${events.map((e) => e.kind).join(", ")} to ${app}`);
  } catch (e) {
    quiet.problem(key, `! ${p.label} could not reach ${app}: ${e.message}`);
  }
}
// Every app gets every report; one app being down never blocks the others.
const send = (p, snapshot, events) => Promise.all(APPS.map((app) => sendTo(app, p, snapshot, events)));
/** Read-only requests (full status, firmware versions): allowed in a dry run too. */
const ask = (p, kind) => p.client.publish(`device/${p.serial}/request`, JSON.stringify(buildMqttPayload(kind, {}, "0").payload));

function watch(p) {
  // Bambu printers use a self-signed certificate on the LAN, so it cannot be verified.
  const client = mqtt.connect(`mqtts://${p.ip}:8883`, {
    username: "bblp", password: p.code, rejectUnauthorized: false, reconnectPeriod: 5000, connectTimeout: 10_000,
    queueQoSZero: false, // nothing is kept to be sent after a reconnect
  });
  p.client = client;
  let lastSentAt = 0;
  let lastKey = "";
  client.on("connect", () => {
    console.log(`ok ${p.label} connected at ${p.ip}`);
    client.subscribe(`device/${p.serial}/report`, (err) => {
      if (err) return console.error(`x ${p.label} subscribe failed (check the serial): ${err.message}`);
      ask(p, "pushall");
      ask(p, "get_version");
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
    for (const fn of p.listeners) {
      try { fn(msg); } catch { /* a listener never stops the bridge */ }
    }
    const next = mergeReport(p.snap, msg, new Date().toISOString());
    if (!next) return;
    const events = detectEvents(p.snap, next);
    p.snap = next;
    if (msg.print) {
      p.gotStatus = true;
      p.lastStatusAt = Date.now();
    }
    if (!p.gotStatus) return; // the firmware reply alone is not a status: wait for the first report
    // Send on events, on anything a person would notice changing, or as a heartbeat every 30 s.
    const key = sendKey(next);
    if (events.length || key !== lastKey || Date.now() - lastSentAt > 30_000) {
      lastKey = key;
      lastSentAt = Date.now();
      const stage = next.stage ? ` [${next.stage.key.replace("{n}", String(next.stage.code))}]` : "";
      console.log(`  ${p.label} ${next.state} ${Math.round(next.percent)}%${stage}${next.jobName ? ` ${next.jobName}` : ""}`);
      void send(p, next, events);
    }
  });
  // A quiet but connected printer still counts as online: repeat the last reading every 30 s and ask for a
  // full status every 5 min. A disconnected printer sends nothing, so the app marks it offline after 2 min.
  setInterval(() => {
    if (client.connected && p.gotStatus && Date.now() - lastSentAt > 30_000) {
      lastSentAt = Date.now();
      void send(p, p.snap, []);
    }
  }, 10_000);
  setInterval(() => { if (client.connected) ask(p, "pushall"); }, 300_000);
  return client;
}

const clients = printers.map(watch);
// Second key for agent prints, on this PC only: the app's switch alone never makes this bridge start an agent print.
const agentPrints = (env.BRIDGE_AGENT_PRINTS ?? "").trim().toLowerCase() === "on";
const runner = CONTROL.length
  ? createRunner({
    apps: CONTROL, token: env.PRINTER_BRIDGE_TOKEN, printers: new Map(printers.map((p) => [p.id, p])), dryRun: args.dryRun, grabFrame, uploadToSd,
    agentPrints,
  })
  : null;
const stopRunner = runner?.start();
// Slicing for the control app(s) with this PC's Bambu Studio (scripts/bridge/slicer.mjs). Never touches a printer, so
// a dry run slices too; --read-only and BRIDGE_CONTROL=off take no slices either.
const slicer = slicerConfig(env);
if (slicer.on) cleanWorkRoot(slicer.workRoot);
const sliceRunner = CONTROL.length && slicer.on
  ? createSliceRunner({
    apps: CONTROL, token: env.PRINTER_BRIDGE_TOKEN,
    slice: (req) => sliceModel({ ...req, exe: slicer.exe, profilesDir: slicer.profilesDir, workRoot: slicer.workRoot }),
  })
  : null;
const stopSlicer = sliceRunner?.start();
console.log(`watching ${printers.length} printer(s): ${printers.map((p) => `${p.label} ${p.ip}`).join(", ")}; reporting to ${APPS.join(", ")}; `
  + (CONTROL.length ? `taking commands from ${CONTROL.join(", ")}` : "taking no commands (read-only)")
  + (CONTROL.length ? `; ${slicer.note}` : "")
  + (CONTROL.length ? (agentPrints ? "; agent prints ON (BRIDGE_AGENT_PRINTS=on)" : "; agent prints off") : "")
  + (args.dryRun ? "; DRY RUN: nothing is published to the printers or uploaded to their SD cards" : ""));
const stop = () => { stopRunner?.(); stopSlicer?.(); for (const c of clients) c.end(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

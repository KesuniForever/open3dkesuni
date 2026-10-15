// What people asked for on the website, carried out on the printers. Every 3 s the bridge asks each control app
// (GET /api/printers/queue) for queued controls, print jobs and camera requests, takes each one ONCE (the app lets an
// item be taken a single time), checks it again against its own live view of the printer, does it, and reports back
// (POST /api/printers/queue/<id>). Protocol: the foundation contract §10 and the Bambu spec §4-§6 and §9.
// Safety:
// - Only the kinds control.ts can build are ever published (pause, resume, stop, speed, light, get_version and the
//   print start); buildMqttPayload refuses anything else (G-code, moves, temperatures...).
// - Nothing is retried on the printer: a print that did not start is reported failed and a PERSON starts it again.
// - A message the printer did not receive within 10 s is taken back, so it is never sent late after a reconnect.
// - Stop never waits behind other controls for the same printer.
// - Camera: one frame per request, then one every 10 s for 60 s after the last request; while a print is on the
//   printer, one every 30 s to the control app (the order's evidence). Never a stream nobody watches.
// - Texts sent back to the app never hold a printer's LAN address (hideAddresses).
// - --dry-run does everything except publish to the printer and upload to its SD card, and prints what it would send.
// All I/O comes in through createRunner's options, so scripts/bridge/runner.test.mjs runs it without printers.
import { createHash } from "node:crypto";
import { BUSY_STATES } from "../../src/lib/printer/bambu.ts";
import { buildMqttPayload, COMMAND_KINDS, commandReasons, isPersonName, parseReply } from "../../src/lib/printer/control.ts";
import { MAX_3MF_BYTES, parse3mf } from "../../src/lib/threemf.ts";
import {
  ACK_WAIT_MS, commandOutcome, DRY_RUN_TEXT, downloadProblem, hideAddresses, jobFileUrl, MQTT_KIND, quietLog, replyMatches, startOutcome,
  startReasons,
} from "./logic.mjs";

export const POLL_MS = 3_000;
export const CAMERA_EVERY_MS = 10_000;
export const CAMERA_WATCH_MS = 60_000;
/** While a print is on the printer: a frame this often, to the control app(s), whether or not someone watches. */
export const CAMERA_PRINTING_MS = 30_000;
const SEEN_KEEP_MS = 15 * 60_000;
/** The app's defaults (src/lib/printer/jobs.ts), for a job that leaves some out. */
const DEFAULT_OPTIONS = { bedLevelling: true, flowCali: true, timelapse: false, useAms: true };

export const realClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/**
 * apps: the control apps (CONTROL_APP_URL, else every APP_URL). printers: Map id -> printer link:
 *   { id, label, ip, code, live() -> { snapshot, lastSeen, connected }, onMessage(fn) -> off(), nextSeq() -> "50001",
 *     publish({ payload, qos }) -> { acked: Promise, cancel() } (throws when not connected) }
 * grabFrame(ip, code) -> JPEG Buffer; uploadToSd({ ip, code, name, bytes, onProgress }).
 */
export function createRunner({
  apps, token, printers, dryRun = false, log = console.log, warn = console.error, fetch = globalThis.fetch, clock = realClock,
  grabFrame, uploadToSd, parse = parse3mf,
}) {
  const quiet = quietLog(warn);
  const seen = new Map();          // "<app>|<id>" -> when we first saw it: every item is handled once
  const polling = new Set();
  const pending = new Set();       // running tasks (tests wait for them)
  const perPrinter = new Map();
  const st = (id) => {
    if (!perPrinter.has(id)) perPrinter.set(id, { chain: Promise.resolve(), activeJob: null, grabbing: null, lastGrabAt: 0, watchers: new Map() });
    return perPrinter.get(id);
  };
  const auth = { authorization: `Bearer ${token}` };
  const ids = [...printers.keys()].join(",");

  function track(promise) {
    const p = Promise.resolve(promise).catch((e) => warn(`! bridge task failed: ${e?.stack ?? e}`)).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }

  function api(app, path, { timeoutMs = 15_000, headers = {}, ...init } = {}) {
    return fetch(`${app}${path}`, { ...init, headers: { ...auth, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  }

  /** Tell the app how an item is going. Network errors are retried (this is a report, not a printer action). */
  async function report(app, id, body, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        const res = await api(app, `/api/printers/queue/${encodeURIComponent(id)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        if (res.ok) return { ok: true, status: res.status };
        return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };
      } catch (e) {
        if (i >= tries) return { ok: false, status: 0, error: e.message };
        await clock.sleep(2_000);
      }
    }
  }

  async function finish(app, item, tag, state, raw) {
    // An error from the network stack names the printer's LAN address: the app (and Railway) never gets it.
    const text = hideAddresses(raw, printers.get(item.printerId)?.label ?? "");
    const r = await report(app, item.id, state === "done" ? { state, result: text } : { state, error: text });
    if (state === "done") log(`ok ${tag}: ${text}`);
    else warn(`x ${tag}: ${text}`);
    if (!r.ok) warn(`! ${tag}: could not tell ${app} (${r.status || "network"}: ${r.error})`);
    return { state, text };
  }

  /** Take an item: queued -> sent (command) or uploading (job). False when another bridge or a person got there first. */
  async function take(app, item, tag, state) {
    const r = await report(app, item.id, { state });
    if (r.ok) return true;
    if (r.status !== 409) warn(`! ${tag}: could not take it from ${app} (${r.status || "network"}: ${r.error})`);
    return false;
  }

  /**
   * Publish one message and wait until `decide(reply, elapsedMs)` is no longer "waiting". The message is taken back
   * if the printer has not received it within 10 s (and when we stop waiting), so a reconnect never sends it late.
   */
  async function publishAndWait(p, msg, kind, seq, decide) {
    let reply = null;
    const off = p.onMessage((m) => {
      const r = parseReply(m);
      if (!replyMatches(r, kind, seq)) return;
      // The printer's answer goes in the bridge log once (the first real prints are checked against it).
      if (!reply) log(`  ${p.label} replied to ${kind} ${seq}: ${hideAddresses(JSON.stringify(r), p.label)}`);
      reply = r;
    });
    const started = clock.now();
    let handle;
    try {
      handle = p.publish(msg);
    } catch (e) {
      off();
      return { status: "failed", text: `Could not send it to the printer: ${e.message}` };
    }
    let acked = false;
    let cancelled = false;
    let sendError = null;
    handle.acked.then(() => { acked = true; }, (e) => { if (!cancelled) sendError = e; });
    const takeBack = () => { if (!acked && !cancelled) { cancelled = true; handle.cancel(); } };
    try {
      for (;;) {
        const elapsed = clock.now() - started;
        if (elapsed >= ACK_WAIT_MS) takeBack();
        const out = decide(reply, elapsed);
        if (out.status !== "waiting") {
          return out.status === "failed" && !reply && sendError ? { ...out, text: `Could not send it to the printer: ${sendError.message}` } : out;
        }
        await clock.sleep(500);
      }
    } finally {
      off();
      takeBack();
    }
  }

  // ---------- controls ----------

  async function runCommand(app, item, p) {
    const tag = `${p.label} ${item.id} ${item.kind}`;
    if (!(await take(app, item, tag, "sent"))) return;
    log(`> ${tag} asked by ${item.by} (${app})`);
    try {
      return await carryOut(app, item, p, tag);
    } catch (e) {
      return finish(app, item, tag, "failed", `The bridge hit an error: ${e.message}`);
    }
  }

  async function carryOut(app, item, p, tag) {
    const fail = (text) => finish(app, item, tag, "failed", text);
    if (!COMMAND_KINDS.includes(item.kind) || !MQTT_KIND[item.kind]) return fail("Unknown printer command");
    const params = item.params && typeof item.params === "object" ? item.params : {};
    const live = p.live();
    const reasons = [];
    if (!isPersonName(item.by)) reasons.push("A person's name is required");
    if (!live.connected) reasons.push("The bridge is not connected to the printer");
    reasons.push(...commandReasons({ lastSeen: live.lastSeen, snapshot: live.snapshot }, item.kind, params, clock.now()));
    if (reasons.length) return fail(reasons.join("; "));
    const seq = p.nextSeq();
    let msg;
    try {
      msg = buildMqttPayload(MQTT_KIND[item.kind], params, seq);
    } catch (e) {
      return fail(`Not sent: ${e.message}`);
    }
    if (dryRun) {
      log(`[dry-run] ${tag}: would publish to device/<serial>/request (qos ${msg.qos}): ${JSON.stringify(msg.payload)}`);
      return fail(DRY_RUN_TEXT);
    }
    const out = await publishAndWait(p, msg, item.kind, seq, (reply, elapsedMs) =>
      commandOutcome({ kind: item.kind, params, reply, snapshot: p.live().snapshot, elapsedMs }));
    return finish(app, item, tag, out.status === "done" ? "done" : "failed", out.text);
  }

  // ---------- camera ----------

  /** One grab at a time per printer; whoever asks while it runs gets the same frame. */
  function frameOf(p) {
    const s = st(p.id);
    s.grabbing ??= Promise.resolve()
      .then(() => grabFrame(p.ip, p.code))
      .finally(() => { s.grabbing = null; s.lastGrabAt = clock.now(); });
    return s.grabbing;
  }

  async function postFrame(app, p, jpeg) {
    const res = await api(app, `/api/printers/${encodeURIComponent(p.id)}/camera`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg });
    if (!res.ok) throw new Error(`${app} answered ${res.status}`);
  }

  async function runCamera(app, item, p) {
    const tag = `${p.label} ${item.id} camera`;
    if (!(await take(app, item, tag, "sent"))) return;
    if (p.live().snapshot?.camera?.available === false) return finish(app, item, tag, "failed", "This printer reports no camera");
    st(p.id).watchers.set(app, clock.now() + CAMERA_WATCH_MS);
    try {
      await postFrame(app, p, await frameOf(p));
    } catch (e) {
      return finish(app, item, tag, "failed", `No camera frame: ${e.message}`);
    }
    return finish(app, item, tag, "done", "Camera frame sent");
  }

  /**
   * While someone asked in the last 60 s: a fresh frame every 10 s to each app that asked. While a print is on the
   * printer: one every 30 s to the control app(s), so a running job always has a recent picture.
   */
  function cameraTick() {
    const now = clock.now();
    for (const p of printers.values()) {
      const s = st(p.id);
      for (const [app, until] of s.watchers) if (until <= now) s.watchers.delete(app);
      const snap = p.live().snapshot;
      const printing = Boolean(snap && BUSY_STATES.includes(snap.state) && snap.camera?.available !== false);
      const every = s.watchers.size ? CAMERA_EVERY_MS : CAMERA_PRINTING_MS;
      if ((!s.watchers.size && !printing) || s.grabbing || now - s.lastGrabAt < every) continue;
      const to = [...new Set([...s.watchers.keys(), ...(printing ? apps : [])])];
      track(frameOf(p).then(
        (jpeg) => Promise.all(to.map((app) => postFrame(app, p, jpeg).then(
          () => quiet.ok(`cam|${p.id}|${app}`),
          (e) => quiet.problem(`cam|${p.id}|${app}`, `! ${p.label} camera frame not delivered: ${e.message}`)))),
        (e) => quiet.problem(`cam|${p.id}`, `! ${p.label} camera: ${e.message}`),
      ));
    }
  }

  // ---------- print jobs ----------

  async function runJob(app, item, p) {
    const s = st(p.id);
    const tag = `${p.label} ${item.id} print`;
    if (s.activeJob) {
      // Another app's job is on its way to this printer: refuse at once, so its person knows.
      const r = await report(app, item.id, { state: "failed", error: `Another print (${s.activeJob}) is starting on this printer` });
      if (r.ok) warn(`x ${tag}: another print (${s.activeJob}) is starting on this printer`);
      return;
    }
    s.activeJob = item.id;
    try {
      await startJob(app, item, p, tag);
    } catch (e) {
      // Never leave a job hanging in "uploading": the app shows the person what went wrong.
      await finish(app, item, tag, "failed", `The bridge hit an error: ${e.message}`);
    } finally {
      s.activeJob = null;
    }
  }

  async function startJob(app, queued, p, tag) {
    const item = { ...queued, amsMapping: queued.amsMapping ?? [], options: { ...DEFAULT_OPTIONS, ...queued.options } };
    if (!(await take(app, item, tag, "uploading"))) return;
    log(`> ${tag} ${item.fileName} plate ${item.plate}, asked by ${item.by} (${app})`);
    const fail = (text) => finish(app, item, tag, "failed", text);

    // 1. The file, from the app the job came from.
    const url = jobFileUrl(app, item.fileUrl);
    if (!url) return fail("The job has no download link from this app");
    let bytes;
    let headerMd5;
    try {
      const res = await fetch(url, { headers: auth, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) return fail(`Could not download the file (the app answered ${res.status})`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_3MF_BYTES) return fail("The file is larger than 200 MB");
      bytes = Buffer.from(await res.arrayBuffer());
      headerMd5 = res.headers.get("x-file-md5");
    } catch (e) {
      return fail(`Could not download the file: ${e.message}`);
    }
    if (bytes.length > MAX_3MF_BYTES) return fail("The file is larger than 200 MB");
    const md5 = createHash("md5").update(bytes).digest("hex");
    const problem = downloadProblem({ bytes, md5, headerMd5, item });
    if (problem) return fail(problem);
    const info = parse(bytes);

    // 2. The printer as it is now, and the exact message (built before the upload: a bad job never reaches the card).
    let reasons = startReasons(p.live(), item, info, { now: clock.now() });
    if (reasons.length) return fail(reasons.join("; "));
    const seq = p.nextSeq();
    let msg;
    try {
      msg = buildMqttPayload("start_print", {
        plate: item.plate, fileName: item.fileName, subtaskName: item.subtaskName, amsMapping: item.amsMapping, options: item.options,
        urlForm: item.urlForm === "ftp" ? "ftp" : "sdcard",
      }, seq);
    } catch (e) {
      return fail(`Not sent: ${e.message}`);
    }
    if (dryRun) {
      log(`[dry-run] ${tag}: would upload ${bytes.length} bytes (md5 ${md5}) to the SD card as /${item.fileName} over FTPS`);
      log(`[dry-run] ${tag}: would publish to device/<serial>/request (qos ${msg.qos}): ${JSON.stringify(msg.payload)}`);
      return fail(DRY_RUN_TEXT);
    }

    // 3. Upload to the SD root.
    const t0 = clock.now();
    let shown = 0;
    try {
      await uploadToSd({
        ip: p.ip, code: p.code, name: item.fileName, bytes,
        onProgress: (n) => {
          const pct = Math.floor((n / bytes.length) * 4) * 25;
          if (pct > shown && pct < 100) { shown = pct; log(`  ${tag}: upload ${pct}%`); }
        },
      });
    } catch (e) {
      return fail(`Upload to the printer failed: ${e.message}`);
    }
    log(`  ${tag}: uploaded ${bytes.length} bytes in ${Math.round((clock.now() - t0) / 1000)} s`);

    // 4. The upload took a while: wait for any control being sent to this printer, check again, tell the app, start.
    await st(p.id).chain;
    reasons = startReasons(p.live(), item, info, { now: clock.now() });
    if (reasons.length) return fail(reasons.join("; "));
    const sent = await report(app, item.id, { state: "sent", md5 });
    if (!sent.ok) {
      warn(`! ${tag}: ${app} did not record the start (${sent.status || "network"}: ${sent.error}); nothing sent to the printer`);
      await report(app, item.id, { state: "failed", error: "The app could not record the start; nothing was sent to the printer" });
      return;
    }
    reasons = startReasons(p.live(), item, info, { now: clock.now() });
    if (reasons.length) return fail(reasons.join("; "));
    const baseline = p.live().snapshot;
    log(`> ${tag}: start sent (${msg.payload.print.url}, plate ${item.plate}, AMS ${JSON.stringify(msg.payload.print.ams_mapping ?? "off")})`);
    const out = await publishAndWait(p, msg, "start_print", seq, (reply, elapsedMs) =>
      startOutcome({ baseline, reply, snapshot: p.live().snapshot, elapsedMs }));
    if (out.status === "started") {
      log(`ok ${tag}: the printer is ${p.live().snapshot?.state} after ${Math.round((clock.now() - t0) / 1000)} s`);
      return;
    }
    return fail(out.text);
  }

  // ---------- polling ----------

  function dispatch(app, item, type) {
    const p = printers.get(item?.printerId);
    if (!p || typeof item.id !== "string") return;   // not one of this bridge's printers: leave it
    const key = `${app}|${item.id}`;
    if (seen.has(key)) return;
    seen.set(key, clock.now());
    if (type === "job") return void track(runJob(app, item, p));
    if (item.kind === "camera_snapshot") return void track(runCamera(app, item, p));
    // Stop goes at once, never behind a pause or light that is still waiting for the printer.
    if (item.kind === "stop") return void track(runCommand(app, item, p));
    // Other controls for one printer go one after another.
    const s = st(p.id);
    const run = s.chain.then(() => runCommand(app, item, p));
    s.chain = run.catch(() => {});
    track(run);
  }

  async function pollApp(app) {
    if (polling.has(app)) return;
    polling.add(app);
    try {
      const res = await api(app, `/api/printers/queue?printers=${ids}`, { timeoutMs: 10_000 });
      if (!res.ok) {
        const hint = res.status === 404 ? " (this app does not take printer commands yet)" : res.status === 401 || res.status === 503 ? " (check PRINTER_BRIDGE_TOKEN)" : "";
        quiet.problem(`poll|${app}`, `! printer commands: ${app} answered ${res.status}${hint}`);
        return;
      }
      const q = await res.json();
      quiet.ok(`poll|${app}`, `ok printer commands: ${app} answers again`);
      for (const c of Array.isArray(q.commands) ? q.commands : []) dispatch(app, c, "command");
      for (const j of Array.isArray(q.jobs) ? q.jobs : []) dispatch(app, j, "job");
    } catch (e) {
      quiet.problem(`poll|${app}`, `! printer commands: could not reach ${app} (${e.message})`);
    } finally {
      polling.delete(app);
      const old = clock.now() - SEEN_KEEP_MS;
      for (const [k, at] of seen) if (at < old) seen.delete(k);
    }
  }

  return {
    pollOnce: () => Promise.all(apps.map(pollApp)),
    cameraTick,
    /** Resolves when every task started so far has finished (tests). */
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
    start() {
      const timers = [setInterval(() => { for (const app of apps) void pollApp(app); }, POLL_MS), setInterval(cameraTick, 1_000)];
      for (const app of apps) void pollApp(app);
      return () => timers.forEach(clearInterval);
    },
  };
}

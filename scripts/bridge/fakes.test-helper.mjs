// Tests only: a printer, an app and a clock that the bridge's runner can talk to, with no network and no printer.
import { createHash } from "node:crypto";
import { mergeReport } from "../../src/lib/printer/bambu.ts";
import { fake3mf } from "../../src/lib/threemf.test-helper.ts";

export const T0 = Date.parse("2026-10-15T10:00:00.000Z");

/** Time moves only when the runner sleeps (or a test says so). */
export function fakeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    async sleep(ms) {
      t += ms;
      await new Promise((r) => setImmediate(r));
    },
    advance(ms) { t += ms; },
  };
}

/** An idle A1 as our printers report it: SD card in, 0.4 nozzle, AMS lite with PLA yellow in slot 1 and PETG white in slot 3. */
export function idleSnapshot(extra = {}) {
  return mergeReport(undefined, { print: {
    gcode_state: "IDLE", mc_percent: 0, print_error: 0, sdcard: true, home_flag: 847201688, hms: [], nozzle_diameter: "0.4",
    nozzle_type: "stainless_steel", spd_lvl: 2, spd_mag: 100, lights_report: [{ node: "chamber_light", mode: "off" }],
    ipcam: { ipcam_dev: "1", ipcam_record: "disable", timelapse: "disable" },
    ams: { ams: [{ id: "0", info: "1002", tray: [
      { id: "0", tray_type: "PLA", tray_color: "FEC600FF", tray_sub_brands: "PLA Basic" }, { id: "1" },
      { id: "2", tray_type: "PETG", tray_color: "FFFFFFFF", tray_sub_brands: "" }, { id: "3" },
    ] }], tray_exist_bits: "5", tray_now: "255" },
    ...extra,
  } }, new Date(T0).toISOString());
}

/** The snapshot after one more report (a delta). */
export const withReport = (snap, print) => mergeReport(snap, { print }, new Date(T0).toISOString());

export const benchy = () => fake3mf({ projectColours: ["#FCE300"], plates: [{ index: 1, filaments: [{ id: 1, type: "PLA", color: "#FCE300", usedG: 9.82 }] }] });
export const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");

/**
 * A printer link like the bridge's. `react(msg, printer)` runs after each publish: change printer.snapshot or emit a
 * reply there to play the printer's part.
 */
export function fakePrinter(clock, { id = "a1", label = "#1", snapshot = idleSnapshot(), react } = {}) {
  const listeners = new Set();
  let seq = 50_000;
  const printer = {
    id, label, ip: "192.0.2.10", code: "12345678", snapshot, connected: true, lastSeenAt: null, published: [], cancelled: 0, acked: true,
    live: () => ({ snapshot: printer.snapshot, lastSeen: new Date(printer.lastSeenAt ?? clock.now()).toISOString(), connected: printer.connected }),
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(msg) { for (const fn of [...listeners]) fn(msg); },
    nextSeq: () => String(seq++),
    publish(msg) {
      if (!printer.connected) throw new Error("the bridge is not connected to the printer");
      printer.published.push(msg);
      setImmediate(() => react?.(msg, printer));
      return { acked: printer.acked ? Promise.resolve() : new Promise(() => {}), cancel: () => { printer.cancelled++; } };
    },
  };
  return printer;
}

/** The reply a printer sends to one of our messages. */
export function replyTo(msg, result = "success", reason = "") {
  const [type, body] = Object.entries(msg.payload)[0];
  return { [type]: { command: body.command, sequence_id: body.sequence_id, result, reason } };
}

/**
 * An app with a queue, as /api/printers/queue answers, that lets each item be taken once and only moves forward.
 * calls: every request the bridge made; reports: { id, body } in order; frames: camera POSTs.
 */
export function fakeApp(base = "http://app.test", { token = "tok", commands = [], jobs = [], files = {} } = {}) {
  const state = new Map([...commands, ...jobs].map((i) => [i.id, "queued"]));
  const next = {
    command: { queued: ["sent", "failed"], sent: ["done", "failed"] },
    job: { queued: ["uploading", "failed"], uploading: ["sent", "failed", "cancelled"], sent: ["printing", "failed", "done", "cancelled"], printing: ["done", "failed", "cancelled"] },
  };
  const app = {
    base, calls: [], reports: [], frames: [], state, commands, jobs, down: false,
    async fetch(url, init = {}) {
      app.calls.push({ url, method: init.method ?? "GET", auth: init.headers?.authorization });
      if (app.down) throw new Error("fetch failed");
      if (!url.startsWith(base)) throw new Error(`unexpected host: ${url}`);
      if (init.headers?.authorization !== `Bearer ${token}`) return new Response("no", { status: 401 });
      const path = url.slice(base.length);
      if (path.startsWith("/api/printers/queue?")) {
        return Response.json({
          commands: commands.filter((c) => state.get(c.id) === "queued"), jobs: jobs.filter((j) => state.get(j.id) === "queued"), now: new Date().toISOString(),
        });
      }
      let m = /^\/api\/printers\/queue\/([^/]+)$/.exec(path);
      if (m && init.method === "POST") {
        const id = decodeURIComponent(m[1]);
        const body = JSON.parse(init.body);
        app.reports.push({ id, body });
        const kind = id.startsWith("PJ-") ? "job" : "command";
        if (!(next[kind][state.get(id)] ?? []).includes(body.state)) return Response.json({ error: "conflict" }, { status: 409 });
        state.set(id, body.state);
        return Response.json({ ok: true });
      }
      m = /^\/api\/print-jobs\/([^/]+)\/file$/.exec(path);
      if (m) {
        const f = files[decodeURIComponent(m[1])];
        if (!f) return new Response("missing", { status: 404 });
        return new Response(f.bytes, { headers: { "content-length": String(f.bytes.length), "x-file-md5": f.md5 ?? md5(f.bytes) } });
      }
      m = /^\/api\/printers\/([^/]+)\/camera$/.exec(path);
      if (m && init.method === "POST") {
        app.frames.push({ printerId: m[1], bytes: init.body });
        return Response.json({ at: new Date().toISOString(), size: init.body.length }, { status: 201 });
      }
      return new Response("not found", { status: 404 });
    },
  };
  return app;
}

/** A queued print job as the app lists it. */
export function queuedJob(bytes, extra = {}) {
  return {
    type: "job", id: "PJ-1-test", printerId: "a1", orderId: "ORD-012", plate: 1, fileName: "ORD-012_p1_1792072000.gcode.3mf",
    subtaskName: "ORD-012 Benchy", amsMapping: [0], options: { bedLevelling: true, flowCali: false, timelapse: false, useAms: true },
    by: "Khelda", createdAt: new Date(T0 - 5_000).toISOString(), expiresAt: new Date(T0 + 295_000).toISOString(), size: bytes.length, md5: null,
    fileUrl: "/api/print-jobs/PJ-1-test/file", ...extra,
  };
}

export const queuedCommand = (kind, params = {}, extra = {}) => ({
  type: "command", id: `PC-${kind}`, printerId: "a1", kind, params, by: "Khelda", createdAt: new Date(T0).toISOString(),
  expiresAt: new Date(T0 + 60_000).toISOString(), ...extra,
});

import { describe, expect, it } from "vitest";
import { createRunner } from "./runner.mjs";
import { DRY_RUN_TEXT } from "./logic.mjs";
import { benchy, fakeApp, fakeClock, fakePrinter, idleSnapshot, md5, queuedCommand, queuedJob, replyTo, withReport } from "./fakes.test-helper.mjs";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 0xff, 0xd9]);

/** One app, one printer (#1, "a1"), a clock that moves only when the runner waits. timeline: what happened, in order. */
function setup({ commands = [], jobs = [], files = {}, printer = {}, dryRun = false, upload, grab, apps, parse } = {}) {
  const clock = fakeClock();
  const app = fakeApp("http://app.test", { commands, jobs, files });
  const p = fakePrinter(clock, printer);
  const timeline = [];
  const uploaded = [];
  const logs = [];
  const publish = p.publish.bind(p);
  p.publish = (msg) => { timeline.push(`publish:${Object.values(msg.payload)[0].command}`); return publish(msg); };
  const grabs = [];
  const all = apps ?? [app];
  const runner = createRunner({
    apps: all.map((a) => a.base), token: "tok", printers: new Map([[p.id, p]]), dryRun, clock,
    fetch: (url, init = {}) => {
      if (init.method === "POST" && url.includes("/api/printers/queue/")) timeline.push(`report:${JSON.parse(init.body).state}`);
      const target = all.find((a) => url.startsWith(a.base));
      return target ? target.fetch(url, init) : Promise.reject(new Error(`unexpected host: ${url}`));
    },
    log: (t) => logs.push(t), warn: (t) => logs.push(t), ...(parse ? { parse } : {}),
    grabFrame: async (ip, code) => { grabs.push({ ip, code }); return grab ? grab() : JPEG; },
    uploadToSd: async (o) => {
      timeline.push("upload");
      uploaded.push(o);
      if (upload) await upload(o);
      return { path: `/${o.name}`, size: o.bytes.length };
    },
  });
  const run = async () => { await runner.pollOnce(); await runner.idle(); };
  return { clock, app, printer: p, timeline, uploaded, logs, grabs, runner, run };
}
const states = (app, id) => app.reports.filter((r) => r.id === id).map((r) => r.body.state);
const last = (app, id) => app.reports.filter((r) => r.id === id).at(-1)?.body;

const printing = () => withReport(idleSnapshot(), { gcode_state: "RUNNING", stg: [2, 0], stg_cur: 0, mc_percent: 40 });

describe("controls from a person", () => {
  it("takes the light command once, publishes the spec's message and reports done when the report shows it", async () => {
    const s = setup({
      commands: [queuedCommand("light", { on: true })],
      printer: { react: (msg, p) => { p.emit(replyTo(msg)); p.snapshot = withReport(p.snapshot, { lights_report: [{ node: "chamber_light", mode: "on" }] }); } },
    });
    await s.run();
    expect(s.printer.published).toEqual([{ qos: 1, payload: { system: {
      sequence_id: "50000", command: "ledctrl", led_node: "chamber_light", led_mode: "on", led_on_time: 500, led_off_time: 500, loop_times: 0, interval_time: 0,
    } } }]);
    expect(s.app.reports.map((r) => r.body)).toEqual([{ state: "sent" }, { state: "done", result: "The light is on" }]);
    await s.run();
    expect(s.printer.published).toHaveLength(1);
  });

  it("pause and speed while printing, one after the other", async () => {
    const s = setup({
      commands: [queuedCommand("pause"), queuedCommand("speed", { level: 3 }, { id: "PC-speed" })],
      printer: {
        snapshot: printing(),
        react: (msg, p) => {
          p.emit(replyTo(msg));
          if (msg.payload.print.command === "pause") p.snapshot = withReport(p.snapshot, { gcode_state: "PAUSE", stg_cur: 16 });
        },
      },
    });
    await s.run();
    expect(s.printer.published.map((m) => [m.payload.print.command, m.payload.print.param, m.qos])).toEqual([["pause", "", 1]]);
    expect(last(s.app, "PC-pause")).toEqual({ state: "done", result: "The printer paused" });
    // Speed changes only while RUNNING: by its turn the printer had paused, so the bridge refused it.
    expect(last(s.app, "PC-speed")).toEqual({ state: "failed", error: "The speed can only change while the printer is printing" });
  });

  it("stop never waits behind a control the printer has not shown yet", async () => {
    const s = setup({
      // The light is answered but never shows in the reports: it waits 15 s. Stop must not wait behind it.
      commands: [queuedCommand("light", { on: true }), queuedCommand("stop")],
      printer: {
        snapshot: printing(),
        react: (msg, p) => {
          p.emit(replyTo(msg));
          if (msg.payload.print?.command === "stop") p.snapshot = withReport(p.snapshot, { gcode_state: "FAILED", print_error: 0x0300400c });
        },
      },
    });
    await s.run();
    expect(last(s.app, "PC-stop")).toEqual({ state: "done", result: "The printer stopped the print" });
    const order = s.app.reports.filter((r) => r.body.state !== "sent").map((r) => r.id);
    expect(order).toEqual(["PC-stop", "PC-light"]);
  });

  it("refuses what the printer cannot do now, and anything not on the list, without publishing", async () => {
    const s = setup({ commands: [queuedCommand("pause"), queuedCommand("gcode_line", { param: "G28" }), queuedCommand("light", {}, { by: "Chief" })] });
    await s.run();
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, "PC-pause")).toEqual({ state: "failed", error: "Pause works only while the printer is printing or preparing" });
    expect(last(s.app, "PC-gcode_line")).toEqual({ state: "failed", error: "Unknown printer command" });
    expect(last(s.app, "PC-light").error).toMatch(/^A person's name is required/);
  });

  it("a printer that does not answer: the message is taken back after 10 s and the command fails after 15 s", async () => {
    const s = setup({ commands: [queuedCommand("stop")], printer: { snapshot: printing() } });
    s.printer.acked = false;
    await s.run();
    expect(s.printer.published).toHaveLength(1);
    expect(s.printer.cancelled).toBe(1);
    expect(last(s.app, "PC-stop")).toEqual({ state: "failed", error: "No answer from the printer within 15 s: check the printer" });
  });

  it("refuses when the bridge is not connected to the printer", async () => {
    const s = setup({ commands: [queuedCommand("light", { on: false })] });
    s.printer.connected = false;
    await s.run();
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, "PC-light").error).toBe("The bridge is not connected to the printer");
  });

  it("leaves an item someone else took (409) alone", async () => {
    const s = setup({ commands: [queuedCommand("light", { on: true })] });
    const fetch = s.app.fetch;
    s.app.fetch = async (url, init) => (init?.method === "POST" ? Response.json({ error: "taken" }, { status: 409 }) : fetch(url, init));
    await s.run();
    await s.run();
    expect(s.printer.published).toEqual([]);
    expect(s.timeline).toEqual(["report:sent"]);
    expect(s.logs).toEqual([]);
  });

  it("dry run: checks and prints the message, publishes nothing, never prints the access code", async () => {
    const s = setup({ commands: [queuedCommand("light", { on: true })], dryRun: true });
    await s.run();
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, "PC-light")).toEqual({ state: "failed", error: DRY_RUN_TEXT });
    expect(s.logs.join("\n")).toContain('[dry-run] #1 PC-light light: would publish to device/<serial>/request (qos 1): {"system":{"sequence_id":"50000","command":"ledctrl"');
    expect(s.logs.join("\n")).not.toContain(s.printer.code);
  });

  it("sends the bearer token on every call, and only to the app", async () => {
    const s = setup({ commands: [queuedCommand("light", { on: true })] });
    await s.run();
    expect(s.app.calls.length).toBeGreaterThan(1);
    for (const c of s.app.calls) expect(c.auth).toBe("Bearer tok");
  });

  it("logs an unreachable app once, and once more when it is back", async () => {
    const s = setup();
    s.app.down = true;
    await s.run();
    await s.run();
    s.app.down = false;
    await s.run();
    expect(s.logs).toEqual(["! printer commands: could not reach http://app.test (fetch failed)", "ok printer commands: http://app.test answers again"]);
  });
});

describe("starting a print", () => {
  const bytes = Buffer.from(benchy());
  const prepares = (msg, p) => { p.emit(replyTo(msg)); p.snapshot = withReport(p.snapshot, { gcode_state: "PREPARE", stg: [2, 13, 1], stg_cur: 2 }); };

  it("downloads, checks, uploads to the SD root, tells the app, then sends project_file once", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, printer: { react: prepares } });
    await s.run();
    expect(s.timeline).toEqual(["report:uploading", "upload", "report:sent", "publish:project_file"]);
    expect(s.uploaded).toHaveLength(1);
    expect(s.uploaded[0]).toMatchObject({ ip: "192.0.2.10", code: "12345678", name: item.fileName });
    expect(Buffer.compare(s.uploaded[0].bytes, bytes)).toBe(0);
    expect(s.printer.published).toEqual([{ qos: 1, payload: { print: {
      sequence_id: "50000", command: "project_file", param: "Metadata/plate_1.gcode", url: `file:///sdcard/${item.fileName}`, file: "", md5: "",
      subtask_name: "ORD-012 Benchy", project_id: "0", profile_id: "0", task_id: "0", subtask_id: "0", bed_type: "auto", timelapse: false,
      bed_leveling: true, bed_levelling: true, flow_cali: false, vibration_cali: false, layer_inspect: true, use_ams: true, ams_mapping: [0],
    } } }]);
    expect(s.app.reports.map((r) => r.body)).toEqual([{ state: "uploading" }, { state: "sent", md5: md5(bytes) }]);
    expect(s.logs.some((l) => l.startsWith("ok #1 PJ-1-test print: the printer is PREPARE"))).toBe(true);
    await s.run();
    expect(s.printer.published).toHaveLength(1);
  });

  it("refuses a file whose checksum does not match: nothing is uploaded", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes, md5: "0".repeat(32) } } });
    await s.run();
    expect(s.uploaded).toEqual([]);
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "The file changed on the way (checksum mismatch)" });
  });

  it("refuses a busy printer before uploading", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, printer: { snapshot: printing() } });
    await s.run();
    expect(s.uploaded).toEqual([]);
    expect(last(s.app, item.id).error).toContain("The printer is printing: it must be idle or finished");
  });

  it("checks again after the upload: a print started at the printer meanwhile stops ours", async () => {
    const item = queuedJob(bytes);
    let s;
    s = setup({ jobs: [item], files: { [item.id]: { bytes } }, upload: async () => { s.printer.snapshot = printing(); } });
    await s.run();
    expect(s.uploaded).toHaveLength(1);
    expect(s.printer.published).toEqual([]);
    expect(states(s.app, item.id)).toEqual(["uploading", "failed"]);
  });

  it("a refusal from the printer fails the job; nothing is retried", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, printer: { react: (msg, p) => p.emit(replyTo(msg, "fail", "file not found")) } });
    await s.run();
    expect(s.printer.published).toHaveLength(1);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "The printer refused the print: file not found" });
  });

  it("a printer that never starts: failed after 45 s, the unreceived message taken back, one publish only", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } } });
    s.printer.acked = false;
    await s.run();
    expect(s.printer.published).toHaveLength(1);
    expect(s.printer.cancelled).toBe(1);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "The printer did not start within 45 s: check the printer screen, then start again" });
  });

  it("does not start when the app cannot record it", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, printer: { react: prepares } });
    const fetch = s.app.fetch;
    s.app.fetch = async (url, init) => (init?.body?.includes('"sent"') ? new Response("down", { status: 502 }) : fetch(url, init));
    await s.run();
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "The app could not record the start; nothing was sent to the printer" });
  });

  it("one print at a time per printer, even from two apps", async () => {
    const a = fakeApp("http://one.test", { jobs: [queuedJob(bytes, { id: "PJ-1-a", fileUrl: "/api/print-jobs/PJ-1-a/file" })], files: { "PJ-1-a": { bytes } } });
    const b = fakeApp("http://two.test", { jobs: [queuedJob(bytes, { id: "PJ-1-b", fileUrl: "/api/print-jobs/PJ-1-b/file" })], files: { "PJ-1-b": { bytes } } });
    const s = setup({ apps: [a, b], printer: { react: prepares } });
    await s.run();
    expect(s.uploaded).toHaveLength(1);
    expect(s.printer.published).toHaveLength(1);
    expect(last(b, "PJ-1-b")).toEqual({ state: "failed", error: "Another print (PJ-1-a) is starting on this printer" });
  });

  it("a job without options gets the app's defaults", async () => {
    const item = queuedJob(bytes, { options: undefined, amsMapping: [0] });
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, printer: { react: prepares } });
    await s.run();
    expect(s.printer.published[0].payload.print).toMatchObject({ bed_leveling: true, flow_cali: true, timelapse: false, use_ams: true, ams_mapping: [0] });
  });

  it("an unexpected error fails the job instead of leaving it uploading", async () => {
    const item = queuedJob(bytes);
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, parse: () => { throw new Error("boom"); } });
    await s.run();
    expect(s.uploaded).toEqual([]);
    expect(states(s.app, item.id)).toEqual(["uploading", "failed"]);
    expect(last(s.app, item.id).error).toBe("The bridge hit an error: boom");
  });

  it("downloads only from the app the job came from", async () => {
    const item = queuedJob(bytes, { fileUrl: "https://elsewhere.example/api/print-jobs/PJ-1-test/file" });
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } } });
    await s.run();
    expect(s.app.calls.every((c) => c.url.startsWith("http://app.test/"))).toBe(true);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "The job has no download link from this app" });
  });

  it("dry run: downloads and checks, prints the upload and the message, sends nothing", async () => {
    const item = queuedJob(bytes, { options: { bedLevelling: true, flowCali: true, timelapse: false, useAms: false }, amsMapping: [] });
    const s = setup({ jobs: [item], files: { [item.id]: { bytes } }, dryRun: true,
      printer: { snapshot: idleSnapshot({ vt_tray: { id: "254", tray_type: "PLA", tray_color: "FFFFFFFF" } }) } });
    await s.run();
    expect(s.uploaded).toEqual([]);
    expect(s.printer.published).toEqual([]);
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: DRY_RUN_TEXT });
    const out = s.logs.join("\n");
    expect(out).toContain(`would upload ${bytes.length} bytes (md5 ${md5(bytes)}) to the SD card as /${item.fileName} over FTPS`);
    expect(out).toContain('"command":"project_file"');
    expect(out).toContain('"use_ams":false');
    expect(out).not.toContain("ams_mapping");
    expect(out).not.toContain(s.printer.code);
  });
});

describe("camera", () => {
  it("one frame per request, then one every 10 s for 60 s after it, then nothing", async () => {
    const s = setup({ commands: [queuedCommand("camera_snapshot")] });
    await s.run();
    expect(s.app.frames.map((f) => f.printerId)).toEqual(["a1"]);
    expect(last(s.app, "PC-camera_snapshot")).toEqual({ state: "done", result: "Camera frame sent" });
    const tick = async (ms) => { s.clock.advance(ms); s.runner.cameraTick(); await s.runner.idle(); };
    await tick(5_000);
    expect(s.app.frames).toHaveLength(1);
    await tick(5_000);
    await tick(10_000);
    expect(s.app.frames).toHaveLength(3);
    await tick(45_000);
    await tick(10_000);
    expect(s.app.frames).toHaveLength(3);
    expect(s.grabs).toEqual([{ ip: "192.0.2.10", code: "12345678" }, { ip: "192.0.2.10", code: "12345678" }, { ip: "192.0.2.10", code: "12345678" }]);
  });

  it("never looks when nobody asked", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) { s.clock.advance(10_000); s.runner.cameraTick(); }
    await s.run();
    expect(s.grabs).toEqual([]);
  });

  it("reports a printer without a camera and a camera that does not answer", async () => {
    const none = setup({ commands: [queuedCommand("camera_snapshot")], printer: { snapshot: idleSnapshot({ ipcam: { ipcam_dev: "0" } }) } });
    await none.run();
    expect(last(none.app, "PC-camera_snapshot")).toEqual({ state: "failed", error: "This printer reports no camera" });
    expect(none.grabs).toEqual([]);
    const broken = setup({ commands: [queuedCommand("camera_snapshot")], grab: () => Promise.reject(new Error("no camera frame within 10 s")) });
    await broken.run();
    expect(last(broken.app, "PC-camera_snapshot")).toEqual({ state: "failed", error: "No camera frame: no camera frame within 10 s" });
  });
});

describe("camera while a print is on the printer", () => {
  it("one frame every 30 s to the control app, nobody watching; none once the printer is idle", async () => {
    const s = setup({ printer: { snapshot: printing() } });
    const tick = async (ms) => { s.clock.advance(ms); s.runner.cameraTick(); await s.runner.idle(); };
    await tick(1_000);
    expect(s.app.frames).toHaveLength(1);
    await tick(20_000);
    expect(s.app.frames).toHaveLength(1);
    await tick(10_000);
    expect(s.app.frames).toHaveLength(2);
    s.printer.snapshot = idleSnapshot();
    await tick(60_000);
    expect(s.app.frames).toHaveLength(2);
  });
});

describe("no LAN address leaves the bridge", () => {
  it("an upload error names the printer, not its address", async () => {
    const bytes = benchy();
    const item = queuedJob(bytes);
    const s = setup({
      jobs: [item], files: { [item.id]: { bytes } },
      upload: () => Promise.reject(new Error("connect ECONNREFUSED 192.0.2.10:990")),
    });
    await s.run();
    expect(last(s.app, item.id)).toEqual({ state: "failed", error: "Upload to the printer failed: connect ECONNREFUSED printer #1 (port 990)" });
    expect(JSON.stringify(s.app.reports)).not.toContain("192.0.2.10");
  });
});

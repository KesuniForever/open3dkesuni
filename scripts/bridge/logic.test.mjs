import { describe, expect, it, vi } from "vitest";
import { parse3mf } from "../../src/lib/threemf.ts";
import {
  AGENT_SPOOL_CHANGED_TEXT, appList, commandOutcome, controlApps, downloadProblem, hideAddresses, isLocalUrl, jobFileUrl, parseArgs, quietLog, replyMatches, safeApps,
  sendKey, startOutcome, startReasons,
} from "./logic.mjs";
import { benchy, idleSnapshot, md5, queuedJob, T0, withReport } from "./fakes.test-helper.mjs";

describe("settings", () => {
  it("reads the flags and the app list", () => {
    expect(parseArgs(["--dry-run"])).toEqual({ dryRun: true, readOnly: false, sliceOnly: false, once: false });
    expect(parseArgs(["--read-only"])).toEqual({ dryRun: false, readOnly: true, sliceOnly: false, once: false });
    expect(parseArgs(["--slice-only", "--once"])).toEqual({ dryRun: false, readOnly: false, sliceOnly: true, once: true });
    expect(parseArgs(["--once"])).toMatchObject({ sliceOnly: false, once: false }); // --once only with --slice-only
    expect(appList(" http://localhost:3000/, https://x.up.railway.app ,")).toEqual(["http://localhost:3000", "https://x.up.railway.app"]);
    expect(appList(undefined)).toEqual([]);
  });

  it("plain http only to this computer or the studio network: the bridge token never travels in clear text", () => {
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("http://192.168.100.5:3000")).toBe(true);
    expect(isLocalUrl("http://172.20.0.1")).toBe(true);
    expect(isLocalUrl("https://x.up.railway.app")).toBe(false);
    expect(isLocalUrl("http://172.32.0.1")).toBe(false);
    const r = safeApps(["http://localhost:3000", "https://x.up.railway.app", "http://203.0.113.9:3000", "nonsense"]);
    expect(r.ok).toEqual(["http://localhost:3000", "https://x.up.railway.app"]);
    expect(r.refused).toHaveLength(2);
    expect(r.refused[0]).toMatch(/^http:\/\/203\.0\.113\.9:3000: plain http/);
  });

  it("takes commands from ONE app: the studio's own by default, a public one only when named", () => {
    const apps = ["https://x.up.railway.app", "http://localhost:3000", "http://192.168.100.5:3000"];
    expect(controlApps({ apps })).toEqual({ control: ["http://localhost:3000"], notes: [] });
    // Railway alone: no commands until CONTROL_APP_URL names it.
    const none = controlApps({ apps: ["https://x.up.railway.app"] });
    expect(none.control).toEqual([]);
    expect(none.notes[0]).toMatchObject({ loud: true });
    const pub = controlApps({ apps, controlUrl: "https://x.up.railway.app" });
    expect(pub.control).toEqual(["https://x.up.railway.app"]);
    expect(pub.notes.map((n) => n.text).join()).toMatch(/PUBLIC CONTROL/);
    expect(controlApps({ apps, controlUrl: "http://203.0.113.9" }).control).toEqual([]);
    expect(controlApps({ apps, readOnly: true }).control).toEqual([]);
    expect(controlApps({ apps, bridgeControl: "off" }).control).toEqual([]);
  });

  it("hides the printers' LAN addresses in texts sent to the app", () => {
    expect(hideAddresses("connect ECONNREFUSED 192.168.1.50:990", "#1")).toBe("connect ECONNREFUSED printer #1 (port 990)");
    expect(hideAddresses("timeout talking to 10.0.0.2.", "#2")).toBe("timeout talking to printer #2.");
    expect(hideAddresses("firmware 01.08.01.00", "#1")).toBe("firmware 01.08.01.00");
  });
});

describe("sendKey: when a new snapshot goes to the apps at once", () => {
  const idle = idleSnapshot();
  it("ignores temperatures and fractions of a percent", () => {
    expect(sendKey(withReport(idle, { nozzle_temper: 200, bed_temper: 60, wifi_signal: "-70dBm", mc_percent: 0.4 }))).toBe(sendKey(idle));
  });
  it("changes with the light, the speed, the stage, a fault, the spools, the SD card and the firmware", () => {
    const keys = [
      withReport(idle, { lights_report: [{ node: "chamber_light", mode: "on" }] }),
      withReport(idle, { spd_lvl: 3 }),
      withReport(idle, { gcode_state: "PREPARE", stg: [2, 13], stg_cur: 2 }),
      withReport(idle, { hms: [{ attr: 84935680, code: 65604 }] }),
      withReport(idle, { print_error: 0x07008011 }),
      withReport(idle, { ams: { ams: [{ id: "0", tray: [{ id: "1", tray_type: "PLA", tray_color: "000000FF" }] }] } }),
      withReport(idle, { sdcard: false }),
      { ...idle, firmware: { product: "Bambu Lab A1", ota: "01.08.01.00", ams: "00.00.08.15" } },
    ].map(sendKey);
    for (const k of keys) expect(k).not.toBe(sendKey(idle));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("replies", () => {
  it("match our sequence id and command; get_version always uses 0", () => {
    const r = { type: "print", command: "print_speed", sequenceId: "50001", ok: true, reason: "" };
    expect(replyMatches(r, "speed", "50001")).toBe(true);
    expect(replyMatches(r, "speed", "50002")).toBe(false);
    expect(replyMatches(r, "pause", "50001")).toBe(false);
    expect(replyMatches({ ...r, type: "info", command: "get_version", sequenceId: "0" }, "get_version", "50003")).toBe(true);
    expect(replyMatches(null, "pause", "50001")).toBe(false);
  });
});

describe("commandOutcome", () => {
  const idle = idleSnapshot();
  const running = withReport(idle, { gcode_state: "RUNNING", stg: [2, 0], stg_cur: 0 });
  const paused = withReport(running, { gcode_state: "PAUSE", stg_cur: 16 });
  const yes = { ok: true, reason: "" };

  it("is done when the report shows the change", () => {
    expect(commandOutcome({ kind: "pause", reply: null, snapshot: paused, elapsedMs: 900 })).toEqual({ status: "done", text: "The printer paused" });
    expect(commandOutcome({ kind: "resume", reply: null, snapshot: running, elapsedMs: 900 }).status).toBe("done");
    expect(commandOutcome({ kind: "stop", reply: null, snapshot: withReport(running, { gcode_state: "FAILED", print_error: 0x0300400c }), elapsedMs: 900 }))
      .toEqual({ status: "done", text: "The printer stopped the print" });
    expect(commandOutcome({ kind: "speed", params: { level: 3 }, reply: null, snapshot: withReport(running, { spd_lvl: 3 }), elapsedMs: 1 }).status).toBe("done");
    expect(commandOutcome({ kind: "light", params: { on: true }, reply: null, snapshot: withReport(idle, { lights_report: [{ node: "chamber_light", mode: "on" }] }), elapsedMs: 1 }))
      .toEqual({ status: "done", text: "The light is on" });
    expect(commandOutcome({ kind: "get_version", reply: yes, snapshot: idle, elapsedMs: 1 }).status).toBe("done");
  });

  it("fails at once when the printer refuses, and waits otherwise", () => {
    expect(commandOutcome({ kind: "pause", reply: { ok: false, reason: "busy" }, snapshot: running, elapsedMs: 1 }))
      .toEqual({ status: "failed", text: "The printer refused: busy" });
    expect(commandOutcome({ kind: "pause", reply: yes, snapshot: running, elapsedMs: 14_000 })).toEqual({ status: "waiting" });
  });

  it("after 15 s: a pause, resume or stop that did not show needs a person; no answer at all fails", () => {
    expect(commandOutcome({ kind: "resume", reply: yes, snapshot: paused, elapsedMs: 15_000 }))
      .toEqual({ status: "failed", text: "The printer did not resume: check the printer screen" });
    expect(commandOutcome({ kind: "stop", reply: yes, snapshot: running, elapsedMs: 15_000 }).status).toBe("failed");
    expect(commandOutcome({ kind: "light", params: { on: true }, reply: yes, snapshot: idle, elapsedMs: 15_000 }))
      .toEqual({ status: "done", text: "The printer accepted it" });
    expect(commandOutcome({ kind: "light", params: { on: true }, reply: null, snapshot: idle, elapsedMs: 15_000 }))
      .toEqual({ status: "failed", text: "No answer from the printer within 15 s: check the printer" });
  });
});

describe("startOutcome", () => {
  const idle = idleSnapshot();
  it("started once the printer prepares or prints; the app follows the job from there", () => {
    expect(startOutcome({ baseline: idle, reply: null, snapshot: withReport(idle, { gcode_state: "PREPARE" }), elapsedMs: 3_000 })).toEqual({ status: "started" });
    // A wrong AMS mapping pauses the print: it started, and the pause is the app's (and a person's) business.
    expect(startOutcome({ baseline: idle, reply: null, snapshot: withReport(idle, { gcode_state: "PAUSE", print_error: 0x07008012 }), elapsedMs: 9_000 }).status).toBe("started");
  });
  it("fails on a refusal, a new error or FAILED, never on what was there before", () => {
    expect(startOutcome({ baseline: idle, reply: { ok: false, reason: "file not found" }, snapshot: idle, elapsedMs: 1_000 }))
      .toEqual({ status: "failed", text: "The printer refused the print: file not found" });
    expect(startOutcome({ baseline: idle, reply: null, snapshot: withReport(idle, { print_error: 0x05004038 }), elapsedMs: 2_000 }))
      .toEqual({ status: "failed", text: "Printer error 0500-4038: the print did not start" });
    expect(startOutcome({ baseline: idle, reply: null, snapshot: withReport(idle, { gcode_state: "FAILED" }), elapsedMs: 2_000 }).status).toBe("failed");
    const lastFailed = withReport(idle, { gcode_state: "FAILED", print_error: 0x0300400c });
    expect(startOutcome({ baseline: lastFailed, reply: null, snapshot: lastFailed, elapsedMs: 2_000 })).toEqual({ status: "waiting" });
  });
  it("gives up after 45 s without retrying", () => {
    expect(startOutcome({ baseline: idle, reply: { ok: true }, snapshot: idle, elapsedMs: 44_500 })).toEqual({ status: "waiting" });
    expect(startOutcome({ baseline: idle, reply: { ok: true }, snapshot: idle, elapsedMs: 45_000 }))
      .toEqual({ status: "failed", text: "The printer did not start within 45 s: check the printer screen, then start again" });
  });
});

describe("startReasons: checked again by the bridge right before a print starts", () => {
  const info = parse3mf(benchy());
  const item = queuedJob(benchy());
  const live = (snapshot, extra = {}) => ({ snapshot, lastSeen: new Date(T0).toISOString(), connected: true, ...extra });

  it("passes for an idle printer with the right spool", () => {
    expect(startReasons(live(idleSnapshot()), item, info, { now: T0 })).toEqual([]);
  });
  it("blocks when the printer changed since the person pressed Start", () => {
    expect(startReasons(live(idleSnapshot(), { connected: false }), item, info, { now: T0 })).toContain("The bridge is not connected to the printer");
    expect(startReasons(live(idleSnapshot(), { lastSeen: new Date(T0 - 61_000).toISOString() }), item, info, { now: T0 }))
      .toContain("The printer has not reported in the last minute (is the bridge running?)");
    expect(startReasons(live(idleSnapshot({ gcode_state: "RUNNING" })), item, info, { now: T0 })).toContain("The printer is printing: it must be idle or finished");
    expect(startReasons(live(idleSnapshot({ hms: [{ attr: 84935680, code: 65604 }] })), item, info, { now: T0 }))
      .toContain("Printer error HMS_0510_0400_0001_0044: fix it before printing");
    expect(startReasons(live(idleSnapshot()), { ...item, amsMapping: [2] }, info, { now: T0 })).toContain("Filament 1 needs PLA, but slot 3 holds PETG");
    expect(startReasons(live(idleSnapshot()), { ...item, by: "Chief" }, info, { now: T0 })).toContain("A person's name is required");
  });
  it("a warning older than the job was seen by the person; a newer one was not", () => {
    const warn = (ts) => idleSnapshot({ hms: [{ attr: 0x07000300, code: 0x00030001, timestamp: ts }] });
    expect(startReasons(live(warn(Math.floor((T0 - 60_000) / 1000))), item, info, { now: T0 })).toEqual([]);
    expect(startReasons(live(warn(Math.floor(T0 / 1000))), item, info, { now: T0 }))
      .toEqual(["New printer warning HMS_0700_0300_0003_0001 since the print was queued: check it and start again"]);
  });
  it("never sends more than 10 min after the person confirmed the bed", () => {
    const old = { ...item, createdAt: new Date(T0 - 10 * 60_000 - 1).toISOString() };
    const late = "The bed was confirmed more than 10 min ago: nothing was sent. Check the bed again and start again.";
    expect(startReasons(live(idleSnapshot()), old, info, { now: T0 })).toContain(late);
    expect(startReasons(live(idleSnapshot()), { ...item, sendBy: new Date(T0 - 1).toISOString() }, info, { now: T0 })).toContain(late);
    expect(startReasons(live(idleSnapshot()), item, info, { now: T0 })).not.toContain(late);
  });

  it("an agent print: the person who confirmed the bed instead of a person at the printer; any warning or a failed print blocks it", () => {
    const agent = { ...item, by: "agent", actor: "agent", bedConfirmedBy: "Khelda", expectedTrays: [{ tray: 0, type: "PLA", color: "#FEC600" }] };
    expect(startReasons(live(idleSnapshot()), agent, info, { now: T0 })).toEqual([]);
    // Nobody at the printer sees a spool swapped during the upload: another colour, no spool, or no expected spools at all.
    const swapped = idleSnapshot({ ams: { ams: [{ id: "0", info: "1002", tray: [{ id: "0", tray_type: "PLA", tray_color: "000000FF", tray_sub_brands: "" }] }] } });
    expect(startReasons(live(swapped), agent, info, { now: T0 })).toContain(AGENT_SPOOL_CHANGED_TEXT);
    expect(startReasons(live(idleSnapshot()), { ...agent, expectedTrays: undefined }, info, { now: T0 })).toContain(AGENT_SPOOL_CHANGED_TEXT);
    expect(startReasons(live(idleSnapshot()), { ...agent, expectedTrays: [{ tray: 1, type: "PLA", color: "#FEC600" }] }, info, { now: T0 })).toContain(AGENT_SPOOL_CHANGED_TEXT);
    expect(startReasons(live(idleSnapshot()), item, info, { now: T0 })).not.toContain(AGENT_SPOOL_CHANGED_TEXT); // a person's print: they look
    expect(startReasons(live(idleSnapshot()), { ...agent, bedConfirmedBy: undefined }, info, { now: T0 }))
      .toEqual(["The agent prints only after a person confirmed the bed is empty"]);
    expect(startReasons(live(idleSnapshot({ gcode_state: "FAILED" })), agent, info, { now: T0 })).toContain("The last print failed: a person starts the next one");
    const oldWarning = idleSnapshot({ hms: [{ attr: 0x07000300, code: 0x00030001, timestamp: Math.floor((T0 - 60_000) / 1000) }] });
    expect(startReasons(live(oldWarning), agent, info, { now: T0 })).toContain("Check the warnings and tick \"I checked this\"");
    // A person's job named "agent" is still refused as before.
    expect(startReasons(live(idleSnapshot()), { ...item, by: "agent" }, info, { now: T0 })).toContain("A person's name is required");
  });

  it("refuses a file that is not sliced", () => {
    expect(startReasons(live(idleSnapshot()), item, parse3mf(new Uint8Array([1, 2, 3])), { now: T0 })[0]).toMatch(/^The 3MF could not be read|^Not a sliced file/);
  });
});

describe("downloads", () => {
  const bytes = Buffer.from(benchy());
  const sum = md5(bytes);
  const item = queuedJob(bytes);
  it("only from the app the job came from", () => {
    expect(jobFileUrl("http://app.test", "/api/print-jobs/PJ-1-x/file")).toBe("http://app.test/api/print-jobs/PJ-1-x/file");
    expect(jobFileUrl("http://app.test", "https://evil.example/api/print-jobs/PJ-1/file")).toBeNull();
    expect(jobFileUrl("http://app.test", "/api/print-jobs/../../secrets/file")).toBeNull();
    expect(jobFileUrl("http://app.test", undefined)).toBeNull();
  });
  it("checks the checksum and the size", () => {
    expect(downloadProblem({ bytes, md5: sum, headerMd5: sum.toUpperCase(), item })).toBeNull();
    expect(downloadProblem({ bytes, md5: sum, headerMd5: null, item })).toBe("The app did not send the file's checksum");
    expect(downloadProblem({ bytes, md5: sum, headerMd5: "0".repeat(32), item })).toBe("The file changed on the way (checksum mismatch)");
    expect(downloadProblem({ bytes, md5: sum, headerMd5: sum, item: { ...item, md5: "f".repeat(32) } })).toMatch(/not the one the job was made with/);
    expect(downloadProblem({ bytes, md5: sum, headerMd5: sum, item: { ...item, size: 5 } })).toBe(`The file has ${bytes.length} bytes; the job says 5`);
    expect(downloadProblem({ bytes: Buffer.alloc(0), md5: sum, headerMd5: sum, item })).toBe("The file is empty");
  });
});

describe("quietLog", () => {
  it("logs a problem once and its end once", () => {
    const log = vi.fn();
    const q = quietLog(log);
    q.ok("a", "back");
    q.problem("a", "down");
    q.problem("a", "down");
    q.problem("a", "down: 503");
    q.ok("a", "back");
    q.ok("a", "back");
    expect(log.mock.calls.map((c) => c[0])).toEqual(["down", "down: 503", "back"]);
  });
});

describe("refusals with a device error code (err_code)", () => {
  const reply = (extra) => ({ type: "print", command: "pause", sequenceId: "50000", ok: false, reason: "", ...extra });
  it("names the code when the printer gives no reason", () => {
    expect(commandOutcome({ kind: "pause", reply: reply({ errCode: "0500-4004" }), snapshot: idleSnapshot(), elapsedMs: 0 }))
      .toEqual({ status: "failed", text: "The printer refused with error 0500-4004" });
    expect(startOutcome({ baseline: idleSnapshot(), reply: reply({ errCode: "0500-4037" }), snapshot: idleSnapshot(), elapsedMs: 0 }))
      .toEqual({ status: "failed", text: "The printer refused the print with error 0500-4037" });
    expect(commandOutcome({ kind: "pause", reply: reply({ reason: "busy", errCode: "0500-4004" }), snapshot: idleSnapshot(), elapsedMs: 0 }).text)
      .toBe("The printer refused: busy (error 0500-4004)");
  });
});

describe("startOutcome: a new fatal or serious HMS message", () => {
  const hms = (code) => [{ attr: 0x05100400, code }];
  it("fails with its code; one that was there before, or a common one, does not", () => {
    const base = idleSnapshot();
    const fatal = withReport(base, { hms: hms(0x00010044) });
    expect(startOutcome({ baseline: base, reply: null, snapshot: fatal, elapsedMs: 1_000 }))
      .toEqual({ status: "failed", text: "Printer error HMS_0510_0400_0001_0044: the print did not start" });
    expect(startOutcome({ baseline: fatal, reply: null, snapshot: fatal, elapsedMs: 1_000 })).toEqual({ status: "waiting" });
    expect(startOutcome({ baseline: base, reply: null, snapshot: withReport(base, { hms: hms(0x00030044) }), elapsedMs: 1_000 })).toEqual({ status: "waiting" });
  });
});

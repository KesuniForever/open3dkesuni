// The bridge's decisions, without any I/O: when to send a snapshot, whether a command worked, whether a print started,
// and what to check before a print starts. Kept apart so they can be tested (scripts/bridge/logic.test.mjs).
// Texts are English: the app stores them on the command or print job and pages translate them.
import { BUSY_STATES, errorCodeText, isFaultPrintError } from "../../src/lib/printer/bambu.ts";
import { canStartPrint, START_CONFIRM_MS } from "../../src/lib/printer/control.ts";

/** How long a control may take to show on the printer, and how long a print may take to start preparing. */
export const COMMAND_WAIT_MS = 15_000;
export const START_WAIT_MS = 45_000;
/** A QoS 1 message without the broker's receipt by then is taken back, so it is never re-sent after a reconnect. */
export const ACK_WAIT_MS = 10_000;

export const DRY_RUN_TEXT = "Dry run: nothing was sent to the printer";

/** Command-line flags. */
/**
 * --dry-run, --read-only; --slice-only: no printer at all (no MQTT, no FTPS, no print queue), only slices for the control
 * app; --once (with --slice-only): take at most one slice, then exit.
 */
export function parseArgs(argv) {
  const sliceOnly = argv.includes("--slice-only");
  return { dryRun: argv.includes("--dry-run"), readOnly: argv.includes("--read-only"), sliceOnly, once: sliceOnly && argv.includes("--once") };
}

/** "a, b/" -> ["a", "b"]: app addresses without a trailing slash. */
export const appList = (text) => String(text ?? "").split(",").map((u) => u.trim().replace(/\/+$/, "")).filter(Boolean);

/** This computer or the studio network (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x). */
export function isLocalUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  return host === "localhost" || host === "::1" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/**
 * The apps the bridge may talk to: https anywhere, plain http only on this computer or the studio network (the bridge
 * token would travel in clear text). Anything else is left out with a reason in `refused`.
 */
export function safeApps(list) {
  const ok = [];
  const refused = [];
  for (const app of list) {
    let u;
    try {
      u = new URL(app);
    } catch {
      refused.push(`${app}: not a web address`);
      continue;
    }
    if (u.protocol === "https:" || (u.protocol === "http:" && isLocalUrl(app))) ok.push(app);
    else refused.push(`${app}: plain http to a public address would send PRINTER_BRIDGE_TOKEN in clear text (use https)`);
  }
  return { ok, refused };
}

/**
 * Where people's controls and print jobs come from. One app only by default: the first APP_URL on this computer or
 * the studio network (each app has its own database, so two control apps could each think the printer is free).
 * A public app (Railway) controls the printers only when CONTROL_APP_URL names it; --read-only or BRIDGE_CONTROL=off
 * takes no commands at all. `notes` are printed at start; `loud` ones are warnings.
 */
export function controlApps({ apps, controlUrl, readOnly = false, bridgeControl }) {
  if (readOnly || /^(off|0|false|no)$/i.test(bridgeControl ?? "")) return { control: [], notes: [] };
  if (controlUrl) {
    const { ok, refused } = safeApps(appList(controlUrl));
    const notes = refused.map((r) => ({ loud: true, text: `! CONTROL_APP_URL ${r}` }));
    for (const app of ok.filter((a) => !isLocalUrl(a))) {
      notes.push({ loud: true, text: `! PUBLIC CONTROL: anyone with the operator password of ${app} can start, pause and stop the printers` });
    }
    if (ok.length > 1) notes.push({ loud: true, text: `! ${ok.length} control apps: each has its own database, so use one unless you are sure` });
    return { control: ok, notes };
  }
  const local = apps.find(isLocalUrl);
  return local
    ? { control: [local], notes: [] }
    : { control: [], notes: [{ loud: true, text: "! no APP_URL on this computer or network: taking no commands (set CONTROL_APP_URL to choose one)" }] };
}

/** "connect ECONNREFUSED 192.168.1.50:990" -> "connect ECONNREFUSED printer #1 (port 990)": no LAN address leaves the bridge. */
const IPV4 = /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?::(\d{1,5}))?(?!\.?\d)/g;
export const hideAddresses = (text, label) =>
  String(text).replace(IPV4, (_m, port) => (port ? `printer ${label} (port ${port})` : `printer ${label}`));

/**
 * What a person would notice on the website. A new value sends the snapshot at once; everything else (temperatures,
 * Wi-Fi) goes with the 30 s repeat.
 */
export function sendKey(s) {
  const trays = (s.ams?.trays ?? []).map((t) => (t.empty ? "-" : `${t.type}${t.color}`)).join(",");
  return [
    s.state, Math.floor(s.percent), s.stage?.code ?? "", s.stage?.needsPerson ? "!" : "", s.light ?? "", s.speedLevel ?? "",
    s.errorCode, (s.hms ?? []).map((h) => h.code).join("+"), trays, s.ams?.activeSlot ?? "", s.externalSpool?.type ?? "",
    s.externalSpool?.color ?? "", s.sdcard ?? "", s.sdAbnormal ? "sd!" : "", s.nozzle?.diameter ?? "", s.firmware?.ota ?? "", s.firmware?.ams ?? "",
  ].join("|");
}

/** The MQTT payload kind and the reply's command for each queue command kind. */
export const MQTT_KIND = { pause: "pause", resume: "resume", stop: "stop", speed: "speed", light: "light", get_version: "get_version" };
export const REPLY_COMMAND = {
  pause: "pause", resume: "resume", stop: "stop", speed: "print_speed", light: "ledctrl", get_version: "get_version", start_print: "project_file",
};

/** True when a reply (parseReply) answers what we sent. get_version always uses sequence "0". */
export const replyMatches = (reply, kind, sequenceId) =>
  Boolean(reply) && reply.command === REPLY_COMMAND[kind] && (kind === "get_version" || reply.sequenceId === sequenceId);

/** The change each control makes in the reports. */
const EFFECT = {
  pause: (s) => s?.state === "PAUSE",
  resume: (s) => s?.state === "RUNNING" || s?.state === "PREPARE",
  stop: (s) => Boolean(s) && !BUSY_STATES.includes(s.state),
  speed: (s, p) => s?.speedLevel === p.level,
  light: (s, p) => s?.light === (p.on ? "on" : "off"),
  get_version: () => false,
};
const DONE_TEXT = {
  pause: () => "The printer paused",
  resume: () => "The printer is printing again",
  stop: () => "The printer stopped the print",
  speed: () => "The print speed changed",
  light: (p) => (p.on ? "The light is on" : "The light is off"),
  get_version: () => "The printer sent its firmware versions",
};
/** Answered, but the change did not show: these need a person to look. */
const NOT_SEEN_TEXT = {
  pause: "The printer has not paused yet: check the printer",
  resume: "The printer did not resume: check the printer screen",
  stop: "The printer has not stopped yet: check the printer",
};

/** Why the printer refused, for "The printer refused...": its reason, its device error code, or both. */
function refusal(reply, prefix) {
  if (reply.reason) return `${prefix}: ${reply.reason}${reply.errCode ? ` (error ${reply.errCode})` : ""}`;
  return reply.errCode ? `${prefix} with error ${reply.errCode}` : `${prefix}: no reason given`;
}

/**
 * After a control was published: done, failed, or still waiting. `reply` is the printer's answer (parseReply) or null;
 * `snapshot` is the latest merged report.
 */
export function commandOutcome({ kind, params = {}, reply, snapshot, elapsedMs, waitMs = COMMAND_WAIT_MS }) {
  if (reply && reply.ok === false) return { status: "failed", text: refusal(reply, "The printer refused") };
  if (EFFECT[kind]?.(snapshot, params)) return { status: "done", text: DONE_TEXT[kind](params) };
  if (kind === "get_version" && reply) return { status: "done", text: DONE_TEXT.get_version() };
  if (elapsedMs < waitMs) return { status: "waiting" };
  if (reply) return NOT_SEEN_TEXT[kind] ? { status: "failed", text: NOT_SEEN_TEXT[kind] } : { status: "done", text: "The printer accepted it" };
  return { status: "failed", text: "No answer from the printer within 15 s: check the printer" };
}

/**
 * After project_file was published. `baseline` is the snapshot just before. Started = the printer is preparing or
 * printing (the app then follows the job from the reports). Failed = a refusal, a new device error, a new fatal or
 * serious HMS message, FAILED, or nothing within 45 s. Never retried here: a person starts again.
 */
export function startOutcome({ baseline, reply, snapshot, elapsedMs, waitMs = START_WAIT_MS }) {
  if (reply && reply.ok === false) return { status: "failed", text: refusal(reply, "The printer refused the print") };
  if (snapshot && BUSY_STATES.includes(snapshot.state)) return { status: "started" };
  const code = snapshot?.errorCode ?? 0;
  if (code && code !== (baseline?.errorCode ?? 0) && isFaultPrintError(code)) {
    return { status: "failed", text: `Printer error ${errorCodeText(code)}: the print did not start` };
  }
  const before = new Set((baseline?.hms ?? []).map((h) => h.code));
  const hms = (snapshot?.hms ?? []).find((h) => (h.severity === 1 || h.severity === 2) && !before.has(h.code));
  if (hms) return { status: "failed", text: `Printer error ${hms.code}: the print did not start` };
  if (snapshot?.state === "FAILED" && baseline?.state !== "FAILED") return { status: "failed", text: "The printer did not start the print" };
  if (elapsedMs < waitMs) return { status: "waiting" };
  return { status: "failed", text: "The printer did not start within 45 s: check the printer screen, then start again" };
}

/**
 * Everything checked again right before a print is sent, against the bridge's own live view of the printer: the app
 * checked the same when the person pressed Start, but the printer may have changed since.
 * live = { snapshot, lastSeen (ISO of the last status report), connected }.
 * The person's name, the bed confirmation and "I checked this" were given in the app; a warning the printer raised
 * after the job was queued was never seen by that person, so it blocks.
 * An agent print (item.actor "agent", queued by the app's dispatcher after a person's "Bed is empty") is checked as the
 * agent: the person who confirmed the bed (bedConfirmedBy) instead of a person at the printer, and never after a failed
 * print (FAILED); its warnings are not ticked by anyone, so any warning blocks it.
 */
export function startReasons(live, item, info, { now, jobInFlight = null }) {
  const printer = { lastSeen: live.lastSeen, snapshot: live.snapshot, currentOrderId: undefined };
  const agent = item.actor === "agent";
  const verdict = canStartPrint(printer, {
    info, plate: item.plate, amsMapping: item.amsMapping ?? [], options: item.options, bedEmptyConfirmed: !agent, personPresent: !agent,
    by: item.by, orderId: item.orderId, jobInFlight, warningsChecked: !agent,
    ...(agent ? { actor: "agent", bedConfirmedBy: item.bedConfirmedBy } : {}),
  }, now);
  const reasons = [...verdict.reasons];
  if (!live.connected) reasons.unshift("The bridge is not connected to the printer");
  const queuedAt = Date.parse(item.createdAt);
  // The person confirmed the bed for now, not for later: never send more than 10 min after (the app checks it too).
  const sendBy = Math.min(Number.isFinite(queuedAt) ? queuedAt + START_CONFIRM_MS : 0, Date.parse(item.sendBy ?? "") || Infinity);
  if (!(now <= sendBy)) reasons.push("The bed was confirmed more than 10 min ago: nothing was sent. Check the bed again and start again.");
  for (const h of live.snapshot?.hms ?? []) {
    if (h.severity === 3 && h.since && Number.isFinite(queuedAt) && Date.parse(h.since) > queuedAt) {
      reasons.push(`New printer warning ${h.code} since the print was queued: check it and start again`);
    }
  }
  // Nobody is at the printer to see a spool swapped during the upload: an agent print needs every mapped tray to hold
  // exactly the spool the app queued it with (the app checks the same at "sent").
  if (agent && agentSpoolsChanged(live.snapshot, item.expectedTrays)) reasons.push(AGENT_SPOOL_CHANGED_TEXT);
  return reasons;
}

/** Why the bridge sends no agent print whose spools changed (the same words as the app's). */
export const AGENT_SPOOL_CHANGED_TEXT = "A spool changed after the agent queued the print: nothing was sent. A person confirms the colours again.";

/** True when the app sent no expected spools, or a mapped tray now holds another material or colour (or none). */
export function agentSpoolsChanged(snapshot, expected) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  return expected.some((e) => {
    const t = snapshot?.ams?.trays?.find((x) => x.ams * 4 + x.slot === e?.tray);
    return !t || t.empty || String(t.type ?? "").toUpperCase() !== e.type || String(t.color ?? "").toUpperCase() !== e.color;
  });
}

/** The download link of a job's file, only on the app it came from (the bridge token is never sent anywhere else). */
export function jobFileUrl(app, fileUrl) {
  return typeof fileUrl === "string" && /^\/api\/print-jobs\/[A-Za-z0-9_-]{1,40}\/file$/.test(fileUrl) ? `${app}${fileUrl}` : null;
}

/** Why a downloaded 3MF must not be used, or null. headerMd5 = the app's x-file-md5; item = the queue item. */
export function downloadProblem({ bytes, md5, headerMd5, item }) {
  if (!bytes?.length) return "The file is empty";
  if (!headerMd5 || !/^[0-9a-f]{32}$/i.test(headerMd5)) return "The app did not send the file's checksum";
  if (md5 !== headerMd5.toLowerCase()) return "The file changed on the way (checksum mismatch)";
  if (item.md5 && item.md5.toLowerCase() !== md5) return "The file is not the one the job was made with (checksum mismatch)";
  if (item.size && item.size !== bytes.length) return `The file has ${bytes.length} bytes; the job says ${item.size}`;
  return null;
}

/** Log a problem once, not on every 3 s poll; log once more when it is over. */
export function quietLog(log) {
  const last = new Map();
  return {
    problem(key, text) {
      if (last.get(key) === text) return;
      last.set(key, text);
      log(text);
    },
    ok(key, text) {
      if (!last.has(key)) return;
      last.delete(key);
      if (text) log(text);
    },
  };
}

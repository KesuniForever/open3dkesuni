// Slices people (or the agent, through the app's dispatcher) asked for on the website, on this PC with Bambu Studio.
// Every 5 s the bridge asks each control app (GET /api/slicer/queue) for queued slices, takes ONE (the app lets a slice
// be taken a single time), downloads the model, slices it (scripts/bridge/slicer.mjs), and uploads the .gcode.3mf back
// (POST /api/slicer/jobs/<id>/result), or reports why it failed. One slice at a time. Never touches a printer.
// The model and the sliced file only ever travel between this PC and the app the slice came from; the bridge token is
// never sent anywhere else. Texts sent back are short, English, and never hold a local path or a LAN address.
// All I/O comes in through createSliceRunner's options, so scripts/bridge/slice-runner.test.mjs runs it without
// Bambu Studio.
import { createHash } from "node:crypto";
import { MAX_SLICE_BYTES, SLICE_ALIVE_MS } from "../../src/lib/slice-rules.ts";
import { quietLog } from "./logic.mjs";

export const SLICE_POLL_MS = 5_000;
const realClock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

/** A slice's download or upload link, only on the app it came from (the token is never sent anywhere else). */
export function sliceUrl(app, path, kind) {
  const re = kind === "source" ? /^\/api\/slicer\/jobs\/[A-Za-z0-9_-]{1,40}\/source$/ : /^\/api\/slicer\/jobs\/[A-Za-z0-9_-]{1,40}\/result$/;
  return typeof path === "string" && re.test(path) ? `${app}${path}` : null;
}

const md5 = (bytes) => createHash("md5").update(bytes).digest("hex");
/** Download and upload limits: with the 10 min slicer limit a slice never runs much past 15 min. */
const TRANSFER_MS = 120_000;
/** sliceModel codes that are about this PC, not the model: the agent may ask again later. Anything else is the model. */
const STUDIO_CODES = new Set(["no-slicer", "no-profiles", "spawn", -1, -3, -5]);
const minutes = (sec) => (sec ? `${Math.round(sec / 60)} min` : "? min");

/**
 * apps: the control apps. slice(req) -> { ok, bytes, fileName, info, ms } | { ok: false, message } (sliceModel with this
 * PC's Bambu Studio). fetch, clock, log and warn can be replaced in tests.
 */
export function createSliceRunner({ apps, token, slice, fetch = globalThis.fetch, clock = realClock, log = console.log, warn = console.error, pollMs = SLICE_POLL_MS }) {
  const quiet = quietLog(warn);
  const auth = { authorization: `Bearer ${token}` };
  let busy = false;

  const api = (app, path, { timeoutMs = 15_000, headers = {}, ...init } = {}) =>
    fetch(`${app}${path}`, { ...init, headers: { ...auth, ...headers }, signal: AbortSignal.timeout(timeoutMs) });

  /** Tell the app; network errors are retried (a report, not slicing). */
  async function report(app, id, body, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        const res = await api(app, `/api/slicer/queue/${encodeURIComponent(id)}`, {
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

  /** kind "studio": this PC was the problem (network, no Bambu Studio); "model": the model or its output was. */
  async function failSlice(app, item, tag, text, kind = "studio") {
    const r = await report(app, item.id, { state: "failed", error: text, kind });
    warn(`x ${tag}: ${text}`);
    if (!r.ok) warn(`! ${tag}: could not tell ${app} (${r.status || "network"}: ${r.error})`);
  }

  /** The sliced file to the app, retried on network errors only (an answer from the app is final). */
  async function upload(app, url, bytes, ms) {
    for (let i = 1; ; i++) {
      try {
        return await fetch(url, {
          method: "POST", body: bytes, signal: AbortSignal.timeout(TRANSFER_MS),
          headers: { ...auth, "content-type": "model/3mf", "x-file-md5": md5(bytes), "x-slice-ms": String(Math.max(0, Math.round(ms))) },
        });
      } catch (e) {
        if (i >= 2) throw e;
        await clock.sleep(2_000);
      }
    }
  }

  async function runSlice(app, item) {
    const tag = `slice ${item.id}`;
    const took = await report(app, item.id, { state: "slicing" });
    if (!took.ok) {
      if (took.status !== 409) warn(`! ${tag}: could not take it from ${app} (${took.status || "network"}: ${took.error})`);
      return;
    }
    // "alive" every 45 s while this PC works on it: the app fails a slice that goes quiet (this bridge was closed).
    const alive = setInterval(() => void report(app, item.id, { state: "alive" }, 1), SLICE_ALIVE_MS);
    try {
      await work(app, item, tag);
    } finally {
      clearInterval(alive);
    }
  }

  async function work(app, item, tag) {
    log(`> ${tag} ${item.sourceName} ${item.material} ${item.color} ${item.mode === "project" ? "project settings" : `${item.quality}, infill ${item.infillPct}%, supports ${item.supports}`} (${app})`);

    // 1. The model, from the app the slice came from.
    const src = sliceUrl(app, item.sourceUrl, "source");
    const dst = sliceUrl(app, item.resultUrl, "result");
    if (!src || !dst) return failSlice(app, item, tag, "The slice has no download link from this app");
    let bytes;
    try {
      const res = await fetch(src, { headers: auth, signal: AbortSignal.timeout(TRANSFER_MS) });
      if (!res.ok) return failSlice(app, item, tag, `Could not download the model (the app answered ${res.status})`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_SLICE_BYTES) return failSlice(app, item, tag, "The model file is larger than 50 MB", "model");
      bytes = Buffer.from(await res.arrayBuffer());
      const want = (res.headers.get("x-file-md5") ?? "").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(want) || want !== md5(bytes)) return failSlice(app, item, tag, "The model changed on the way (checksum mismatch)");
    } catch {
      return failSlice(app, item, tag, "Could not download the model");
    }
    if (bytes.length > MAX_SLICE_BYTES) return failSlice(app, item, tag, "The model file is larger than 50 MB", "model");
    if (item.size && item.size !== bytes.length) return failSlice(app, item, tag, "The model is not the file the slice was asked for", "model");

    // 2. Slice it here.
    let out;
    try {
      out = await slice({
        bytes, fileName: item.sourceName, mode: item.mode, material: item.material, color: item.color, quality: item.quality,
        infillPct: item.infillPct, supports: item.supports,
      });
    } catch (e) {
      warn(`! ${tag}: ${e?.stack ?? e}`); // the details stay in this PC's log: they may hold local paths
      return failSlice(app, item, tag, "The slicer hit an error on the studio PC");
    }
    if (!out.ok) return failSlice(app, item, tag, out.message, STUDIO_CODES.has(out.code) ? "studio" : "model");

    // 3. The sliced file back to the app, which checks it again and puts it on the order.
    let res;
    try {
      res = await upload(app, dst, out.bytes, out.ms ?? 0);
    } catch {
      return failSlice(app, item, tag, "Could not upload the sliced file to the app");
    }
    if (res.ok) {
      const p = out.info?.plates?.[0];
      log(`ok ${tag}: ${out.fileName} ${p?.weightG ?? "?"} g, ${minutes(p?.predictionSec)} print, sliced in ${((out.ms ?? 0) / 1000).toFixed(1)} s`);
      return;
    }
    const answer = (await res.text().catch(() => "")).slice(0, 200);
    // 409/413/422: the app refused the file or the slice is no longer running, and has recorded why itself (it fails
    // the slice on 413 too).
    if ([409, 413, 422].includes(res.status)) warn(`x ${tag}: ${app} refused the sliced file (${res.status}: ${answer})`);
    else await failSlice(app, item, tag, `The app did not take the sliced file (it answered ${res.status})`);
  }

  async function pollApp(app) {
    let res;
    try {
      res = await api(app, "/api/slicer/queue", { timeoutMs: 10_000 });
    } catch (e) {
      quiet.problem(`slice|${app}`, `! slicer: could not reach ${app} (${e.message})`);
      return null;
    }
    if (!res.ok) {
      const hint = res.status === 404 ? " (this app does not slice yet)" : res.status === 401 || res.status === 503 ? " (check PRINTER_BRIDGE_TOKEN)" : "";
      quiet.problem(`slice|${app}`, `! slicer: ${app} answered ${res.status}${hint}`);
      return null;
    }
    quiet.ok(`slice|${app}`, `ok slicer: ${app} answers again`);
    const q = await res.json().catch(() => ({}));
    return (Array.isArray(q.slices) ? q.slices : []).find((s) => s && typeof s.id === "string") ?? null;
  }

  /** One slice at a time: a poll while slicing does nothing. Returns the id of the slice it worked on, or null. */
  async function pollOnce() {
    if (busy) return null;
    busy = true;
    try {
      for (const app of apps) {
        const item = await pollApp(app);
        if (item) {
          await runSlice(app, item).catch((e) => warn(`! slice ${item.id} failed: ${e?.stack ?? e}`));
          return item.id;
        }
      }
      return null;
    } finally {
      busy = false;
    }
  }

  return {
    pollOnce,
    start() {
      const timer = setInterval(() => void pollOnce(), pollMs);
      void pollOnce();
      return () => clearInterval(timer);
    },
  };
}

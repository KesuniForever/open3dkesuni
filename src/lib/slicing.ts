// Slicing on the website. A person (or, through the dispatcher, the agent) picks an order's STL/OBJ, a printer and one
// of its AMS spools, the quality, infill and supports; the LAN bridge on the studio PC runs Bambu Studio's command line
// (scripts/bridge/slicer.mjs) and uploads the .gcode.3mf; the app checks it again and stores it as a design file on the
// order (uploadedBy "Bambu Studio (slicer)"). "Colours & print" then prints it like any sliced file, its AMS mapping
// preset to the picked spool. Nothing here prints or reaches a printer.
// Single colour only: an STL or OBJ has no colours. Multi-colour stays with 3MFs painted in Bambu Studio.
// Stale slices never run later: one not taken by the studio PC in 15 min fails, one slicing without an answer for 20 min
// fails. Same source and settings never slice twice at once (a UNIQUE index on the key); a finished one is reused.
import { createHash } from "node:crypto";
import * as store from "./store";
import type { Fail } from "./actions";
import { addAttachment } from "./files";
import { colorsCheckedNow, nameOf, normalizeHex } from "./colors";
import { pricingConfig, pricingFor, priceByWeight, toMaterial } from "./pricing";
import { isPersonName, ONLINE_MS } from "./printer/control";
import { printerName } from "./printer/actions";
import { autoPrintOn } from "./printer/autoprint";
import { AUTO_PRINT_META } from "./printer/autoprint-rules";
import { parse3mf } from "./threemf";
import {
  DEFAULT_INFILL_PCT, DEFAULT_QUALITY, MAX_SLICE_BYTES, QUALITY, SLICE_PICKUP_MS, SLICE_QUALITIES, SLICE_RUN_MS, SLICER_NAME, SUPPORT_MODES,
  sliceKey, slicedFileName, sliceOutputProblem, sliceSourceCheck,
} from "./slice-rules";
import type { Attachment, SliceJob, SliceJobState, SliceQuality } from "./types";

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });
const iso = (now: number) => new Date(now).toISOString();
const ID = /^[a-z0-9-]{1,32}$/;

/** The studio PC asked for slices within this time: its slicer is running. */
export const SLICER_SEEN_MS = 2 * 60_000;
export const MAX_ACTIVE_PER_ORDER = 3;
export const MAX_ACTIVE = 10;
/** The meta key of the "Agent may start prints" switch (set by a person). OFF or missing: the agent never slices. */
export { AUTO_PRINT_META };

const ACTIVE: SliceJobState[] = ["queued", "slicing"];
const isActive = (j: SliceJob) => ACTIVE.includes(j.state);
const logActor = (j: Pick<SliceJob, "actor">) => (j.actor === "agent" ? "agent" : "human") as "agent" | "human";

// ---------- the studio PC's slicer: seen when it last asked for slices (kept in memory) ----------

const seen = ((globalThis as unknown as { __kesuniSlicerSeen?: { at: number } }).__kesuniSlicerSeen ??= { at: 0 });
/** The bridge asked for slices (GET /api/slicer/queue): its Bambu Studio is there and it takes slices from this app. */
export const noteSlicerPoll = (now = Date.now()) => { seen.at = now; };
export const slicerStatus = (now = Date.now()): { seenAt: string | null; ready: boolean } =>
  ({ seenAt: seen.at ? iso(seen.at) : null, ready: seen.at > 0 && now - seen.at <= SLICER_SEEN_MS });
/** Tests only. */
export const resetSlicerSeen = () => { seen.at = 0; };

// ---------- expiry ----------

function finishFailed(j: SliceJob, error: string, now: number, failKind: NonNullable<SliceJob["failKind"]>): SliceJob {
  const job: SliceJob = { ...j, state: "failed", updatedAt: iso(now), error: error.slice(0, 300), failKind };
  store.updateSliceJob(job);
  store.addLog({ orderId: j.orderId, actor: logActor(j), tool: "slice_result", input: { jobId: j.id, file: j.sourceName }, ok: false,
    output: { error: job.error }, at: job.updatedAt });
  return job;
}

/**
 * Queued slices not taken in 15 min fail, and so do slices the studio PC stopped answering for (it says "alive" every
 * minute while it works on one: a bridge restarted mid-slice frees it within 3 min).
 */
export function expireStaleSlices(now = Date.now()): void {
  for (const j of store.listSliceJobs()) {
    if (j.state === "queued" && now - Date.parse(j.createdAt) > SLICE_PICKUP_MS) {
      finishFailed(j, "The studio PC did not take the slice within 15 min: is the bridge running with Bambu Studio?", now, "studio");
    } else if (j.state === "slicing" && now - Date.parse(j.updatedAt) > SLICE_RUN_MS) {
      finishFailed(j, "The studio PC stopped answering while slicing", now, "studio");
    }
  }
}

// ---------- asking for a slice ----------

export interface SliceRequest {
  orderId: unknown;
  attachmentId: unknown;
  printerId: unknown;
  /** The spool: global AMS tray (ams*4 + slot, 0-based), the same number as in amsMapping. `slot` is the same thing. */
  tray?: unknown;
  slot?: unknown;
  quality?: unknown;        // "standard" (default) | "fine" | "draft"
  infillPct?: unknown;      // 0..100, default the order's spec infill, else 20
  supports?: unknown;       // "auto" (default) | "off"
  by: unknown;              // the person's name ("agent" when actor is "agent")
  /** "person" (default; every route) or "agent" (the dispatcher, in code). */
  actor?: "person" | "agent";
  /** The dispatcher's reasons, stored on the job and in the log. */
  why?: string[];
}

export type SliceRequestResult =
  | { ok: true; job: SliceJob; warnings: string[]; reused?: "active" | "done" }
  | (Fail & { warnings?: string[] });

/** The newest slice with this key that is still running, or finished with its sliced file still on the order. */
function existing(key: string): { job: SliceJob; reused: "active" | "done" } | null {
  const same = store.listSliceJobs().filter((j) => j.key === key).reverse();
  const active = same.find(isActive);
  if (active) return { job: active, reused: "active" };
  const done = same.find((j) => j.state === "done" && j.resultAttachmentId && store.getAttachment(j.resultAttachmentId));
  return done ? { job: done, reused: "done" } : null;
}

/**
 * Ask the studio PC to slice one order file with one spool's material and colour. Synchronous (no await between the
 * checks and the insert): two requests can never both queue the same slice, and the UNIQUE index is the second guard.
 * The same source and settings return the slice already running or done (`reused`) instead of a new one.
 * A person: a name, the order before evidence (CREATED, PLAN_CHOSEN, IN_PRODUCTION); unchecked colours or a quiet
 * printer are warnings. The agent ("agent", only from code): the "Agent may start prints" switch is on, the order is in
 * production (PLAN_CHOSEN or IN_PRODUCTION), the printer reports and a person confirmed its colours.
 */
export function requestSlice(input: SliceRequest, now = Date.now()): SliceRequestResult {
  const actor = input.actor === "agent" ? "agent" : "person";
  const by = typeof input.by === "string" ? input.by.trim() : "";
  if (actor === "person" && !isPersonName(by)) return fail(400, "A person's name is required");
  if (actor === "agent" && !autoPrintOn()) {
    return fail(409, "Agent prints are off: only a person can ask for a slice");
  }
  const orderId = typeof input.orderId === "string" ? input.orderId : "";
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const statuses = actor === "agent" ? ["PLAN_CHOSEN", "IN_PRODUCTION"] : ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];
  if (!statuses.includes(order.status)) return fail(409, `Order is ${order.status}; nothing to slice now`);
  const a = typeof input.attachmentId === "string" ? store.getAttachment(input.attachmentId) : undefined;
  if (!a || a.orderId !== order.id) return fail(404, "File not found");
  const source = sliceSourceCheck(a);
  if (!source.ok) return fail(400, "This file cannot be sliced here", [source.reason]);

  const printerId = typeof input.printerId === "string" ? input.printerId : "";
  if (!ID.test(printerId)) return fail(400, "Invalid printer id");
  const printer = store.getPrinter(printerId);
  if (!printer) return fail(404, "Printer not found");
  const rawTray = input.tray ?? input.slot;
  const tray = typeof rawTray === "number" ? rawTray : typeof rawTray === "string" && rawTray.trim() !== "" ? Number(rawTray) : Number.NaN;
  if (!Number.isInteger(tray) || tray < 0 || tray > 15) return fail(400, "Pick an AMS spool (tray 0 to 15)");
  const spool = printer.snapshot?.ams?.trays.find((x) => x.ams * 4 + x.slot === tray);
  const slotName = `slot ${(tray & 3) + 1}`;
  if (!spool || spool.empty || !spool.type) return fail(409, "The spool cannot be used", [`${printerName(printerId)} ${slotName} is empty`]);
  const material = toMaterial(spool.type);
  if (!material) return fail(409, "The spool cannot be used", [`${printerName(printerId)} ${slotName} holds ${spool.type}: only PLA and PETG are sliced here`]);
  const color = normalizeHex(spool.color ?? "");
  if (!color) return fail(409, "The spool cannot be used", [`${printerName(printerId)} ${slotName} reports no colour`]);

  const quality = (input.quality ?? DEFAULT_QUALITY) as SliceQuality;
  if (!SLICE_QUALITIES.includes(quality)) return fail(400, "Quality must be standard, fine or draft");
  const specInfill = order.spec?.infillPct;
  const infillRaw = input.infillPct ?? (Number.isInteger(specInfill) ? specInfill : DEFAULT_INFILL_PCT);
  const infillPct = typeof infillRaw === "string" && infillRaw.trim() !== "" ? Number(infillRaw) : infillRaw;
  if (typeof infillPct !== "number" || !Number.isInteger(infillPct) || infillPct < 0 || infillPct > 100) return fail(400, "Infill must be a whole number from 0 to 100");
  const supports = (input.supports ?? "auto") as SliceJob["supports"];
  if (!SUPPORT_MODES.includes(supports)) return fail(400, "Supports must be auto or off");

  const warnings: string[] = [];
  const checked = colorsCheckedNow(printer);
  const online = Boolean(printer.lastSeen) && now - Date.parse(printer.lastSeen!) <= ONLINE_MS;
  if (actor === "agent") {
    const reasons: string[] = [];
    if (!checked) reasons.push(`Nobody confirmed the colours on ${printerName(printerId)}`);
    if (!online) reasons.push(`${printerName(printerId)} has not reported in the last 2 min`);
    if (reasons.length) return fail(409, "The agent cannot ask for this slice", reasons);
  } else {
    if (!checked && !spool.bambu) warnings.push(`Nobody confirmed the colours on ${printerName(printerId)}: check the spool is really ${nameOf(color)}`);
    if (!online) warnings.push(`${printerName(printerId)} has not reported in the last 2 min: its spools may have changed`);
  }

  expireStaleSlices(now);
  const base = { attachmentId: a.id, mode: source.mode, material, color, quality, infillPct, supports };
  const key = sliceKey(base);
  const before = existing(key);
  if (before) return { ok: true, job: before.job, warnings, reused: before.reused };
  const active = store.listSliceJobs().filter(isActive);
  if (active.filter((j) => j.orderId === order.id).length >= MAX_ACTIVE_PER_ORDER) return fail(429, `At most ${MAX_ACTIVE_PER_ORDER} slices can wait per order`);
  if (active.length >= MAX_ACTIVE) return fail(429, `At most ${MAX_ACTIVE} slices can wait on the studio PC`);

  const at = iso(now);
  const job: SliceJob = {
    id: store.nextSliceJobId(), orderId: order.id, sourceName: a.filename, printerId, tray, ...base, key, state: "queued", actor,
    by: actor === "agent" ? "agent" : by, ...(input.why?.length ? { why: input.why.map(String).slice(0, 10) } : {}), createdAt: at, updatedAt: at,
  };
  try {
    store.insertSliceJob(job);
  } catch {
    // Another request queued the same slice between our check and this insert (another process): use that one.
    const again = existing(key);
    if (again) return { ok: true, job: again.job, warnings, reused: again.reused };
    return fail(409, "The same slice is already waiting");
  }
  store.addLog({
    orderId: order.id, actor: logActor(job), tool: "slice_request", ok: true, at,
    input: { attachmentId: a.id, file: a.filename, printerId, tray, material, color, quality, infillPct, supports, mode: source.mode, by: job.by, ...(job.why ? { why: job.why } : {}) },
    output: { jobId: job.id, printer: printerName(printerId), warnings },
  });
  return { ok: true, job, warnings };
}

/**
 * A person cancels a slice that is waiting or running. The bridge's result for it is then refused. why "switch": the
 * person turned agent prints off (the agent may ask for it again later); "person": they cancelled it (it may not).
 */
export function cancelSliceJob(id: string, by: unknown, now = Date.now(), why: "person" | "switch" = "person"): { ok: true; job: SliceJob } | Fail {
  const j = store.getSliceJob(id);
  if (!j) return fail(404, "Slice not found");
  if (!isPersonName(by)) return fail(400, "A person's name is required");
  if (!isActive(j)) return fail(409, `The slice is ${j.state}`);
  const name = (by as string).trim();
  const job: SliceJob = { ...j, state: "cancelled", updatedAt: iso(now), error: `Cancelled by ${name}`, failKind: why };
  store.updateSliceJob(job);
  store.addLog({ orderId: j.orderId, actor: "human", tool: "slice_cancel", input: { jobId: j.id, file: j.sourceName, by: name }, ok: true, output: {}, at: job.updatedAt });
  return { ok: true, job };
}

/** An order's slices, newest first (stale ones expired first). */
export function orderSlices(orderId: string, now = Date.now()): SliceJob[] {
  expireStaleSlices(now);
  return store.listSliceJobs({ orderId }).reverse();
}

// ---------- the bridge's side ----------

export interface SliceQueueItem {
  type: "slice"; id: string; orderId: string; mode: SliceJob["mode"];
  /** The source's file name (cleaned on upload); the bridge cleans it again before the slicer sees it. */
  sourceName: string; size: number;
  material: SliceJob["material"]; color: string; quality: SliceQuality; infillPct: number; supports: SliceJob["supports"];
  createdAt: string; expiresAt: string;
  /** GET (bearer) the source after taking the slice; POST (bearer) the sliced .gcode.3mf there. */
  sourceUrl: string; resultUrl: string;
}

/** What the studio PC should slice now, oldest first. Expired slices are never listed. Records that the slicer asked. */
export function sliceQueue(now = Date.now()): SliceQueueItem[] {
  noteSlicerPoll(now);
  expireStaleSlices(now);
  return store.listSliceJobs().filter((j) => j.state === "queued").map((j): SliceQueueItem => ({
    type: "slice", id: j.id, orderId: j.orderId, mode: j.mode, sourceName: j.sourceName, size: store.getAttachment(j.attachmentId)?.size ?? 0,
    material: j.material, color: j.color, quality: j.quality, infillPct: j.infillPct, supports: j.supports, createdAt: j.createdAt,
    expiresAt: iso(Date.parse(j.createdAt) + SLICE_PICKUP_MS),
    sourceUrl: `/api/slicer/jobs/${encodeURIComponent(j.id)}/source`, resultUrl: `/api/slicer/jobs/${encodeURIComponent(j.id)}/result`,
  }));
}

const NEXT: Record<SliceJobState, SliceJobState[]> = { queued: ["slicing", "failed"], slicing: ["failed"], done: [], failed: [], cancelled: [] };

/**
 * The bridge takes a slice (queued -> slicing: works once, so two studio PCs never slice the same job), says it is still
 * working on it ("alive", every minute: a slice without it fails after SLICE_RUN_MS), or reports that it failed: kind
 * "studio" when the studio PC was the problem (download, upload, no Bambu Studio), else the model was (the agent never
 * asks for that slice again). "done" comes only with the sliced file (storeSliceResult).
 */
export function updateSliceItem(id: string, input: { state: unknown; error?: unknown; kind?: unknown }, now = Date.now()): { ok: true; job: SliceJob } | Fail {
  expireStaleSlices(now);
  const j = store.getSliceJob(id);
  if (!j) return fail(404, "Slice not found");
  if (input.state === "alive") {
    if (j.state !== "slicing") return fail(409, `The slice is ${j.state}`);
    const job: SliceJob = { ...j, updatedAt: iso(now) };
    store.updateSliceJob(job);
    return { ok: true, job };
  }
  const state = typeof input.state === "string" ? (input.state as SliceJobState) : ("" as SliceJobState);
  if (!NEXT[j.state].includes(state)) return fail(409, `The slice is ${j.state}; it cannot become ${state || "that"}`);
  if (state === "failed") {
    const error = typeof input.error === "string" && input.error.trim() ? input.error.trim() : "The studio PC could not slice it";
    return { ok: true, job: finishFailed(j, error, now, input.kind === "studio" ? "studio" : "model") };
  }
  const job: SliceJob = { ...j, state, updatedAt: iso(now) };
  store.updateSliceJob(job);
  return { ok: true, job };
}

/** The source file of a slice, for the bridge: only while it is slicing (taken). */
export function sliceJobSource(id: string): { ok: true; job: SliceJob; attachment: Attachment } | Fail {
  const j = store.getSliceJob(id);
  if (!j) return fail(404, "Slice not found");
  if (j.state !== "slicing") return fail(409, `The slice is ${j.state}`);
  const attachment = store.getAttachment(j.attachmentId);
  if (!attachment) return fail(404, "File not found");
  return { ok: true, job: j, attachment };
}

export const md5 = (bytes: Uint8Array): string => createHash("md5").update(bytes).digest("hex");

/** Price by weight of a sliced plate (one unit), as the order's official price would be: grams x the material's price per gram. */
export function slicePrice(weightG: number | null, material: SliceJob["material"]): number | null {
  if (!weightG || weightG <= 0) return null;
  const r = priceByWeight(weightG, 1, "single", pricingFor(pricingConfig(), material));
  return r.ok ? r.price.unitPriceIdr : null;
}

/**
 * The bridge uploads the sliced file. Checked again here (sliced, A1, 0.4 mm, textured plate, one filament of the asked
 * material and colour), stored as a design file on the order, and the slice is done. A bad file fails the slice.
 */
export async function storeSliceResult(id: string, bytes: Uint8Array, meta: { sliceMs?: unknown } = {}, now = Date.now()):
  Promise<{ ok: true; job: SliceJob; attachment: Attachment } | Fail> {
  expireStaleSlices(now);
  const j = store.getSliceJob(id);
  if (!j) return fail(404, "Slice not found");
  if (j.state !== "slicing") return fail(409, `The slice is ${j.state}`);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SLICE_BYTES) {
    const error = bytes.byteLength ? "The sliced file is larger than 50 MB" : "The sliced file is empty";
    finishFailed(j, error, now, "model");
    return fail(bytes.byteLength ? 413 : 400, error);
  }
  const info = parse3mf(bytes);
  const problem = sliceOutputProblem(info, j);
  if (problem) {
    finishFailed(j, problem, now, "model");
    return fail(422, problem);
  }
  const filename = slicedFileName(j.sourceName, j.material, nameOf(j.color), j.mode === "mesh" ? j.quality : null);
  const up = await addAttachment(j.orderId, { kind: "design", filename, bytes, uploadedBy: SLICER_NAME });
  if (!up.ok) {
    if (store.getSliceJob(id)?.state === "slicing") finishFailed(j, up.reasons?.length ? up.reasons.join("; ") : up.error, now, "studio");
    return up;
  }
  const at = iso(Date.now() > now ? Date.now() : now);
  const cur = store.getSliceJob(id)!;
  const plate = info.plates[0];
  const sliceMs = typeof meta.sliceMs === "number" && Number.isFinite(meta.sliceMs) && meta.sliceMs >= 0 ? Math.round(meta.sliceMs) : undefined;
  const result = { predictionSec: plate.predictionSec, weightG: plate.weightG, priceIdr: slicePrice(plate.weightG, j.material), ...(sliceMs !== undefined ? { sliceMs } : {}) };
  if (cur.state !== "slicing") {
    // Cancelled (or expired) while the file was being stored: it stays on the order, the slice keeps its state.
    store.updateSliceJob({ ...cur, resultAttachmentId: up.attachment.id, result });
    return fail(409, `The slice is ${cur.state}; the sliced file was kept on the order`);
  }
  const job: SliceJob = { ...cur, state: "done", updatedAt: at, resultAttachmentId: up.attachment.id, result };
  store.updateSliceJob(job);
  store.addLog({
    orderId: j.orderId, actor: logActor(j), tool: "slice_result", ok: true, at,
    input: { jobId: j.id, file: j.sourceName },
    output: { attachmentId: up.attachment.id, file: up.attachment.filename, weightG: plate.weightG, minutes: plate.predictionSec ? Math.round(plate.predictionSec / 60) : null,
      priceIdr: result.priceIdr, material: j.material, color: j.color, quality: j.mode === "mesh" ? QUALITY[j.quality].label : "project settings" },
  });
  return { ok: true, job, attachment: up.attachment };
}

/** The app refused the sliced file before reading it (larger than 50 MB): the slice fails at once, not after the expiry. */
export function refuseSliceResult(id: string, error: string, now = Date.now()): void {
  const j = store.getSliceJob(id);
  if (j?.state === "slicing") finishFailed(j, error, now, "model");
}

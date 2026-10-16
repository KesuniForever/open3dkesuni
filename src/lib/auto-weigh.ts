// The customer's own design, weighed and priced without a person at Kesuni. The order form (POST /api/c) may send one
// model file with the order: it is checked here (really an STL or OBJ, at most 25 MB; never a 3MF project, which brings
// its own printer settings and G-code), stored as a design file on the order (uploadedBy CUSTOMER_UPLOAD_BY) and
// weighed by an automatic slice on the studio PC (src/lib/slicing.ts, actor "system"): the studio's own presets,
// standard quality, default infill, supports auto, on a spool of the order's material that a printer reported in the
// last 2 min. Nothing prints: the agent never prints that slice's file. Its plate weight becomes the order's grams per
// unit (by "slicer") and the Chief prices by weight exactly as with a person's grams; people still approve big orders,
// confirm beds, start prints and check quality, and the customer still agrees before paying. When the weighing cannot
// start or fails, the order waits for a person: logged, and the Chief asks the operator for the grams as before. The
// customer never gets the file back.
import * as store from "./store";
import { addAttachment } from "./files";
import { autoGramsFromSlice, autoWeighState, requestSlice, type AutoGrams } from "./slicing";
import { AUTO_WEIGH_BY, DEFAULT_QUALITY, sliceSourceCheck } from "./slice-rules";
import { CUSTOMER_UPLOAD_BY, customerDesignProblem } from "./file-rules";
import { deltaE, normalizeHex } from "./colors";
import { orderMaterial, toMaterial } from "./pricing";
import { ONLINE_MS, slotLabel } from "./printer/control";
import { printerName } from "./printer/actions";
import { wakeChief } from "./agent/chief";
import type { Attachment, Order, SliceJob } from "./types";

const iso = (now: number) => new Date(now).toISOString();
const extOf = (name: string) => /\.[^./\\]+$/.exec(name.toLowerCase())?.[0] ?? "";

// ---------- is it really that kind of file ----------

const BAD_STL = "This STL file is broken or empty. Export it again and send it.";
const BAD_OBJ = "This OBJ file is broken or empty. Export it again and send it.";

/** A binary STL: 80-byte header, triangle count, 50 bytes per triangle (a few stray bytes at the end are fine). */
function binaryStl(b: Buffer): boolean {
  if (b.length < 84 + 50) return false;
  const n = b.readUInt32LE(80);
  const want = 84 + n * 50;
  return n > 0 && want <= b.length && b.length - want < 1024;
}

/** Text only: no NUL byte (a binary file renamed to .stl or .obj has them). */
const isText = (b: Buffer) => b.indexOf(0) === -1;

function stlProblem(b: Buffer): string | null {
  if (binaryStl(b)) return null;
  // An ASCII STL: "solid", at least one facet with its vertices, "endsolid".
  const head = b.subarray(0, 512).toString("latin1").trimStart().toLowerCase();
  if (!head.startsWith("solid") || !isText(b) || !b.includes("facet") || !b.includes("vertex") || !b.includes("endsolid")) return BAD_STL;
  return null;
}

function objProblem(b: Buffer): string | null {
  // Vertices ("v x y z") and faces ("f a b c"), one per line.
  const line = (s: string) => b.subarray(0, s.length).toString("latin1") === s || b.includes(`\n${s}`);
  if (!isText(b) || !(line("v ") || line("v\t")) || !(line("f ") || line("f\t"))) return BAD_OBJ;
  return null;
}

/**
 * Why the customer's design is refused, or null. The name and size first (src/lib/file-rules.ts, the form checks the
 * same: STL or OBJ only), then the content: a renamed or broken file. Texts are English and fixed (no values), so pages
 * translate them.
 */
export function customerDesignContentProblem(name: string, bytes: Uint8Array): string | null {
  const basic = customerDesignProblem(name, bytes.byteLength);
  if (basic) return basic;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return extOf(name) === ".obj" ? objProblem(b) : stlProblem(b);
}

// ---------- the spool to weigh it with ----------

/**
 * A printer that reported in the last 2 min with a spool of the order's material (PLA when none was chosen), the
 * customer's colour first (nearest), then any colour: the weight hardly depends on the colour. Read-only.
 */
export function pricingSpool(order: Pick<Order, "material" | "spec" | "preferredColors">, now = Date.now()):
  { ok: true; printerId: string; tray: number } | { ok: false; reason: string } {
  const material = orderMaterial(order) ?? "PLA";
  const wants = (order.preferredColors ?? []).filter((c) => c.type === material).map((c) => normalizeHex(c.color)).filter((c): c is string => Boolean(c));
  const spools = store.listPrinters()
    .filter((p) => p.lastSeen && now - Date.parse(p.lastSeen) <= ONLINE_MS)
    .flatMap((p) => (p.snapshot?.ams?.trays ?? [])
      .filter((t) => !t.empty && toMaterial(t.type) === material && normalizeHex(t.color ?? ""))
      .map((t) => {
        const color = normalizeHex(t.color ?? "")!;
        return { printerId: p.id, tray: t.ams * 4 + t.slot, d: wants.length ? Math.min(...wants.map((w) => deltaE(w, color))) : 0 };
      }))
    .sort((a, b) => a.d - b.d || a.printerId.localeCompare(b.printerId) || a.tray - b.tray);
  if (!spools.length) return { ok: false, reason: `No printer reported in the last 2 min with a ${material} spool loaded` };
  return { ok: true, printerId: spools[0].printerId, tray: spools[0].tray };
}

// ---------- weighing ----------

export type WeighStart = { ok: true; job: SliceJob; grams?: AutoGrams } | { ok: false; reasons: string[] };

/**
 * Ask the studio PC to weigh the customer's design (an automatic slice for the price only). Never fails the order:
 * when no printer reports the material or the slicer is quiet, it is logged (auto_weigh) and a person handles it.
 */
export function startAutoWeigh(orderId: string, attachmentId: string, now = Date.now()): WeighStart {
  const order = store.getOrder(orderId);
  if (!order) return { ok: false, reasons: ["Order not found"] };
  const a = store.getAttachment(attachmentId);
  // Only a mesh, sliced with the studio's presets: a 3MF project would keep its own settings (and G-code).
  const mesh = a ? sliceSourceCheck(a) : null;
  if (!mesh?.ok || mesh.mode !== "mesh") {
    const why = { error: "Not weighed automatically", reasons: ["Only an STL or OBJ is weighed automatically: a person enters the grams"] };
    store.addLog({ orderId, actor: "human", tool: "auto_weigh", ok: false, at: iso(now), input: { attachmentId, file: a?.filename ?? "" }, output: why });
    return { ok: false, reasons: why.reasons };
  }
  const spool = pricingSpool(order, now);
  const r = spool.ok
    ? requestSlice({
      orderId, attachmentId, printerId: spool.printerId, tray: spool.tray, quality: DEFAULT_QUALITY, supports: "auto", by: AUTO_WEIGH_BY, actor: "system",
      why: [`${orderId}: the customer sent ${a?.filename ?? "a design"}; weighing it for the price only`, `Spool: ${printerName(spool.printerId)} ${slotLabel(spool.tray)}`],
    }, now)
    : null;
  // Why it did not start. A person's slice of this very file with the same settings: its grams are a person's to enter.
  const why: { error: string; reasons: string[] } | null = !spool.ok ? { error: "No spool to weigh it with", reasons: [spool.reason] }
    : !r || !r.ok ? { error: r?.error ?? "Not asked", reasons: r?.reasons?.length ? r.reasons : [r?.error ?? "Not asked"] }
      : r.job.actor !== "system" ? { error: "Not asked", reasons: ["A person already slices this file: a person enters the grams"] }
        : null;
  if (why || !r || !r.ok) {
    const reasons = why?.reasons ?? [];
    store.addLog({ orderId, actor: "human", tool: "auto_weigh", ok: false, at: iso(now), input: { attachmentId, file: a?.filename ?? "" }, output: why ?? {} });
    return { ok: false, reasons };
  }
  // The same file and settings were weighed already: that weight is the answer.
  return { ok: true, job: r.job, ...(r.reused === "done" ? { grams: autoGramsFromSlice(r.job) } : {}) };
}

export interface CustomerDesign { stored: boolean; attachment?: Attachment; weighing?: WeighStart }

/**
 * The order was just created from the order form with a design (checked with customerDesignContentProblem): store it,
 * then start weighing it. A file that cannot be stored (refused, or the disk failed) leaves the order as it is: logged,
 * and the Chief asks the operator; the customer can send it on WhatsApp. Never throws: the order exists already.
 */
export async function addCustomerDesign(orderId: string, design: { filename: string; bytes: Uint8Array }): Promise<CustomerDesign> {
  const up = await addAttachment(orderId, { kind: "design", filename: design.filename, bytes: design.bytes, uploadedBy: CUSTOMER_UPLOAD_BY })
    // No error text in the log: a disk error names the studio PC's folders.
    .catch(() => ({ ok: false as const, error: "The design could not be stored", reasons: ["Saving the file failed on the studio PC"] }));
  store.addLog({
    orderId, actor: "human", tool: "customer_design", ok: up.ok, at: new Date().toISOString(),
    input: { file: up.ok ? up.attachment.filename : "", size: design.bytes.byteLength },
    output: up.ok ? { attachmentId: up.attachment.id } : { error: up.error, reasons: up.reasons },
  });
  if (!up.ok) return { stored: false };
  return { stored: true, attachment: up.attachment, weighing: startAutoWeigh(orderId, up.attachment.id) };
}

/** What the Chief is told when a customer's order arrives, with or without their own design. */
export function newOrderWake(design: CustomerDesign | null): string {
  const never = "Never use numbers from the customer's note.";
  if (design?.weighing?.ok && design.weighing.grams?.ok) {
    return `A customer just placed this order through the order form with their own design. The studio's slicer already weighed it: ${design.weighing.grams.gramsPerUnit} g per unit (slicerGrams). Price it by weight and continue. ${never}`;
  }
  if (design?.weighing?.ok) {
    return "A customer just placed this order through the order form with their own design. The studio's slicer is weighing it " +
      "automatically: wait for slicerGrams (you are woken when they arrive) and do not ask the operator for grams. " + never;
  }
  const lead = design?.stored
    ? "A customer just placed this order through the order form with their own design, but the automatic weighing could not start " +
      `(${(design.weighing && !design.weighing.ok ? design.weighing.reasons : []).join("; ") || "unknown"}). Prepare it: `
    : "A customer just placed this order through the order form. Prepare it: ";
  return `${lead}if a person at Kesuni has not entered grams per unit from the slicer yet (slicerGrams), ask the operator for them. ${never}`;
}

/**
 * After the studio PC answered an automatic weighing (POST /api/slicer/jobs/<id>/result, or a failure on its queue):
 * log it once (auto_weigh_result) and wake the Chief with what to do: price it by weight, or ask the operator for the
 * grams. Anything else (a person's slice, the agent's, one still running, one already handled) does nothing.
 */
export function afterAutoWeigh(jobId: string, now = Date.now()): boolean {
  const j = store.getSliceJob(jobId);
  if (!j || j.actor !== "system" || j.state === "queued" || j.state === "slicing") return false;
  const seen = store.listLog(j.orderId).some((e) => e.tool === "auto_weigh_result" && (e.input as { jobId?: string })?.jobId === j.id);
  if (seen) return false;
  const order = store.getOrder(j.orderId);
  const g = order?.slicerGrams;
  const fromThis = j.state === "done" && g?.by === "slicer" && g.source.startsWith(`slicer (automatic), ${j.id},`);
  const error = j.state === "done" ? (fromThis ? undefined : "Its grams were not used") : j.error ?? `The slice is ${j.state}`;
  store.addLog({
    orderId: j.orderId, actor: "human", tool: "auto_weigh_result", ok: fromThis, at: iso(now),
    input: { jobId: j.id, file: j.sourceName }, output: fromThis ? { gramsPerUnit: g!.gramsPerUnit } : { state: j.state, error },
  });
  if (order?.status !== "CREATED") return false;
  if (fromThis) {
    return wakeChief(j.orderId, `The studio's slicer weighed the customer's design: ${g!.gramsPerUnit} g per unit, single colour (slicerGrams). Price it by weight and continue.`);
  }
  if (g) return false; // a person entered grams already: nothing waits on this weighing
  return wakeChief(j.orderId, j.state === "done"
    ? "The automatic weighing of the customer's design finished but gave no usable grams. Ask the operator for the grams per unit from the slicer."
    : `The automatic weighing of the customer's design did not finish (${j.error ?? j.state}). Ask the operator for the grams per unit from the slicer.`);
}

// ---------- what the customer sees ----------

export type CustomerDesignStatus = { state: "weighing" } | { state: "weighed"; gramsPerPiece: number } | { state: "check" };

/**
 * While the order waits for its price (CREATED) and the customer sent their own design: being weighed, weighed (grams
 * per piece only: no cost, no margin, no file), or Kesuni checks the file. Null otherwise.
 */
export function customerDesignStatus(order: Order, now = Date.now()): CustomerDesignStatus | null {
  if (order.status !== "CREATED") return null;
  if (!store.listAttachments(order.id).some((a) => a.kind === "design" && a.uploadedBy === CUSTOMER_UPLOAD_BY)) return null;
  if (order.slicerGrams) return { state: "weighed", gramsPerPiece: order.slicerGrams.gramsPerUnit };
  return autoWeighState(order.id, now)?.state === "weighing" ? { state: "weighing" } : { state: "check" };
}

// Order attachments: design files for the operator's slicer, customer reference images, QC photos.
// Bytes live behind a FileStore (local disk now; swap for online storage when the app is hosted).
// Stored names are the attachment id + extension, never the uploaded file name, so a file name
// can never point outside the folder. Files are never sent to the LLM; the agent only sees metadata.
// Only a person removes a file (removeAttachment): the Chief has no tool for it.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as store from "./store";
import type { Fail } from "./actions";
import { parse3mf } from "./threemf";
import { isPersonName, ONLINE_MS } from "./printer/control";
import { expireStale } from "./printer/jobs";
import { qcPhotoLocked } from "./file-rules";
import { sliceHoldsSource } from "./slice-rules";
import type { Attachment, Evidence, PrintJob } from "./types";

export const MAX_BYTES = 50 * 1024 * 1024;

const RULES: Record<Attachment["kind"], { exts: string[]; label: string }> = {
  design: { exts: [".stl", ".3mf", ".step", ".stp", ".obj"], label: "design file (STL, 3MF, STEP, OBJ)" },
  reference: { exts: [".jpg", ".jpeg", ".png", ".webp"], label: "reference image (JPG, PNG, WEBP)" },
  qc_photo: { exts: [".jpg", ".jpeg", ".png", ".webp"], label: "QC photo (JPG, PNG, WEBP)" },
};
const MIME: Record<string, string> = {
  ".stl": "model/stl", ".3mf": "model/3mf", ".step": "model/step", ".stp": "model/step", ".obj": "model/obj",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
};

export interface FileStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Delete the bytes. A key with nothing stored under it is not an error. */
  remove(key: string): Promise<void>;
}

function localStore(): FileStore {
  const dir = process.env.KESUNI_FILES_DIR || path.join(process.cwd(), "data", "local", "files");
  return {
    async put(key, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, key), bytes);
    },
    async get(key) {
      return new Uint8Array(await readFile(path.join(dir, key)));
    },
    async remove(key) {
      // Keys are "<attachment id><ext>": never a path, so a removal cannot reach outside the folder.
      if (!key || path.basename(key) !== key) throw new Error(`Not a file key: ${key}`);
      await rm(path.join(dir, key), { force: true });
    },
  };
}

// Only a store put in by tests lives on globalThis. The disk store is made on each call (it holds nothing but the
// folder), so after a dev server's hot reload it is always the current code's, with every method of FileStore.
const g = globalThis as unknown as { __kesuniFileStore?: FileStore };
export const fileStore = (): FileStore => g.__kesuniFileStore ?? localStore();
/** Tests only. */
export const setFileStore = (fs: FileStore | undefined) => { g.__kesuniFileStore = fs; };

const fail = (status: number, error: string, reasons?: string[]): Fail => ({ ok: false, status, error, reasons });

/** Images must really be images (magic bytes), not a renamed file. */
function looksLikeImage(ext: string, b: Uint8Array): boolean {
  if (ext === ".png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ext === ".jpg" || ext === ".jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === ".webp") return String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP";
  return false;
}

const cleanName = (name: string) =>
  path.basename(name).replace(/[^\w.\- ()]/g, "_").replace(/\s+/g, " ").trim().slice(-120) || "file";

export async function addAttachment(orderId: string, input: {
  kind: string; filename: string; bytes: Uint8Array; uploadedBy: string;
}): Promise<{ ok: true; attachment: Attachment; evidence?: Evidence } | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const kind = input.kind as Attachment["kind"];
  const rule = RULES[kind];
  if (!rule) return fail(400, "kind must be design, reference or qc_photo");
  if (!input.uploadedBy.trim()) return fail(400, "Who uploaded it is required");
  const filename = cleanName(input.filename);
  const ext = path.extname(filename).toLowerCase();
  const r: string[] = [];
  if (!rule.exts.includes(ext)) r.push(`Expected a ${rule.label}, got "${ext || "no extension"}"`);
  if (input.bytes.byteLength === 0) r.push("File is empty");
  if (input.bytes.byteLength > MAX_BYTES) r.push(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  if (!r.length && kind !== "design" && !looksLikeImage(ext, input.bytes)) r.push("File content is not a real image");
  if (kind === "qc_photo" && !["IN_PRODUCTION", "EVIDENCE_SUBMITTED"].includes(order.status)) {
    r.push(`Order is ${order.status}; QC photos belong to an order in production`);
  }
  if (r.length) return fail(400, "File refused", r);

  const id = `F-${randomUUID().slice(0, 8)}`;
  const storageKey = `${id}${ext}`;
  await fileStore().put(storageKey, input.bytes);
  const attachment: Attachment = {
    id, orderId, kind, filename, size: input.bytes.byteLength, mime: MIME[ext],
    uploadedBy: input.uploadedBy.trim(), at: new Date().toISOString(), storageKey,
    // A Bambu Studio file: which plates can print, their time, weight and colours (read in memory, never unpacked to disk).
    ...(ext === ".3mf" ? { parsed3mf: parse3mf(input.bytes) } : {}),
  };
  store.saveAttachment(attachment);

  // A QC photo is also photo evidence (it does not replace the QC result itself).
  if (kind === "qc_photo") {
    const evidence: Evidence = {
      id: store.nextEvidenceId(), orderId, kind: "photo", note: `QC photo: ${filename}`, label: "manual",
      at: attachment.at, attachmentId: id,
    };
    store.addEvidence(evidence);
    return { ok: true, attachment, evidence };
  }
  return { ok: true, attachment };
}

export async function readAttachment(id: string): Promise<{ attachment: Attachment; bytes: Uint8Array } | undefined> {
  const attachment = store.getAttachment(id);
  if (!attachment) return undefined;
  return { attachment, bytes: await fileStore().get(attachment.storageKey) };
}

/**
 * Does this print job still hold its file? Queued, uploading and sent jobs do (the bridge downloads the file, or the
 * printer is about to start it; expireStale ends them when they go stale). A printing job does only while the print is
 * really on the printer: the printer reports in the last 2 min, is preparing, printing or paused, and this job is the
 * one it is printing (its latest sent or printing job, the one syncJobWithPrinter follows). A print lost to a power cut
 * or an unplugged printer stays "printing" for ever, and nobody could cancel or stop it, so it must not hold the file.
 */
function holdsFile(j: PrintJob, now: number): boolean {
  if (j.state === "queued" || j.state === "uploading" || j.state === "sent") return true;
  if (j.state !== "printing") return false;
  const p = store.getPrinter(j.printerId);
  if (!p?.lastSeen || now - Date.parse(p.lastSeen) > ONLINE_MS) return false;
  if (!["PREPARE", "RUNNING", "PAUSE"].includes(p.snapshot?.state ?? "")) return false;
  return store.listPrintJobs({ printerId: j.printerId }).filter((x) => x.state === "sent" || x.state === "printing").at(-1)?.id === j.id;
}

/**
 * A PERSON removes one file from an order: its metadata, its bytes and, for a QC photo, the photo evidence made from it.
 * Refused while a print job uses the file, and for a QC photo once the evidence is submitted. Logged as remove_file.
 * No agent tool calls this.
 */
export async function removeAttachment(orderId: string, fileId: string, by: unknown, now = Date.now()):
  Promise<{ ok: true; attachment: Attachment; evidenceRemoved: string[]; bytesRemoved: boolean } | Fail> {
  const order = store.getOrder(orderId);
  if (!order) return fail(404, "Order not found");
  const a = store.getAttachment(fileId);
  if (!a || a.orderId !== orderId) return fail(404, "File not found");
  if (!isPersonName(by)) return fail(400, "A person's name is required");
  expireStale(now); // a stale job that will never run does not hold the file
  const r: string[] = [];
  for (const j of store.listPrintJobs()) {
    if (j.attachmentId === a.id && holdsFile(j, now)) r.push(`Print job ${j.id} is still using this file: cancel or stop the print first`);
  }
  // The studio PC downloads the source of a slice it took, or is about to (src/lib/slicing.ts).
  for (const s of store.listSliceJobs({ orderId })) {
    if (s.attachmentId === a.id && sliceHoldsSource(s, now)) r.push(`Slice ${s.id} is still using this file: cancel the slice first`);
  }
  const locked = a.kind === "qc_photo" ? qcPhotoLocked(order.status) : null;
  if (locked) r.push(locked);
  if (r.length) return fail(409, "The file cannot be removed now", r);

  // Rows and the log first, in one transaction and in the same step as the checks above (no await in between), so a
  // print cannot start on the file meanwhile and the removal is never recorded without who did it.
  const input = { fileId: a.id, filename: a.filename, kind: a.kind, size: a.size, by: by.trim() };
  const evidenceRemoved = store.listEvidence(orderId).filter((e) => e.attachmentId === a.id).map((e) => e.id);
  store.deleteAttachment(a.id, evidenceRemoved, {
    orderId, actor: "human", tool: "remove_file", input, ok: true, output: { evidenceRemoved, storageKey: a.storageKey }, at: new Date(now).toISOString(),
  });
  // Then the bytes: nothing can reach them any more. A file already gone from the disk is fine. A store that fails (or
  // throws) leaves the bytes behind: a second, failed remove_file row names the stored copy so a person can delete it.
  try {
    await fileStore().remove(a.storageKey);
    return { ok: true, attachment: a, evidenceRemoved, bytesRemoved: true };
  } catch (e) {
    store.addLog({
      orderId, actor: "human", tool: "remove_file", input, ok: false,
      // Only the error code (EPERM, EBUSY…): the message holds a local path.
      output: { error: "The stored copy could not be deleted", storageKey: a.storageKey, bytesRemoved: false, code: String((e as NodeJS.ErrnoException)?.code ?? "error") },
      at: new Date(now).toISOString(),
    });
    return { ok: true, attachment: a, evidenceRemoved, bytesRemoved: false };
  }
}

// Order attachments: design files for the operator's slicer, customer reference images, QC photos.
// Bytes live behind a FileStore (local disk now; swap for online storage when the app is hosted).
// Stored names are the attachment id + extension, never the uploaded file name, so a file name
// can never point outside the folder. Files are never sent to the LLM; the agent only sees metadata.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as store from "./store";
import type { Fail } from "./actions";
import { parse3mf } from "./threemf";
import type { Attachment, Evidence } from "./types";

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
  };
}

const g = globalThis as unknown as { __kesuniFiles?: FileStore };
export const fileStore = (): FileStore => (g.__kesuniFiles ??= localStore());
/** Tests only. */
export const setFileStore = (fs: FileStore | undefined) => { g.__kesuniFiles = fs; };

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

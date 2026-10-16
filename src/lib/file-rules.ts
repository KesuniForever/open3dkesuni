// Rules about order files that the order page needs too. No Node imports: FilesPanel runs in the browser.
import type { Order } from "./types";

/** A QC photo is photo evidence: it can go only until the evidence is submitted (the customer and the escrow release rely on it after). */
export const QC_REMOVABLE: readonly Order["status"][] = ["CREATED", "PLAN_CHOSEN", "IN_PRODUCTION"];

/** Why a QC photo of an order in this status cannot be removed; null when it can. English (pages show it with tLib). */
export const qcPhotoLocked = (status: Order["status"]): string | null =>
  QC_REMOVABLE.includes(status) ? null : `Order is ${status}; a QC photo stays once evidence is submitted`;

// ---------- the customer's own design (order form, src/lib/auto-weigh.ts) ----------

/** Who uploaded a design the customer sent themselves: with the order form or later on their order page (uploadedBy). */
export const CUSTOMER_UPLOAD_BY = "Customer (order form)";
/** The customer's design: at most this big (a person may upload up to 50 MB on the order page). */
export const MAX_CUSTOMER_DESIGN_BYTES = 25 * 1024 * 1024;
/**
 * What the customer may send: a mesh (STL or OBJ), sliced with the studio's own presets. Never a 3MF project: it brings
 * its own printer settings and G-code, which nobody at Kesuni has checked (people upload those on the order page).
 */
export const CUSTOMER_DESIGN_EXTS = [".stl", ".obj"];

/** The name is not .stl or .obj (the order form then reads the first bytes: src/lib/model-sniff.ts). */
export const NOT_A_MODEL = "Send your design as an STL or OBJ file";
/** Customers without a 3D file often pick a photo of the item or a logo: the field is optional, the notes do instead. */
export const A_PHOTO = "This is a photo, not a 3D file. Leave this empty and describe the item in the notes.";
export const A_DOCUMENT = "This is a document, not a 3D file. Leave this empty and describe the item in the notes.";
const PHOTO_EXTS = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".gif"];

/** Why the order form refuses this file before sending it (name and size only; the server reads the content), or null. */
export function customerDesignProblem(name: string, size: number): string | null {
  const ext = /\.[^./\\]+$/.exec(name.toLowerCase())?.[0] ?? "";
  if (PHOTO_EXTS.includes(ext)) return A_PHOTO;
  if (ext === ".pdf") return A_DOCUMENT;
  if (ext === ".step" || ext === ".stp") return "STEP files cannot be weighed here: export an STL from your CAD program";
  if (ext === ".3mf") return "Export your model as an STL or OBJ. Send a 3MF project on WhatsApp.";
  if (!CUSTOMER_DESIGN_EXTS.includes(ext)) return NOT_A_MODEL;
  if (size <= 0) return "Your design file is empty";
  if (size > MAX_CUSTOMER_DESIGN_BYTES) return "Your design is larger than 25 MB. Send it on WhatsApp instead.";
  return null;
}

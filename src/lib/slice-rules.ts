// Slicing on the website: which order files the studio PC can slice, with which Bambu Studio presets, and what the
// sliced file must hold. Bambu Studio's command line runs on the studio PC through the LAN bridge
// (scripts/bridge/slicer.mjs), never on the app's server: the app may run where Bambu Studio does not (Railway).
// Type imports only: the order page (browser), the app (src/lib/slicing.ts) and the bridge (Node type stripping) share
// this file. Texts are English; pages show them with tLib.
import type { Attachment, Material, SliceJob, SliceQuality, ThreeMfInfo } from "./types";

/** The studio's printers: Bambu Lab A1, 0.4 mm nozzle, textured PEI plate. Every slice is for exactly this. */
export const A1 = { model: "Bambu Lab A1", modelId: "N2S", nozzle: "0.4", bedType: "textured_plate" } as const;
/** Bambu Studio system presets (resources/profiles/BBL, 02.08). The bridge flattens them before the slicer reads them. */
export const MACHINE_PRESET = "Bambu Lab A1 0.4 nozzle";
export const QUALITY: Readonly<Record<SliceQuality, { preset: string; layer: string; label: string }>> = {
  standard: { preset: "0.20mm Standard @BBL A1", layer: "0.2", label: "Standard 0.20 mm" },
  fine: { preset: "0.16mm Optimal @BBL A1", layer: "0.16", label: "Fine 0.16 mm" },
  draft: { preset: "0.24mm Draft @BBL A1", layer: "0.24", label: "Draft 0.24 mm" },
};
export const SLICE_QUALITIES: readonly SliceQuality[] = ["standard", "fine", "draft"];
export const FILAMENT_PRESET: Readonly<Record<Material, string>> = { PLA: "Bambu PLA Basic @BBL A1", PETG: "Bambu PETG Basic @BBL A1" };
export const SLICE_MATERIALS: readonly Material[] = ["PLA", "PETG"];
export const SUPPORT_MODES: readonly SliceJob["supports"][] = ["auto", "off"];
export const DEFAULT_QUALITY: SliceQuality = "standard";
export const DEFAULT_INFILL_PCT = 20;
/** Who uploaded a sliced file the studio PC made (the attachment's uploadedBy). */
export const SLICER_NAME = "Bambu Studio (slicer)";
/**
 * Who asked for an automatic slice that only weighs the customer's own design for the price (SliceJob.by, actor
 * "system"). Starts with "Slicer (" so the public Live page never takes it for a person's name to hide (src/lib/live.ts).
 */
export const AUTO_WEIGH_BY = "Slicer (automatic weighing)";
/** The slicer stops after this (the bridge kills it): a 49 MB model took 22 s on the studio PC. */
export const SLICE_TIMEOUT_MS = 10 * 60_000;
/** A slice the studio PC has not taken by then fails (src/lib/slicing.ts expireStaleSlices). */
export const SLICE_PICKUP_MS = 15 * 60_000;
/** A slice the studio PC took fails when it has not said "alive" for this long (it sends it every minute while it
 *  downloads, slices and uploads; a bridge restarted mid-slice or a lost network frees the slice within 3 min). */
export const SLICE_RUN_MS = 3 * 60_000;
/** How often the studio PC says "alive" for the slice it works on. */
export const SLICE_ALIVE_MS = 45_000;
/** Still waiting or slicing, and not stale: the slice holds its source file. */
export const sliceHoldsSource = (j: Pick<SliceJob, "state" | "createdAt" | "updatedAt">, now: number): boolean =>
  (j.state === "queued" && now - Date.parse(j.createdAt) <= SLICE_PICKUP_MS) || (j.state === "slicing" && now - Date.parse(j.updatedAt) <= SLICE_RUN_MS);
/** Same as order files (src/lib/files.ts MAX_BYTES): the model in, and the sliced file out. */
export const MAX_SLICE_BYTES = 50 * 1024 * 1024;

/** Meshes: arranged on the bed and sliced with the presets above. They carry no colour: one filament, one colour. */
export const MESH_EXTS = [".stl", ".obj"];
const ext = (name: string) => /\.[^./\\]+$/.exec(name.toLowerCase())?.[0] ?? "";

export type SliceMode = SliceJob["mode"];

/**
 * Can the studio PC slice this order file, and how. "mesh": an STL or OBJ, with the A1 presets. "project": a Bambu
 * Studio 3MF that is not sliced yet, set up for the A1 0.4 mm with one filament: it keeps the designer's own settings
 * and gets the picked spool's filament and colour. Anything else goes to a person in Bambu Studio.
 */
export function sliceSourceCheck(a: Pick<Attachment, "filename" | "kind" | "parsed3mf">): { ok: true; mode: SliceMode } | { ok: false; reason: string } {
  if (a.kind !== "design") return { ok: false, reason: "Only design files can be sliced" };
  const e = ext(a.filename);
  if (MESH_EXTS.includes(e)) return { ok: true, mode: "mesh" };
  if (e === ".step" || e === ".stp") return { ok: false, reason: "STEP files cannot be sliced here: export an STL from the CAD program" };
  if (e !== ".3mf") return { ok: false, reason: "Only STL, OBJ or an unsliced Bambu Studio 3MF can be sliced here" };
  const info = a.parsed3mf;
  if (!info) return { ok: false, reason: "This file was uploaded before 3MF files were read. Upload it again." };
  if (info.sliced) return { ok: false, reason: "This 3MF is already sliced" };
  if (info.error) return { ok: false, reason: `The 3MF could not be read: ${info.error}` };
  if (info.printerModel !== A1.model || info.nozzle !== A1.nozzle) {
    return { ok: false, reason: "This 3MF is not set up for the Bambu Lab A1 0.4 mm: slice it in Bambu Studio" };
  }
  if ((info.projectFilaments?.length ?? 0) !== 1) return { ok: false, reason: "This 3MF uses several filaments: slice it in Bambu Studio" };
  return { ok: true, mode: "project" };
}

/** Same source and same settings: the same sliced file. One active slice per key; a finished one is reused. */
export const sliceKey = (j: Pick<SliceJob, "attachmentId" | "mode" | "material" | "color" | "quality" | "infillPct" | "supports">): string =>
  j.mode === "project"
    ? [j.attachmentId, "project", j.material, j.color].join("|")
    : [j.attachmentId, "mesh", j.material, j.color, j.quality, j.infillPct, j.supports].join("|");

/** "Kubus Uji (v2).STL" -> "Kubus Uji (v2) PLA White 0.2mm.gcode.3mf": the name of the sliced file on the order. */
export function slicedFileName(source: string, material: Material, colorName: string, quality: SliceQuality | null): string {
  const stem = source.replace(/\.(gcode\.)?3mf$/i, "").replace(/\.[^.]+$/, "").replace(/[^\w.\- ()]/g, "_").trim().slice(0, 60) || "model";
  const colour = colorName.replace(/[^\w ]/g, "").trim();
  return `${stem} ${material}${colour ? ` ${colour}` : ""}${quality ? ` ${QUALITY[quality].layer}mm` : ""}.gcode.3mf`;
}

/**
 * Why a sliced file from the studio PC must not go on the order, or null. Checked by the bridge before it uploads and
 * by the app again: printable (G-code), for the A1, 0.4 mm nozzle, textured PEI plate, with a weight and a time, and
 * one filament of the asked material and colour on every plate. A mesh gives exactly one plate.
 */
export function sliceOutputProblem(info: ThreeMfInfo, want: Pick<SliceJob, "mode" | "material" | "color">): string | null {
  if (!info.sliced || info.plates.length === 0) return "The slicer output has no printable plate";
  if (want.mode === "mesh" && info.plates.length !== 1) return "The slicer output has more than one plate";
  if (info.printerModelId ? info.printerModelId !== A1.modelId : info.printerModel !== A1.model) return "The slicer output is not for the Bambu Lab A1";
  if ((info.projectFilaments?.length ?? 0) !== 1) return "The slicer output uses more than one filament";
  for (const p of info.plates) {
    if ((p.nozzle ?? info.nozzle) !== A1.nozzle) return "The slicer output is not for the 0.4 mm nozzle";
    if (p.bedType !== A1.bedType) return "The slicer output is not for the textured PEI plate";
    if (!(Number(p.weightG) > 0) || !(Number(p.predictionSec) > 0)) return "The slicer output has no weight or time";
    const f = p.filaments;
    if (f.length !== 1 || f[0].type.trim().toUpperCase() !== want.material || f[0].color.toUpperCase() !== want.color.toUpperCase() || !f[0].infoIdx) {
      return "The slicer output has the wrong filament or colour";
    }
  }
  return null;
}
